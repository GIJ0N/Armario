import { z } from 'zod'
import { garmentAttributes, type GarmentAttributes } from './stylist'

export const TASTE_SUMMARY_MAX_CHARS = 600

export const TASTE_SYSTEM = `You summarize the clothing taste of one man from his ratings of outfits suggested from his own wardrobe. You only receive structured attributes (no photos). Respond with JSON only.

Each rating has: "rating" (like or dislike), "tags" (quick reasons the user picked), an optional "comment", the occasion, and the attributes of each garment in the outfit (formality and warmth use a 1-5 scale).

Write a "summary" in Spanish, at most ${TASTE_SUMMARY_MAX_CHARS} characters, with CONCRETE preferences that a stylist can apply, for example: "prefiere siluetas ajustadas arriba con pantalón regular; evita formalidad 4+ en casual; le gustan los tonos neutros con un solo color vivo". Mention formality level, silhouettes, colors, materials, patterns, comfort and weather only when the ratings support it. Do not invent preferences without evidence. If "previous_summary" is given, keep what is still supported and update the rest.

Output JSON: {"summary": "..."}`

export interface RatedOutfitForPrompt {
  rating: 'like' | 'dislike'
  /** Códigos de los motivos rápidos (p. ej. too_formal). */
  tags: string[]
  comment: string
  occasion: string
  garments: GarmentAttributes[]
}

/** Solo atributos de prendas: nunca fotos, rutas, notas ni ids. */
export function buildTasteUser(input: { ratings: RatedOutfitForPrompt[]; previousSummary?: string }): string {
  const ratings = input.ratings.map((r) => ({
    rating: r.rating,
    tags: r.tags,
    ...(r.comment.trim() ? { comment: r.comment.trim() } : {}),
    occasion: r.occasion,
    garments: r.garments.map(garmentAttributes),
  }))
  const payload: Record<string, unknown> = { ratings }
  if (input.previousSummary?.trim()) payload.previous_summary = input.previousSummary.trim()
  return `Summarize the user's taste from these recent ratings:\n${JSON.stringify(payload)}`
}

export const tasteResponseSchema = z.object({
  summary: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.slice(0, TASTE_SUMMARY_MAX_CHARS).trim()),
})
export type TasteResponse = z.output<typeof tasteResponseSchema>

export const TASTE_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: { summary: { type: 'STRING' } },
  required: ['summary'],
}
