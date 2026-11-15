// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildStylistUser,
  STYLIST_JSON_SCHEMA,
  STYLIST_SYSTEM,
  stylistResponseSchema,
  type StylistPromptInput,
} from '../src/ai/prompts/stylist'

const input: StylistPromptInput = {
  occasion: 'office',
  occasionLabel: 'Oficina',
  weather: { temp_c: 22, min_c: 17, max_c: 26, rain_probability_percent: 10, raining: false },
  outerwearRequired: false,
  outerwearRecommended: false,
  candidates: [
    { id: 'a', category: 'top', subcategory: 'camisa', colors: ['blanco'], pattern: 'liso', material: 'algodón', fit: 'fitted', formality: 4, warmth: 2, is_statement: false, priority: true },
  ],
  recentOutfits: [['a', 'b', 'c']],
}

describe('prompt del estilista', () => {
  it('lista los seis principios en orden', () => {
    const keys = ['Formality coherence', 'Silhouette and proportion', 'One statement piece', 'Texture and material', 'Shoes as anchor', 'Color last']
    const pos = keys.map((k) => STYLIST_SYSTEM.indexOf(k))
    expect(pos.every((p) => p >= 0)).toBe(true)
    expect([...pos].sort((a, b) => a - b)).toEqual(pos)
  })

  it('incluye restricciones duras y pide razón en español', () => {
    for (const s of ['Exactly one top', 'priority', 'recent_outfits', 'statement', 'Spanish', 'outerwear_required']) {
      expect(STYLIST_SYSTEM).toContain(s)
    }
  })

  it('el mensaje de usuario es solo JSON de atributos', () => {
    const u = buildStylistUser(input)
    expect(u).toContain('"candidates"')
    expect(u).not.toContain('photo')
    expect(u).not.toContain('Taste profile')
    expect(u).not.toContain('rejected')
  })

  it('admite perfil de gusto, ejemplos y errores (ganchos de fases 5 y reintento)', () => {
    const u = buildStylistUser({
      ...input,
      tasteProfile: 'Prefiere looks sobrios.',
      likedExamples: [{ garment_ids: ['a'], reasoning: 'Me gustó' }],
      errors: ['Unknown garment id "x".'],
    })
    expect(u).toContain('Prefiere looks sobrios.')
    expect(u).toContain('Me gustó')
    expect(u).toContain('- Unknown garment id "x".')
  })

  it('el esquema valida la forma de la respuesta', () => {
    expect(stylistResponseSchema.safeParse({ outfits: [{ garment_ids: ['a'], reasoning: 'x' }] }).success).toBe(true)
    expect(stylistResponseSchema.safeParse({ outfits: [] }).success).toBe(false)
    expect(stylistResponseSchema.safeParse({ outfits: [{ garment_ids: [], reasoning: 'x' }] }).success).toBe(false)
    expect(STYLIST_JSON_SCHEMA.properties.outfits.minItems).toBe(3)
  })
})
