// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MockAiProvider } from '../src/ai/mock'
import type { Garment, Occasion } from '../src/db/types'
import {
  buildPlan,
  canRemoveCategory,
  computeManualScores,
  computeTaste,
  findAlternatives,
  MANUAL_SCORE_CAP,
  MANUAL_WEIGHT,
  scoreCombo,
  shuffleAlternative,
  suggestOutfits,
  validateManualOutfit,
  validateOutfit,
  type EngineContext,
} from '../src/engine'
import { COLD, HOT, MILD, TODAY, wardrobe30 } from './fixtures/wardrobe30'

const get = (id: string) => wardrobe30.find((g) => g.id === id)!
const withFav = (...ids: string[]): Garment[] => wardrobe30.map((g) => (ids.includes(g.id) ? { ...g, favorite: true } : g))
const ctxFor = (occasion: Occasion, extra: Partial<EngineContext> = {}): EngineContext => ({
  occasion,
  weather: MILD,
  garments: wardrobe30,
  wears: [],
  recentOutfits: [],
  today: TODAY,
  ...extra,
})

describe('alternativas para cambiar una prenda', () => {
  const current = ['top-oxford-azul', 'bot-chinos-beige', 'sho-mocasines'].map(get)
  const base = { occasion: 'office' as const, weather: MILD, garments: wardrobe30, wears: [], today: TODAY, items: current, replaceId: 'top-oxford-azul', category: 'top' as const }

  it('solo ofrece la misma categoría y nunca la prenda actual ni las de otros espacios', () => {
    const { valid, others } = findAlternatives(base)
    for (const g of [...valid, ...others.map((o) => o.garment)]) {
      expect(g.category).toBe('top')
      expect(g.id).not.toBe('top-oxford-azul')
    }
    expect(valid.length + others.length).toBe(wardrobe30.filter((g) => g.category === 'top').length - 1)
  })

  it('las válidas van primero, de la menos usada a la más usada', () => {
    const wears = [
      { garmentIds: ['top-polo-marino'], date: '2026-11-13' },
      { garmentIds: ['top-camisa-vestir'], date: '2026-10-25' },
    ]
    const { valid } = findAlternatives({ ...base, wears })
    expect(valid.map((g) => g.id)).toEqual(['top-oxford-blanca', 'top-camisa-vestir', 'top-polo-marino'])
  })

  it('«Otras» trae el motivo: formalidad, abrigo, lavandería', () => {
    const garments = wardrobe30.map((g) => (g.id === 'top-camisa-vestir' ? { ...g, status: 'laundry' as const } : g))
    const { valid, others } = findAlternatives({ ...base, garments })
    const reason = (id: string) => others.find((o) => o.garment.id === id)?.reason
    expect(reason('top-playera-blanca')).toBe('muy informal para oficina')
    expect(reason('top-sueter-cafe')).toBe('muy abrigadora para 22°')
    expect(reason('top-camisa-vestir')).toBe('en lavandería')
    expect(valid.map((g) => g.id)).not.toContain('top-camisa-vestir')
    // Las que están en «Otras» no están en las válidas.
    expect(others.every((o) => !valid.includes(o.garment))).toBe(true)
  })

  it('para gym una camisa de vestir es «muy formal para gym»; con calor, «muy ligera»/«abrigadora» según el clima', () => {
    const gymItems = ['top-playera-dryfit', 'bot-shorts-dep', 'sho-tenis-correr'].map(get)
    const gym = findAlternatives({ ...base, occasion: 'gym', weather: null, items: gymItems, replaceId: 'top-playera-dryfit' })
    expect(gym.others.find((o) => o.garment.id === 'top-oxford-blanca')?.reason).toBe('muy formal para gym')
    const hot = findAlternatives({ ...base, weather: HOT, items: ['top-polo-marino', 'bot-chinos-beige', 'sho-mocasines'].map(get), replaceId: 'top-polo-marino' })
    expect(hot.others.find((o) => o.garment.id === 'top-sueter-cafe')?.reason).toBe('muy abrigadora para 33°')
    const cold = findAlternatives({ ...base, weather: COLD, items: ['top-polo-marino', 'bot-chinos-beige', 'sho-mocasines'].map(get), replaceId: 'top-polo-marino' })
    expect(cold.others.find((o) => o.garment.id === 'top-playera-blanca')).toBeDefined()
  })

  it('retiradas y candidatas nunca aparecen; la lavandería solo en «Otras»', () => {
    const garments = wardrobe30.map((g) =>
      g.id === 'top-polo-marino' ? { ...g, status: 'retired' as const } : g.id === 'top-oxford-blanca' ? { ...g, status: 'candidate' as const } : g.id === 'top-camisa-vestir' ? { ...g, status: 'laundry' as const } : g,
    )
    const { valid, others } = findAlternatives({ ...base, garments })
    const all = [...valid, ...others.map((o) => o.garment)].map((g) => g.id)
    expect(all).not.toContain('top-polo-marino')
    expect(all).not.toContain('top-oxford-blanca')
    expect(valid.map((g) => g.id)).not.toContain('top-camisa-vestir')
    expect(all).toContain('top-camisa-vestir')
  })

  it('una prenda que rompe la formalidad con el resto queda en «Otras» con motivo', () => {
    // Con zapatos de vestir (4) y pantalón de vestir (4), una camisa de formalidad 2 no cuadra aunque sea de oficina por etiqueta.
    const items = ['top-oxford-blanca', 'bot-vestir-gris', 'sho-zapatos-vestir'].map(get)
    const garments = wardrobe30.map((g) => (g.id === 'top-playera-blanca' ? { ...g, occasions: ['office' as const], warmth: 2 } : g))
    const { others, valid } = findAlternatives({ ...base, garments, items, replaceId: 'top-oxford-blanca' })
    expect(valid.map((g) => g.id)).not.toContain('top-playera-blanca')
    expect(others.find((o) => o.garment.id === 'top-playera-blanca')?.reason).toBe('su formalidad no va con el resto del outfit')
  })

  it('accesorios: cualquier accesorio; agregar respeta el máximo de 2 y la capa exterior única', () => {
    const items = ['top-oxford-azul', 'bot-chinos-beige', 'sho-mocasines', 'acc-reloj', 'acc-cinturon-cafe'].map(get)
    const add = findAlternatives({ ...base, items, replaceId: null, category: 'accessory' })
    expect(add.valid).toEqual([])
    expect(add.others.find((o) => o.garment.id === 'acc-cinturon-negro')?.reason).toBe('ya hay 2 accesorios')
    const swap = findAlternatives({ ...base, items, replaceId: 'acc-reloj', category: 'accessory' })
    expect(swap.valid.concat(swap.others.map((o) => o.garment)).map((g) => g.id).sort()).toEqual(['acc-cinturon-negro', 'acc-gorra'])
    const withOuter = [...current, get('out-blazer')]
    const addOuter = findAlternatives({ ...base, items: withOuter, replaceId: null, category: 'outerwear' })
    expect(addOuter.valid).toEqual([])
    expect(addOuter.others.find((o) => o.garment.id === 'out-chamarra-mezclilla')?.reason).toBe('muy informal para oficina')
    const casual = findAlternatives({ ...base, occasion: 'casual', items: withOuter.map((g) => (g.id === 'out-blazer' ? { ...g, formality: 3 } : g)), replaceId: null, category: 'outerwear' })
    expect(casual.valid).toEqual([])
    expect(casual.others.find((o) => o.garment.id === 'out-chamarra-mezclilla')?.reason).toBe('ya hay una capa exterior')
  })

  it('«Barajar» elige siempre una alternativa válida y devuelve null si no hay', () => {
    const alt = findAlternatives(base)
    expect(alt.valid.length).toBeGreaterThan(1)
    for (const r of [0, 0.3, 0.5, 0.99, 0.999999]) {
      expect(alt.valid).toContain(shuffleAlternative(alt, () => r))
    }
    for (let i = 0; i < 40; i++) expect(alt.valid.map((g) => g.id)).toContain(shuffleAlternative(alt)!.id)
    expect(shuffleAlternative({ ...alt, valid: [] })).toBeNull()
  })

  it('«Quitar» no existe para arriba, abajo y calzado; la capa solo si el clima no la exige', () => {
    const c = { occasion: 'casual' as const, garments: wardrobe30 }
    expect(canRemoveCategory('top', { ...c, weather: MILD })).toBe(false)
    expect(canRemoveCategory('bottom', { ...c, weather: MILD })).toBe(false)
    expect(canRemoveCategory('shoes', { ...c, weather: null })).toBe(false)
    expect(canRemoveCategory('accessory', { ...c, weather: MILD })).toBe(true)
    expect(canRemoveCategory('outerwear', { ...c, weather: MILD })).toBe(true)
    expect(canRemoveCategory('outerwear', { ...c, weather: COLD })).toBe(false)
    expect(canRemoveCategory('outerwear', { ...c, weather: null })).toBe(true)
  })
})

