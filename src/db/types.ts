import { z } from 'zod'
import type { GarmentAdjust, OutfitLayout } from '../canvas/adjust'
import type { Weather } from '../engine/types'

export const CATEGORIES = ['top', 'bottom', 'shoes', 'outerwear', 'accessory'] as const
export const STATUSES = ['active', 'laundry', 'retired', 'candidate'] as const
export const FITS = ['fitted', 'regular', 'loose'] as const
export const OCCASIONS = [
  'plant_work',
  'office',
  'gym',
  'casual',
  'date',
  'formal_event',
] as const

export type Category = (typeof CATEGORIES)[number]
export type Status = (typeof STATUSES)[number]
export type Fit = (typeof FITS)[number]
export type Occasion = (typeof OCCASIONS)[number]

const scale = z.number().int().min(1).max(5)
const stringList = z.array(z.string().trim().min(1)).default([])

/** Esquema de una prenda sin id ni fecha; se reutiliza en la fase 2 para validar la salida de la IA. */
export const garmentInputSchema = z.object({
  photo_path: z.string().nullable().default(null),
  category: z.enum(CATEGORIES),
  subcategory: z.string().trim().default(''),
  colors: stringList,
  pattern: z.string().trim().default(''),
  material: z.string().trim().default(''),
  fit: z.enum(FITS).default('regular'),
  formality: scale,
  warmth: scale,
  occasions: z.array(z.enum(OCCASIONS)).default([]),
  is_statement: z.boolean().default(false),
  status: z.enum(STATUSES).default('active'),
  notes: z.string().trim().default(''),
  /** Fase 12. Si se omite al actualizar, se conserva el valor guardado. */
  favorite: z.boolean().optional(),
})

export type GarmentInput = z.input<typeof garmentInputSchema>
export type GarmentData = z.output<typeof garmentInputSchema>

export const CUTOUT_KINDS = ['mask', 'bbox'] as const
/** 'mask' = fondo transparente (modelo en el dispositivo); 'bbox' = recorte rectangular con el cuadro de la IA. */
export type CutoutKind = (typeof CUTOUT_KINDS)[number]

export interface Garment extends GarmentData {
  id: string
  created_at: string
  /** Clave del recorte (`cutout:<uuid>`) en el almacén de fotos; null/ausente si no hay recorte. */
  cutout_path?: string | null
  cutout_kind?: CutoutKind | null
  /** Fase 13a: ajuste manual de tamaño/posición en el maniquí, válido en todos los outfits; null/ausente = automático. */
  canvas_adjust?: GarmentAdjust | null
}

export interface GarmentFilter {
  category?: Category
  /** Si se omite, no se filtra por estado. */
  statuses?: readonly Status[]
}

export const OUTFIT_SOURCES = ['ai', 'manual', 'rules'] as const
export type OutfitSourceDb = (typeof OUTFIT_SOURCES)[number]

export interface OutfitInput {
  garment_ids: string[]
  occasion: Occasion
  weather_snapshot: Weather | null
  reasoning: string
  source: OutfitSourceDb
}

export interface Outfit extends OutfitInput {
  id: string
  created_at: string
  /** Fase 12: ISO si el outfit está guardado en «Armario › Outfits»; null/ausente si no. */
  saved_at?: string | null
  /** Nombre opcional del outfit guardado. */
  name?: string | null
  /** Fase 13a: ajustes manuales de este outfit (id de prenda → {dx,dy,scale,z}); null/ausente = automático. */
  canvas_layout?: OutfitLayout | null
}

/** Outfit guardado con la fecha de su último uso (YYYY-MM-DD; null si nunca se ha usado). */
export interface SavedOutfit {
  outfit: Outfit
  lastWorn: string | null
}

/** Fase 13b: un outfit planeado para una fecha futura (o aún no usado). */
export interface PlannedOutfit {
  id: string
  outfitId: string
  /** YYYY-MM-DD (fecha local) */
  date: string
  /** Ocasión con la que se planeó; null si no se indicó. */
  occasion: Occasion | null
  /** ISO */
  createdAt: string
}

