import { z } from 'zod'
import { garmentInputSchema } from '../db/types'

const MIN_BBOX_SIDE = 0.02
const EPS = 1e-6

/** Cuadro delimitador normalizado 0–1 (origen arriba a la izquierda) que propone la IA para recortar la prenda. */
export const bboxSchema = z
  .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
  .refine(
    (b) =>
      b.x >= 0 && b.y >= 0 && b.w >= MIN_BBOX_SIDE && b.h >= MIN_BBOX_SIDE && b.x + b.w <= 1 + EPS && b.y + b.h <= 1 + EPS,
    'bbox fuera de rango',
  )
export type BBox = z.output<typeof bboxSchema>

/** El bbox es opcional y nunca rompe el etiquetado: si falta o es inválido se ignora (undefined). */
const optionalBBoxSchema = z.preprocess((v) => (bboxSchema.safeParse(v).success ? v : undefined), bboxSchema.optional())

/** Campos que la IA propone para una prenda (sin foto ni estado). */
export const taggedGarmentSchema = garmentInputSchema
  .omit({ photo_path: true, status: true })
  .extend({ bbox: optionalBBoxSchema })
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
