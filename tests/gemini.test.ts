import { describe, expect, it, vi } from 'vitest'
import {
  AiAuthError,
  AiInvalidResponseError,
  AiNetworkError,
  AiNotConfiguredError,
  AiRateLimitError,
} from '../src/ai/errors'
import { GeminiProvider } from '../src/ai/gemini'
import { DEFAULT_MOCK_GARMENT, MockAiProvider } from '../src/ai/mock'
import { taggedGarmentSchema } from '../src/ai/provider'

const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })

function ok(obj: unknown) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] }),
    { status: 200 },
  )
}
function err(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status })
}
function make(fetchImpl: typeof fetch, extra: object = {}) {
  return new GeminiProvider({ apiKey: 'KEY123', model: 'gemini-test', fetchImpl, ...extra })
}

describe('GeminiProvider', () => {
  it('envía URL, cabecera y cuerpo correctos y parsea la respuesta', async () => {
    const f = vi.fn().mockResolvedValue(ok(DEFAULT_MOCK_GARMENT))
    const result = await make(f as unknown as typeof fetch).tagGarment(image)

    expect(result).toEqual(taggedGarmentSchema.parse(DEFAULT_MOCK_GARMENT))
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent')
    expect(init.method).toBe('POST')
    expect(init.headers['x-goog-api-key']).toBe('KEY123')
    expect(String(url)).not.toContain('KEY123')
    const body = JSON.parse(init.body)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema.properties.category.enum).toContain('outerwear')
    expect(typeof body.generationConfig.temperature).toBe('number')
    const parts = body.contents[0].parts
    expect(parts[0].inline_data.mime_type).toBe('image/jpeg')
    expect(parts[0].inline_data.data).toBe('AQID')
    expect(parts[parts.length - 1].text).toBeTruthy()
    expect(body.system_instruction.parts[0].text).toContain('formality')
  })

  it('reintenta una vez con el error de validación y luego tiene éxito', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(ok({ ...DEFAULT_MOCK_GARMENT, formality: 9 }))
      .mockResolvedValueOnce(ok(DEFAULT_MOCK_GARMENT))
    const result = await make(f as unknown as typeof fetch).tagGarment(image)
    expect(result.formality).toBe(4)
    expect(f).toHaveBeenCalledTimes(2)
    const retryText = JSON.parse(f.mock.calls[1][1].body).contents[0].parts.at(-1).text as string
    expect(retryText).toContain('rejected by validation')
    expect(retryText).toContain('formality')
  })

  it('lanza AiInvalidResponseError tras dos respuestas inválidas', async () => {
    const f = vi.fn().mockImplementation(async () => ok('no es json'))
    await expect(make(f as unknown as typeof fetch).tagGarment(image)).rejects.toBeInstanceOf(AiInvalidResponseError)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('429 -> AiRateLimitError sin reintentar', async () => {
    const f = vi.fn().mockResolvedValue(err(429))
    await expect(make(f as unknown as typeof fetch).tagGarment(image)).rejects.toBeInstanceOf(AiRateLimitError)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it.each([
    [400, { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }],
    [401, {}],
    [403, {}],
  ])('HTTP %i -> AiAuthError', async (status, body) => {
    const f = vi.fn().mockResolvedValue(err(status, body))
    await expect(make(f as unknown as typeof fetch).tagGarment(image)).rejects.toBeInstanceOf(AiAuthError)
  })

  it('error de red -> AiNetworkError', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(make(f as unknown as typeof fetch).tagGarment(image)).rejects.toBeInstanceOf(AiNetworkError)
  })

  it('tiempo de espera -> AiNetworkError', async () => {
    const f = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
        }),
    )
    const p = make(f as unknown as typeof fetch, { timeoutMs: 20 }).tagGarment(image)
    await expect(p).rejects.toBeInstanceOf(AiNetworkError)
  })

  it('sin API key lanza AiNotConfiguredError', () => {
    expect(() => new GeminiProvider({ apiKey: '  ', model: 'm' })).toThrow(AiNotConfiguredError)
  })
})

describe('MockAiProvider', () => {
  it('es determinista y valida el esquema', async () => {
    const m = new MockAiProvider()
    expect(await m.tagGarment(image)).toEqual(taggedGarmentSchema.parse(DEFAULT_MOCK_GARMENT))
    expect(m.tagCalls).toHaveLength(1)
  })
})
