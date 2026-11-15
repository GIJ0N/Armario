import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AiAuthError,
  AiInvalidResponseError,
  AiNetworkError,
  AiNotConfiguredError,
  AiRateLimitError,
  describeAiError,
} from '../src/ai/errors'
import { GeminiProvider, resetModelCooldowns } from '../src/ai/gemini'
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
    await expect(make(f as unknown as typeof fetch, { fallbackModels: [] }).tagGarment(image)).rejects.toBeInstanceOf(AiRateLimitError)
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

describe('GeminiProvider: diagnóstico', () => {
  const req = {
    system: 's',
    user: 'u',
    schema: taggedGarmentSchema,
    jsonSchema: {},
  }
  async function fail(f: unknown, extra: object = {}) {
    return make(f as typeof fetch, extra)
      .generateJson(req)
      .then(
        () => {
          throw new Error('no falló')
        },
        (e: unknown) => e as Error & { detail?: string },
      )
  }

  it('el timeout por defecto es 45 s y el detalle lo indica', async () => {
    const { DEFAULT_TIMEOUT_MS } = await import('../src/ai/gemini')
    expect(DEFAULT_TIMEOUT_MS).toBe(45_000)
    const f = vi.fn((_u: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    )
    const e = await fail(f, { timeoutMs: 1000 })
    expect(e).toBeInstanceOf(AiNetworkError)
    expect(e.detail).toBe('timeout 1 s')
    expect(describeAiError(e)).toBe('La IA tardó más de 45 s en responder.')
  })

  it('un TypeError de fetch deja el detalle con nombre, mensaje y navigator.onLine', async () => {
    const e = await fail(vi.fn().mockRejectedValue(new TypeError('Load failed')))
    expect(e).toBeInstanceOf(AiNetworkError)
    expect(e.detail).toBe('TypeError: Load failed (navigator.onLine=true)')
    expect(describeAiError(e)).toContain('Tu teléfono no pudo conectarse con Gemini')
  })

  it('sin conexión se describe como tal', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      const e = await fail(vi.fn().mockRejectedValue(new TypeError('Load failed')))
      expect(describeAiError(e)).toBe('Sin conexión a internet.')
      expect(e.detail).toContain('navigator.onLine=false')
    } finally {
      spy.mockRestore()
    }
  })

  it('HTTP 404 dice que el modelo no existe y 400 conserva su mensaje con detalle', async () => {
    const e404 = await fail(vi.fn().mockResolvedValue(err(404, { error: { status: 'NOT_FOUND', message: 'model not found' } })))
    expect(describeAiError(e404)).toBe(
      'El modelo «gemini-test» no existe o no está disponible para tu key. Prueba con otro modelo.',
    )
    expect(e404.detail).toBe('HTTP 404 NOT_FOUND model not found')
    const e400 = await fail(vi.fn().mockResolvedValue(err(400, { error: { status: 'INVALID_ARGUMENT', message: 'bad' } })))
    expect(describeAiError(e400)).toBe('La IA rechazó la solicitud (HTTP 400).')
    expect(e400.detail).toBe('HTTP 400 INVALID_ARGUMENT bad')
  })

  it('el detalle HTTP se trunca a 300 caracteres', async () => {
    const e = await fail(vi.fn().mockResolvedValue(err(400, { error: { message: 'x'.repeat(1000) } })))
    expect(e.detail!.length).toBe(300)
  })

  it('la API key nunca aparece en mensajes ni detalles, ni aunque el servidor o fetch la repitan', async () => {
    const cases = [
      vi.fn().mockRejectedValue(new TypeError('failed for key KEY123')),
      vi.fn().mockResolvedValue(err(400, { error: { status: 'INVALID_ARGUMENT', message: 'bad key KEY123' } })),
      vi.fn().mockResolvedValue(err(404, { error: { message: 'KEY123 not found' } })),
      vi.fn().mockResolvedValue(err(403, { error: { message: 'KEY123 denied' } })),
      vi.fn().mockResolvedValue(err(429, { error: { message: 'KEY123 quota' } })),
      vi.fn().mockResolvedValue(err(503, { error: { message: 'KEY123 down' } })),
    ]
    for (const f of cases) {
      const e = await fail(f)
      expect(e.message).not.toContain('KEY123')
      expect(e.detail ?? '').not.toContain('KEY123')
      expect(describeAiError(e)).not.toContain('KEY123')
    }
    const list = await make(cases[0] as unknown as typeof fetch).listModels().catch((e: Error & { detail?: string }) => e)
    expect((list as Error).message + ((list as { detail?: string }).detail ?? '')).not.toContain('KEY123')
  })

  it('listModels hace GET con la cabecera y parsea ids y métodos', async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: 'models/gemini-a-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
            { name: 'models/embed-1', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
        { status: 200 },
      ),
    )
    const models = await make(f as unknown as typeof fetch).listModels()
    expect(models).toEqual([
      { id: 'gemini-a-flash', supportsGenerateContent: true },
      { id: 'embed-1', supportsGenerateContent: false },
    ])
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200')
    expect(init.method).toBe('GET')
    expect(init.headers['x-goog-api-key']).toBe('KEY123')
  })
})

