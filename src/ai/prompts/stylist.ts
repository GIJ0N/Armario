import { z } from 'zod'

export const STYLIST_SYSTEM = `You are a personal stylist composing daily outfits from a man's own wardrobe. You only receive structured attributes (no photos). Respond with JSON only.

Task: propose exactly 3 different outfits for the given occasion and weather, using ONLY the candidate garments provided (reference them by their "id").

Hard constraints (an outfit that breaks any of them is rejected by code):
- Exactly one top, one bottom and one pair of shoes per outfit.
- Outerwear: at most one. It is REQUIRED when "outerwear_required" is true.
- Accessories: 0 to 2, each with formality within 1 point of the outfit's average formality.
- Formality of top, bottom, shoes and outerwear must not differ by more than 1 point (scale 1-5).
- At most ONE garment with "is_statement": true in the whole outfit.
- Every outfit must include at least one garment with "priority": true (these are the least-worn pieces we want to bring back into rotation).
- Never repeat a combination listed in "recent_outfits", and the 3 outfits must be different from each other (different set of top, bottom, shoes and outerwear).
- Only use ids that appear in "candidates". Respect the weather: warmth values already fit the temperature, and rain calls for suitable outerwear when available.

Styling principles, in order of importance:
1. Formality coherence: all pieces sit at the same level; shoes match the occasion.
2. Silhouette and proportion: balance loose with fitted pieces (for example loose top with a slimmer bottom). Athletic occasions can relax this.
3. One statement piece: let a single bold item (loud print, vivid color, unusual design) lead and keep the rest calm.
4. Texture and material: mix textures with intent and respect the climate (no heavy wool in heat, no thin linen in the cold).
5. Shoes as anchor: the shoes define the formality level and must fit the occasion.
6. Color last: a palette of 2 to 3 tones with neutrals (black, white, gray, beige, navy, brown, cream) as the base. Color is one criterion among the others, not the only one.

Reasoning: for each outfit write ONE line in Spanish (maximum 220 characters), specific to that outfit: say why these particular pieces work together (formality, proportion, texture, color, weather) and, if relevant, which least-worn piece it brings back. No generic phrases such as "a nice outfit".

Output JSON: {"outfits": [{"garment_ids": ["..."], "reasoning": "..."}]} with exactly 3 outfits.`

export interface StylistCandidate {
  id: string
  category: string
  subcategory: string
  colors: string[]
  pattern: string
  material: string
  fit: string
  formality: number
  warmth: number
  is_statement: boolean
  priority: boolean
  notes?: string
}

export interface StylistPromptInput {
  occasion: string
  occasionLabel: string
  weather: {
    temp_c: number
    feels_like_c?: number
    min_c: number
    max_c: number
    rain_probability_percent: number
    raining: boolean
  }
  outerwearRequired: boolean
  outerwearRecommended: boolean
  candidates: StylistCandidate[]
  /** Conjuntos de ids de los últimos 14 días que no se pueden repetir. */
  recentOutfits: string[][]
  /** Errores de validación de un intento anterior (reintento). */
  errors?: string[]
  /** Fase 5: perfil de gusto en texto. */
  tasteProfile?: string
  /** Fase 5: outfits con «me gusta» como ejemplos. */
  likedExamples?: { garment_ids: string[]; reasoning: string }[]
}

/** Mensaje de usuario del estilista: solo atributos en JSON, sin fotos ni rutas de fotos. */
export function buildStylistUser(input: StylistPromptInput): string {
  const payload: Record<string, unknown> = {
    occasion: input.occasion,
    weather: input.weather,
    outerwear_required: input.outerwearRequired,
    outerwear_recommended: input.outerwearRecommended,
    candidates: input.candidates,
    recent_outfits: input.recentOutfits,
  }
  const parts: string[] = []
  if (input.tasteProfile?.trim()) parts.push(`Taste profile of the user:\n${input.tasteProfile.trim()}`)
  if (input.likedExamples?.length) {
    parts.push(`Outfits the user liked (use as inspiration, do not copy):\n${JSON.stringify(input.likedExamples)}`)
  }
  parts.push(`Compose 3 outfits for this context:\n${JSON.stringify(payload)}`)
  if (input.errors?.length) {
    parts.push(
      `Your previous answer was rejected by validation:\n${input.errors.map((e) => `- ${e}`).join('\n')}\nReturn 3 corrected outfits that satisfy every hard constraint.`,
    )
  }
  return parts.join('\n\n')
}

export const stylistResponseSchema = z.object({
  outfits: z
    .array(
      z.object({
        garment_ids: z.array(z.string().trim().min(1)).min(1),
        reasoning: z.string().trim().min(1),
      }),
    )
    .min(1),
})
export type StylistResponse = z.output<typeof stylistResponseSchema>

/** responseSchema (subconjunto de OpenAPI) equivalente a stylistResponseSchema. */
export const STYLIST_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    outfits: {
      type: 'ARRAY',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'OBJECT',
        properties: {
          garment_ids: { type: 'ARRAY', items: { type: 'STRING' } },
          reasoning: { type: 'STRING' },
        },
        required: ['garment_ids', 'reasoning'],
      },
    },
  },
  required: ['outfits'],
}
