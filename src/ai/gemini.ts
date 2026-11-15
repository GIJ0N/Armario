import {
  AiAuthError,
  AiInvalidResponseError,
  AiModelNotFoundError,
  AiNetworkError,
  AiNotConfiguredError,
  AiRateLimitError,
} from './errors'
import {
  TAG_GARMENT_JSON_SCHEMA,
  TAG_GARMENT_SYSTEM,
  TAG_GARMENT_USER,
} from './prompts/tagGarment'
import { taggedGarmentSchema, type AiProvider, type GenerateJsonRequest, type TaggedGarment } from './provider'

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
export const DEFAULT_TIMEOUT_MS = 45_000
/** Modelos estables a los que se recurre si el elegido está saturado o no responde. */
export const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const
/** Espera antes del único reintento sobre el mismo modelo ante un 5xx. */
export const RETRY_DELAY_MS = 1500
/** Tras fallar, un modelo se prueba al final de la cola durante este tiempo. */
export const MODEL_COOLDOWN_MS = 5 * 60_000

/** Modelos que fallaron hace poco (memoria de sesión; no se guarda en disco). */
const failedAt = new Map<string, number>()

/** Solo para pruebas. */
export function resetModelCooldowns() {
  failedAt.clear()
}

export interface GeminiOptions {
  apiKey: string
  model: string
  temperature?: number
  timeoutMs?: number
  /** Modelos de respaldo, en orden. Por defecto `FALLBACK_MODELS`; `[]` desactiva el respaldo. */
  fallbackModels?: readonly string[]
  /** Espera entre el primer intento y su reintento (ms). */
  retryDelayMs?: number
  /** Se llama cuando una respuesta salió de un modelo distinto al configurado. */
  onFallback?: (usedModel: string) => void
  /** Inyectable para pruebas; por defecto el fetch global. */
  fetchImpl?: typeof fetch
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new AiNetworkError('No se pudo leer la imagen.'))
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

export interface ListedModel {
  /** Id sin el prefijo `models/`. */
  id: string
  supportsGenerateContent: boolean
}