describe('validateManualOutfit', () => {
  const garments = wardrobe30
  it('acepta un outfit completo válido y no exige rotación ni no repetir', () => {
    const ids = ['top-oxford-azul', 'bot-chinos-beige', 'sho-mocasines']
    expect(validateManualOutfit(ids, { occasion: 'office', weather: MILD, garments })).toEqual({ ok: true })
  })
  it('completo: exige arriba, abajo y calzado; a medias (complete:false) no', () => {
    const r = validateManualOutfit(['top-oxford-azul'], { occasion: 'office', weather: MILD, garments })
    expect(r.ok).toBe(false)
    expect(validateManualOutfit(['top-oxford-azul'], { occasion: 'office', weather: MILD, garments }, { complete: false })).toEqual({ ok: true })
  })
  it('sin clima no exige capa exterior en frío; con clima frío sí', () => {
    const ids = ['top-sueter-cafe', 'bot-chinos-beige', 'sho-mocasines']
    expect(validateManualOutfit(ids, { occasion: 'casual', weather: null, garments })).toEqual({ ok: true })
    const cold = validateManualOutfit(ids, { occasion: 'casual', weather: COLD, garments })
    expect(cold.ok).toBe(false)
  })
})

describe('«Con una favorita»', () => {
  it('satisfacible: cada outfit sugerido incluye una favorita y el validador la exige', async () => {
    const garments = withFav('top-polo-marino', 'sho-mocasines', 'bot-chinos-beige')
    const ctx = ctxFor('office', { garments, requireFavorite: true })
    const res = await suggestOutfits(ctx)
    expect(res.outfits.length).toBe(3)
    expect(res.warnings).toEqual([])
    for (const o of res.outfits) expect(o.garmentIds.some((id) => garments.find((g) => g.id === id)!.favorite)).toBe(true)
    const plan = buildPlan(ctx)
    expect(plan.requireFavorite).toBe(true)
    const noFav = res.outfits[0].garmentIds.filter((id) => !garments.find((g) => g.id === id)!.favorite)
    const strippedOk = validateOutfit({ garmentIds: noFav.length === res.outfits[0].garmentIds.length ? noFav : noFav }, ctx, { plan })
    expect(strippedOk.ok).toBe(false)
  })

  it('una sola favorita que es un accesorio se agrega a cada outfit', async () => {
    const garments = withFav('acc-reloj')
    const ctx = ctxFor('office', { garments, requireFavorite: true })
    const res = await suggestOutfits(ctx)
    expect(res.outfits.length).toBe(3)
    for (const o of res.outfits) expect(o.garmentIds).toContain('acc-reloj')
    const plan = buildPlan(ctx)
    for (const o of res.outfits) expect(validateOutfit(o, ctx, { plan })).toEqual({ ok: true })
  })

  it('insatisfacible (la favorita no es apta): avisa, ignora la restricción y sigue sugiriendo', async () => {
    const garments = withFav('top-playera-dryfit') // formalidad 1: no sirve para oficina
    const ctx = ctxFor('office', { garments, requireFavorite: true })
    const plan = buildPlan(ctx)
    expect(plan.requireFavorite).toBe(false)
    expect(plan.favoriteUnsatisfiable).toBe(true)
    const res = await suggestOutfits(ctx)
    expect(res.outfits.length).toBe(3)
    expect(res.warnings.join(' ')).toMatch(/favorita/)
  })

  it('sin ninguna favorita con la opción activa: avisa; con la opción apagada no pasa nada', async () => {
    const on = await suggestOutfits(ctxFor('casual', { requireFavorite: true }))
    expect(on.outfits.length).toBe(3)
    expect(on.warnings.join(' ')).toMatch(/favorita/)
    const off = await suggestOutfits(ctxFor('casual', { garments: withFav('top-polo-marino') }))
    expect(off.warnings).toEqual([])
  })

  it('el prompt del estilista lista los ids favoritos y exige uno', async () => {
    const garments = withFav('top-polo-marino', 'sho-mocasines')
    const ai = new MockAiProvider({ json: { outfits: [{ garment_ids: ['x'], reasoning: 'x' }] } })
    await suggestOutfits(ctxFor('office', { garments, requireFavorite: true }), ai)
    const req = ai.jsonCalls[0]
    expect(req.user).toContain('"favorite_required":true')
    expect(req.user).toContain('"favorite_ids":["top-polo-marino","sho-mocasines"]')
    expect(req.system).toContain('favorite_required')
    const off = new MockAiProvider({ json: { outfits: [{ garment_ids: ['x'], reasoning: 'x' }] } })
    await suggestOutfits(ctxFor('office', { garments }), off)
    expect(off.jsonCalls[0].user).not.toContain('favorite_required')
  })
})