/** Un plan con los datos del outfit (unión planned_outfits + outfits). */
export interface PlanEntry extends PlannedOutfit {
  garmentIds: string[]
  /** Ocasión del outfit (la del plan, si existe, está en `occasion`). */
  outfitOccasion: Occasion
  reasoning: string
}

/** Cambio manual de una prenda de un outfit (señal ligera de gusto). */
export interface OutfitSwap {
  id: string
  outfitId: string | null
  /** Prenda que se quitó; null si solo se agregó. */
  fromGarmentId: string | null
  /** Prenda elegida; null si solo se quitó. */
  toGarmentId: string | null
  /** ISO */
  createdAt: string
}

export type NewOutfitSwap = Pick<OutfitSwap, 'outfitId' | 'fromGarmentId' | 'toGarmentId'> & { createdAt?: string }

export const RATINGS = ['like', 'dislike'] as const
export type Rating = (typeof RATINGS)[number]
export const DISLIKE_TAGS = [
  'too_formal',
  'too_casual',
  'colors',
  'fit',
  'weather',
  'repetitive',
  'uncomfortable',
] as const
export const LIKE_TAGS = ['perfect_occasion', 'colors', 'comfortable', 'new_combo'] as const
export type DislikeTag = (typeof DISLIKE_TAGS)[number]
export type LikeTag = (typeof LIKE_TAGS)[number]
export const TAGS_BY_RATING: Record<Rating, readonly string[]> = { like: LIKE_TAGS, dislike: DISLIKE_TAGS }

/** Calificación de un outfit con los datos del outfit (unión feedback + outfits). */
export interface FeedbackEntry {
  id: string
  outfitId: string
  rating: Rating
  tags: string[]
  comment: string
  /** ISO */
  createdAt: string
  garmentIds: string[]
  occasion: Occasion
  reasoning: string
}

export interface TasteProfile {
  summary: string
  /** ISO: última vez que se guardó o reinició el perfil. */
  updatedAt: string
  /** ISO: último «Reiniciar gusto» ('' si nunca). */
  resetAt: string
}

export const VERDICTS = ['buy', 'with_complements', 'skip'] as const
export type Verdict = (typeof VERDICTS)[number]

/** Prenda hipotética (complemento) descrita solo por atributos; la numeración «desbloquea» la calcula el motor. */
export interface StoredComplement {
  category: Category
  subcategory: string
  colors: string[]
  formality: number
  warmth: number
  fit: Fit
  material?: string
  pattern?: string
  /** Texto en español, p. ej. «Zapato de vestir negro, formalidad 4». */
  label: string
  /** Motivo (solo con IA); texto sin enlaces. */
  reason?: string
  /** Outfits adicionales con la candidata que desbloquea, calculados por el motor. */
  unlocks: number
  source: 'rules' | 'ai'
}

export interface StoredExample {
  occasion: Occasion
  garmentIds: string[]
}

/** Resumen guardado de una evaluación (JSON en `details`). */
export interface EvaluationDetails {
  perOccasion: Partial<Record<Occasion, number>>
  occasionCount: number
  partnerCount: number
  duplicateIds: string[]
  examples: StoredExample[]
  explanation: string
  /** Aviso en español (p. ej. «sin IA»); '' si no hay. */
  note: string
  usedAi: boolean
}

export interface PurchaseEvaluation {
  garmentId: string
  verdict: Verdict
  outfitCount: number
  gaps: string[]
  complements: StoredComplement[]
  details: EvaluationDetails
  /** ISO */
  createdAt: string
}

export type NewPurchaseEvaluation = Omit<PurchaseEvaluation, 'createdAt'> & { createdAt?: string }

export interface CandidateEntry {
  garment: Garment
  evaluation: PurchaseEvaluation | null
}