export class GeminiProvider implements AiProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly temperature: number
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly fallbackModels: readonly string[]
  private readonly retryDelayMs: number
  private readonly onFallback?: (usedModel: string) => void
  /** Último modelo que respondió; `null` si aún no hay llamadas. */
  lastModelUsed: string | null = null

  constructor(opts: GeminiOptions) {
    if (!opts.apiKey.trim()) throw new AiNotConfiguredError()
    this.apiKey = opts.apiKey.trim()
    this.model = opts.model
    this.temperature = opts.temperature ?? 0.2
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a))
    this.fallbackModels = opts.fallbackModels ?? FALLBACK_MODELS
    this.retryDelayMs = opts.retryDelayMs ?? RETRY_DELAY_MS
    this.onFallback = opts.onFallback
  }

  tagGarment(image: Blob): Promise<TaggedGarment> {
    return this.generateJson({
      system: TAG_GARMENT_SYSTEM,
      user: TAG_GARMENT_USER,
      images: [image],
      schema: taggedGarmentSchema,
      jsonSchema: TAG_GARMENT_JSON_SCHEMA,
    })
  }

  async generateJson<T>(req: GenerateJsonRequest<T>): Promise<T> {
    const first = await this.callOnce(req, req.user)
    const parsed = this.parse(req, first)
    if (parsed.ok) return parsed.value

    const retryPrompt =
      `${req.user}\n\nYour previous response was rejected by validation: ${parsed.message}\n` +
      'Return corrected JSON that satisfies the schema exactly.'
    const second = await this.callOnce(req, retryPrompt)
    const reparsed = this.parse(req, second)
    if (reparsed.ok) return reparsed.value
    throw new AiInvalidResponseError(`La IA devolvió una respuesta inválida: ${reparsed.message}`, this.redact(reparsed.message).slice(0, 300))
  }

  private parse<T>(
    req: GenerateJsonRequest<T>,
    text: string,
  ): { ok: true; value: T } | { ok: false; message: string } {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, message: 'the response was not valid JSON' }
    }
    const result = req.schema.safeParse(json)
    if (result.success) return { ok: true, value: result.data }
    return { ok: false, message: result.error.message }
  }

  /** Lista los modelos disponibles para la key (GET /v1beta/models). */
  async listModels(): Promise<ListedModel[]> {
    const res = await this.request(`${GEMINI_ENDPOINT}?pageSize=200`, { method: 'GET' })
    if (!res.ok) await this.throwHttpError(res)
    let payload: { models?: { name?: string; supportedGenerationMethods?: string[] }[] }
    try {
      payload = (await res.json()) as typeof payload
    } catch {
      throw new AiInvalidResponseError(undefined, 'la lista de modelos no es JSON')
    }
    return (payload.models ?? [])
      .filter((m): m is { name: string; supportedGenerationMethods?: string[] } => typeof m.name === 'string')
      .map((m) => ({
        id: m.name.replace(/^models\//, ''),
        supportsGenerateContent: m.supportedGenerationMethods?.includes('generateContent') ?? false,
      }))
  }

  /** Quita la API key de cualquier texto técnico. */
  private redact(text: string): string {
    return text.split(this.apiKey).join('[API key]')
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), 'x-goog-api-key': this.apiKey },
        signal: controller.signal,
      })
    } catch (e) {
      const online = typeof navigator !== 'undefined' ? navigator.onLine : true
      if (controller.signal.aborted) {
        throw new AiNetworkError(
          'La IA tardó demasiado en responder.',
          `timeout ${Math.round(this.timeoutMs / 1000)} s`,
          'timeout',
        )
      }
      const what = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      throw new AiNetworkError(
        'No se pudo conectar con la IA.',
        this.redact(`${what} (navigator.onLine=${online})`),
        online ? 'fetch' : 'offline',
      )
    } finally {
      clearTimeout(timer)
    }
  }

  /** Orden de prueba: el elegido, luego los de respaldo; los que fallaron hace poco, al final. */
  private modelQueue(): string[] {
    const all = [...new Set([this.model, ...this.fallbackModels])]
    const now = Date.now()
    const recentlyFailed = (m: string) => now - (failedAt.get(m) ?? -Infinity) < MODEL_COOLDOWN_MS
    return [...all.filter((m) => !recentlyFailed(m)), ...all.filter(recentlyFailed)]
  }

  /** Un fallo del modelo (no de la key ni de la red local) justifica probar otro. */
  private static isModelFailure(e: unknown): boolean {
    return (
      e instanceof AiRateLimitError ||
      e instanceof AiModelNotFoundError ||
      (e instanceof AiNetworkError && (e.kind === 'http' || e.kind === 'timeout'))
    )
  }

  private async callOnce<T>(req: GenerateJsonRequest<T>, userText: string): Promise<string> {
    let firstError: unknown
    for (const model of this.modelQueue()) {
      try {
        let text: string
        try {
          text = await this.callModel(model, req, userText)
        } catch (e) {
          // Un 5xx suele ser momentáneo: un reintento breve antes de cambiar de modelo.
          if (!(e instanceof AiNetworkError && e.kind === 'http')) throw e
          await new Promise((r) => setTimeout(r, this.retryDelayMs))
          text = await this.callModel(model, req, userText)
        }
        failedAt.delete(model)
        this.lastModelUsed = model
        if (model !== this.model) this.onFallback?.(model)
        return text
      } catch (e) {
        if (!GeminiProvider.isModelFailure(e)) throw e
        failedAt.set(model, Date.now())
        firstError ??= e
      }
    }
    throw firstError
  }

  private async callModel<T>(model: string, req: GenerateJsonRequest<T>, userText: string): Promise<string> {
    const imageParts = await Promise.all(
      (req.images ?? []).map(async (img) => ({
        inline_data: { mime_type: 'image/jpeg', data: await blobToBase64(img) },
      })),
    )
    const body = {
      system_instruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [...imageParts, { text: userText }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: req.jsonSchema,
        temperature: this.temperature,
      },
    }

    const res = await this.request(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) await this.throwHttpError(res, model)

    let payload: unknown
    try {
      payload = await res.json()
    } catch {
      throw new AiInvalidResponseError()
    }
    const parts = (payload as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
      ?.candidates?.[0]?.content?.parts
    const text = parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim()
    if (!text) throw new AiInvalidResponseError('La IA no devolvió contenido.')
    return text
  }

  private async throwHttpError(res: Response, model = this.model): Promise<never> {
    let reason = ''
    let status = ''
    let message = ''
    try {
      const j = (await res.json()) as { error?: { message?: string; status?: string; details?: { reason?: string }[] } }
      status = j.error?.status ?? ''
      reason = j.error?.details?.map((d) => d.reason).filter(Boolean).join(' ') ?? ''
      message = j.error?.message ?? ''
    } catch {
      /* cuerpo no JSON */
    }
    const detail = this.redact(`HTTP ${res.status} ${status} ${reason} ${message}`.replace(/\s+/g, ' ').trim()).slice(0, 300)
    if (res.status === 429) throw new AiRateLimitError(undefined, detail)
    if (res.status === 401 || res.status === 403 || (res.status === 400 && `${status} ${reason} ${message}`.includes('API_KEY_INVALID'))) {
      throw new AiAuthError(undefined, detail)
    }
    if (res.status === 404) throw new AiModelNotFoundError(model, detail)
    if (res.status >= 500) throw new AiNetworkError(`La IA no está disponible (HTTP ${res.status}).`, detail, 'http')
    throw new AiInvalidResponseError(`La IA rechazó la solicitud (HTTP ${res.status}).`, detail)
  }
}