describe('señal de cambios manuales en el gusto', () => {
  const cat = (id: string) => get(id)?.category
  it('+1 por prenda elegida, -1 por prenda quitada, sin ceros ni ids borrados', () => {
    const scores = computeManualScores(
      [
        { fromGarmentId: 'top-a', toGarmentId: 'top-b' },
        { fromGarmentId: null, toGarmentId: 'top-b' },
        { fromGarmentId: 'top-b', toGarmentId: 'top-c' },
        { fromGarmentId: 'borrada', toGarmentId: null },
      ],
      (id) => id !== 'borrada',
    )
    expect(scores).toEqual({ 'top-a': -1, 'top-b': 1, 'top-c': 1 })
  })

  it('está acotada a ±MANUAL_SCORE_CAP', () => {
    const many = Array.from({ length: 50 }, () => ({ fromGarmentId: 'top-polo-marino', toGarmentId: 'top-oxford-azul' }))
    const scores = computeManualScores(many)
    expect(scores['top-oxford-azul']).toBe(MANUAL_SCORE_CAP)
    expect(scores['top-polo-marino']).toBe(-MANUAL_SCORE_CAP)
  })

  it('computeTaste la incluye solo con cambios y su peso máximo no supera a una prioritaria', () => {
    expect(computeTaste([], cat).manualScores).toBeUndefined()
    const t = computeTaste([], cat, [{ fromGarmentId: 'top-polo-marino', toGarmentId: 'top-oxford-azul' }])
    expect(t.manualScores).toEqual({ 'top-oxford-azul': 1, 'top-polo-marino': -1 })
    // 4 prendas al tope: ±(4 * cap * peso) sigue por debajo de los 100 puntos de una prioritaria.
    expect(4 * MANUAL_SCORE_CAP * MANUAL_WEIGHT).toBeLessThan(100)
  })

  it('el compositor puntúa mejor las prendas elegidas a mano y peor las quitadas', () => {
    const items = ['top-polo-marino', 'bot-chinos-beige', 'sho-mocasines'].map(get)
    const rank = new Map(wardrobe30.map((g, i) => [g.id, i]))
    const plan = (manualScores: Record<string, number>) =>
      buildPlan(ctxFor('casual', { taste: { formalityBias: 0, dislikedPairs: [], likedGarmentIds: [], ratingCount: 0, manualScores } }))
    const neutral = scoreCombo(plan({}), items, rank)
    expect(scoreCombo(plan({ 'top-polo-marino': 2 }), items, rank)).toBeCloseTo(neutral + 2 * MANUAL_WEIGHT)
    expect(scoreCombo(plan({ 'sho-mocasines': -3 }), items, rank)).toBeCloseTo(neutral - 3 * MANUAL_WEIGHT)
  })
})
