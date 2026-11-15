import { z } from 'zod'
import { CATEGORIES, FITS } from '../../db/types'
import { garmentAttributes, type GarmentAttributes } from './stylist'

export const MAX_EXPLANATION_CHARS = 400
export const MAX_AI_COMPLEMENTS = 3
export const MAX_PHRASE_CHARS = 160

/** La IA no debe devolver enlaces, dominios ni precios; si los trae se eliminan. */
export function sanitizeText(s: string): string {
  return s
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|mx|net|org|io|co|shop|store)\b\S*/gi, '')
    .replace(/(?:MXN|USD)?\s?\$\s?\d[\d.,]*(?:\s?(?:MXN|USD|pesos))?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
}

export const PURCHASE_GAPS_SYSTEM = `You are a personal stylist helping a man decide whether to buy one garment. You only receive structured attributes (no photos). Respond with JSON only.

You receive: the candidate garment, a summary of his wardrobe (attributes only), the result of a rules-based simulation (how many valid outfits the candidate forms per occasion) and the gaps already found by the rules.

Write:
- "explanation": in Spanish, at most ${MAX_EXPLANATION_CHARS} characters, saying what the wardrobe is missing for this garment to work (or why it already works). Be concrete about formality, shoes, bottoms, outerwear, color or weather.
- "complements": up to ${MAX_AI_COMPLEMENTS} garments he could add that would make the candidate work in more outfits, described ONLY by attributes: category (${CATEGORIES.map((c) => `"${c}"`).join(', ')}), subcategory (short Spanish text, e.g. "zapato de vestir"), colors (Spanish color names, neutrals preferred), formality (integer 1-5), warmth (integer 1-5), fit (${FITS.map((f) => `"${f}"`).join(', ')}), optional material and pattern in Spanish, and "reason" (one short Spanish sentence).

Rules:
- NEVER mention brands, stores, links, URLs or prices. Describe the garment only by its attributes.
- Do not include any numbers about outfits: the app computes them itself.
- Choose complements whose formality is within 1 point of the candidate's formality, so they can be worn together.

Output JSON: {"explanation": "...", "complements": [{"category": "...", "subcategory": "...", "colors": ["..."], "formality": 4, "warmth": 2, "fit": "regular", "material": "...", "pattern": "...", "reason": "..."}]}`

export interface PurchaseGapsInput {
  candidate: GarmentAttributes
  wardrobe: GarmentAttributes[]
  /** Outfits por ocasión (clave en inglés) que forma la candidata según el motor. */
  outfitsPerOccasion: Record<string, number>
  totalOutfits: number
  gaps: string[]
}

/** Solo atributos: nunca fotos, rutas, notas ni ids. */
export function buildPurchaseGapsUser(input: PurchaseGapsInput): string {
  return `Evaluate this candidate garment:\n${JSON.stringify({
    candidate: garmentAttributes(input.candidate),
    wardrobe: input.wardrobe.map(garmentAttributes),
    simulation: { outfits_per_occasion: input.outfitsPerOccasion, total_outfits: input.totalOutfits },
    rule_based_gaps: input.gaps,
  })}`
}

const text = (max: number) =>
  z
    .string()
    .transform((s) => sanitizeText(s).slice(0, max).trim())

const complementSchema = z.object({
  category: z.enum(CATEGORIES),
  subcategory: text(60),
  colors: z.array(text(30)).default([]).transform((a) => a.filter(Boolean).slice(0, 3)),
  formality: z.number().int().min(1).max(5),
  warmth: z.number().int().min(1).max(5),
  fit: z.enum(FITS).default('regular'),
  material: text(40).optional(),
  pattern: text(40).optional(),
  reason: text(200).default(''),
})
// Los campos desconocidos (p. ej. números de «outfits desbloqueados» inventados) se descartan al validar.

export const purchaseGapsResponseSchema = z.object({
  explanation: text(MAX_EXPLANATION_CHARS),
  complements: z.array(complementSchema).default([]).transform((a) => a.slice(0, MAX_AI_COMPLEMENTS)),
})
export type PurchaseGapsResponse = z.output<typeof purchaseGapsResponseSchema>
export type AiComplement = PurchaseGapsResponse['complements'][number]

export const PURCHASE_GAPS_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    explanation: { type: 'STRING' },
    complements: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: [...CATEGORIES] },
          subcategory: { type: 'STRING' },
          colors: { type: 'ARRAY', items: { type: 'STRING' } },
          formality: { type: 'INTEGER' },
          warmth: { type: 'INTEGER' },
          fit: { type: 'STRING', enum: [...FITS] },
          material: { type: 'STRING' },
          pattern: { type: 'STRING' },
          reason: { type: 'STRING' },
        },
        required: ['category', 'subcategory', 'colors', 'formality', 'warmth', 'fit', 'reason'],
      },
    },
  },
  required: ['explanation', 'complements'],
}

// --- «Qué le falta a mi armario»: la IA solo redacta; los números los calcula el motor. ---

export const WARDROBE_GAPS_SYSTEM = `You help a man understand what his wardrobe is missing. You receive up to 3 garments (described by attributes) that the app already chose by simulation. Write, for each one and in the same order, ONE friendly sentence in Spanish (at most ${MAX_PHRASE_CHARS} characters) explaining why it would help. Do NOT invent numbers about outfits, and NEVER mention brands, stores, links or prices. Respond with JSON only: {"phrases": ["...", "..."]}`

export function buildWardrobeGapsUser(suggestions: { label: string; category: string; formality: number }[]): string {
  return `Garments to phrase:\n${JSON.stringify(suggestions)}`
}

export const wardrobeGapsResponseSchema = z.object({
  phrases: z.array(text(MAX_PHRASE_CHARS)).default([]).transform((a) => a.slice(0, 3)),
})
export type WardrobeGapsResponse = z.output<typeof wardrobeGapsResponseSchema>

export const WARDROBE_GAPS_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: { phrases: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['phrases'],
}
