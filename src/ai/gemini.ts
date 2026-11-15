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

export interface GeminiOptions {
  apiKey: string
  model: string
  temperature?: number
  timeoutMs?: number
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

  constructor(opts: GeminiOptions) {
    if (!opts.apiKey.trim()) throw new AiNotConfiguredError()
    this.apiKey = opts.apiKey.trim()
    this.model = opts.model
    this.temperature = opts.temperature ?? 0.2
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a))
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

  private async callOnce<T>(req: GenerateJsonRequest<T>, userText: string): Promise<string> {
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

    const res = await this.request(`${GEMINI_ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) await this.throwHttpError(res)

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

  private async throwHttpError(res: Response): Promise<never> {
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
    if (res.status === 404) throw new AiModelNotFoundError(this.model, detail)
    if (res.status >= 500) throw new AiNetworkError(`La IA no está disponible (HTTP ${res.status}).`, detail, 'http')
    throw new AiInvalidResponseError(`La IA rechazó la solicitud (HTTP ${res.status}).`, detail)
  }
}
