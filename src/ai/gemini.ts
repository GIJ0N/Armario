import {
  AiAuthError,
  AiInvalidResponseError,
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
export const DEFAULT_TIMEOUT_MS = 20_000

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
    throw new AiInvalidResponseError(`La IA devolvió una respuesta inválida: ${reparsed.message}`)
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

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(`${GEMINI_ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (e) {
      if (controller.signal.aborted) throw new AiNetworkError('La IA tardó demasiado en responder.')
      throw new AiNetworkError(e instanceof Error ? 'No se pudo conectar con la IA.' : undefined)
    } finally {
      clearTimeout(timer)
    }

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
    let detail = ''
    try {
      const j = (await res.json()) as { error?: { message?: string; status?: string; details?: { reason?: string }[] } }
      detail = `${j.error?.status ?? ''} ${j.error?.details?.map((d) => d.reason).join(' ') ?? ''} ${j.error?.message ?? ''}`
    } catch {
      /* cuerpo no JSON */
    }
    if (res.status === 429) throw new AiRateLimitError()
    if (res.status === 401 || res.status === 403 || (res.status === 400 && detail.includes('API_KEY_INVALID'))) {
      throw new AiAuthError()
    }
    if (res.status >= 500) throw new AiNetworkError(`La IA no está disponible (HTTP ${res.status}).`)
    throw new AiInvalidResponseError(`La IA rechazó la solicitud (HTTP ${res.status}).`)
  }
}
