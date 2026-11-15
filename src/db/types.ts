import { z } from 'zod'
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
})

export type GarmentInput = z.input<typeof garmentInputSchema>
export type GarmentData = z.output<typeof garmentInputSchema>

export interface Garment extends GarmentData {
  id: string
  created_at: string
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
}

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
