import { z } from 'zod'
import { garmentInputSchema } from '../db/types'

/** Campos que la IA propone para una prenda (sin foto ni estado). */
export const taggedGarmentSchema = garmentInputSchema.omit({ photo_path: true, status: true })
export type TaggedGarment = z.output<typeof taggedGarmentSchema>

export interface GenerateJsonRequest<T> {
  system: string
  user: string
  images?: Blob[]
  /** Validación estricta de la respuesta antes de usarla. */
  schema: z.ZodType<T, unknown>
  /** Subconjunto de OpenAPI que entiende la API (responseSchema). */
  jsonSchema: object
}

export interface AiProvider {
  tagGarment(image: Blob): Promise<TaggedGarment>
  generateJson<T>(req: GenerateJsonRequest<T>): Promise<T>
}