describe('GeminiProvider: respaldo de modelo', () => {
  beforeEach(() => resetModelCooldowns())
  const urlOf = (f: ReturnType<typeof vi.fn>, i: number) => String(f.mock.calls[i][0])
  const unavailable = () => err(503, { error: { status: 'UNAVAILABLE', message: 'high demand' } })
  const opts = { retryDelayMs: 0, fallbackModels: ['backup-a', 'backup-b'] }

  it('reintenta el mismo modelo una vez ante un 503 y no cambia si responde', async () => {
    const f = vi.fn().mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(ok(DEFAULT_MOCK_GARMENT))
    const onFallback = vi.fn()
    const p = make(f as unknown as typeof fetch, { ...opts, onFallback })
    await p.tagGarment(image)
    expect(f).toHaveBeenCalledTimes(2)
    expect(urlOf(f, 1)).toContain('gemini-test:')
    expect(onFallback).not.toHaveBeenCalled()
    expect(p.lastModelUsed).toBe('gemini-test')
  })

  it('pasa al siguiente modelo cuando el principal sigue en 503', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(ok(DEFAULT_MOCK_GARMENT))
    const onFallback = vi.fn()
    const p = make(f as unknown as typeof fetch, { ...opts, onFallback })
    await p.tagGarment(image)
    expect(urlOf(f, 2)).toContain('backup-a:')
    expect(onFallback).toHaveBeenCalledWith('backup-a')
    expect(p.lastModelUsed).toBe('backup-a')
  })

  it('salta a otro modelo si el elegido da 404 o 429', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(err(404, {}))
      .mockResolvedValueOnce(err(429, {}))
      .mockResolvedValueOnce(ok(DEFAULT_MOCK_GARMENT))
    const p = make(f as unknown as typeof fetch, opts)
    await p.tagGarment(image)
    expect(urlOf(f, 2)).toContain('backup-b:')
  })

  it('no cambia de modelo por un error de la key', async () => {
    const f = vi.fn().mockResolvedValue(err(403, { error: { status: 'PERMISSION_DENIED' } }))
    await expect(make(f as unknown as typeof fetch, opts).tagGarment(image)).rejects.toBeInstanceOf(AiAuthError)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('si todos fallan, lanza el primer error', async () => {
    const f = vi.fn().mockResolvedValue(unavailable())
    const p = make(f as unknown as typeof fetch, opts)
    await expect(p.tagGarment(image)).rejects.toBeInstanceOf(AiNetworkError)
    // 3 modelos × (intento + reintento)
    expect(f).toHaveBeenCalledTimes(6)
  })

  it('un modelo que falló hace poco se prueba al final en la siguiente llamada', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(ok(DEFAULT_MOCK_GARMENT))
      .mockResolvedValueOnce(ok(DEFAULT_MOCK_GARMENT))
    const p = make(f as unknown as typeof fetch, opts)
    await p.tagGarment(image)
    await p.tagGarment(image)
    expect(urlOf(f, 3)).toContain('backup-a:')
  })

  it('con fallbackModels vacío no cambia de modelo', async () => {
    const f = vi.fn().mockResolvedValue(unavailable())
    await expect(make(f as unknown as typeof fetch, { ...opts, fallbackModels: [] }).tagGarment(image)).rejects.toBeInstanceOf(AiNetworkError)
    expect(f).toHaveBeenCalledTimes(2)
  })
})
