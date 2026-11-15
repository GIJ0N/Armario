import { AiNotConfiguredError } from './errors'
import { taggedGarmentSchema, type AiProvider, type GenerateJsonRequest, type TaggedGarment } from './provider'

export const DEFAULT_MOCK_GARMENT: TaggedGarment = {
  category: 'top',
  subcategory: 'camisa',
  colors: ['azul marino'],
  pattern: 'liso',
  material: 'algodón',
  fit: 'regular',
  formality: 4,
  warmth: 2,
  occasions: ['office'],
  is_statement: false,
  notes: 'Camisa de vestir.',
}

export interface MockOptions {
  garment?: TaggedGarment
  /** Si se define, todas las llamadas fallan con este error. */
  error?: Error
  /** Respuesta de generateJson (se valida con el esquema de la solicitud). */
  json?: unknown
  delayMs?: number
}

/** Proveedor determinista para pruebas: nunca toca la red. */
export class MockAiProvider implements AiProvider {
  readonly tagCalls: Blob[] = []
  readonly jsonCalls: GenerateJsonRequest<unknown>[] = []

  options: MockOptions

  constructor(options: MockOptions = {}) {
    this.options = options
  }

  private async settle() {
    if (this.options.delayMs) await new Promise((r) => setTimeout(r, this.options.delayMs))
    if (this.options.error) throw this.options.error
  }

  async tagGarment(image: Blob): Promise<TaggedGarment> {
    this.tagCalls.push(image)
    await this.settle()
    return taggedGarmentSchema.parse(this.options.garment ?? DEFAULT_MOCK_GARMENT)
  }

  async generateJson<T>(req: GenerateJsonRequest<T>): Promise<T> {
    this.jsonCalls.push(req as GenerateJsonRequest<unknown>)
    await this.settle()
    return req.schema.parse(this.options.json ?? {})
  }
}

/** Atajo para pruebas del flujo "sin configurar". */
export class UnconfiguredAiProvider implements AiProvider {
  tagGarment(): Promise<TaggedGarment> {
    return Promise.reject(new AiNotConfiguredError())
  }
  generateJson<T>(): Promise<T> {
    return Promise.reject(new AiNotConfiguredError())
  }
}
