// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MockAiProvider } from '../src/ai/mock'
import { buildTasteUser, TASTE_SUMMARY_MAX_CHARS, tasteResponseSchema } from '../src/ai/prompts/tasteProfile'
import { OCCASION_LABELS, type Garment, type Occasion } from '../src/db'
import {
  buildPlan,
  computeTaste,
  suggestOutfits,
  tasteFormalityRange,
  validateOutfit,
  type EngineContext,
  type SuggestedOutfit,
} from '../src/engine'
import { loadTaste, maybeUpdateTasteProfile, ruleBasedSummary, TASTE_UPDATE_EVERY } from '../src/taste'
import { fakeRepo } from './fixtures/fakeRepo'
import { MILD, TODAY, wardrobe30 } from './fixtures/wardrobe30'

const byId = new Map(wardrobe30.map((g) => [g.id, g]))
const category = (id: string) => byId.get(id)?.category

const ctxFor = (occasion: Occasion, extra: Partial<EngineContext> = {}): EngineContext => ({
  occasion,
  weather: MILD,
  garments: wardrobe30,
  wears: [],
  recentOutfits: [],
  today: TODAY,
  ...extra,
})

/** Formalidad promedio de las prendas que no son accesorios, promediada entre outfits. */
function avgFormality(outfits: { garmentIds: string[] }[]): number {
  const per = outfits.map((o) => {
    const core = o.garmentIds.map((id) => byId.get(id)!).filter((g) => g.category !== 'accessory')
    return core.reduce((s, g) => s + g.formality, 0) / core.length
  })
  return per.reduce((s, v) => s + v, 0) / per.length
}

describe('computeTaste', () => {
  const dislike = (tags: string[], ...ids: string[]) => ({ rating: 'dislike' as const, tags, garmentIds: ids })

  it('sesgo de formalidad a partir de too_formal / too_casual', () => {
    expect(computeTaste([], category).formalityBias).toBe(0)
    const tenFormal = Array.from({ length: 10 }, () => dislike(['too_formal'], 'top-polo-marino'))
    expect(computeTaste(tenFormal, category).formalityBias).toBe(-1)
    // Pocos datos: 3 de 3 «muy formal» da -0.5 (muestra mínima 6).
    expect(computeTaste(tenFormal.slice(0, 3), category).formalityBias).toBe(-0.5)
    const casual = Array.from({ length: 10 }, () => dislike(['too_casual'], 'top-polo-marino'))
    expect(computeTaste(casual, category).formalityBias).toBe(1)
    const mixed = [...tenFormal.slice(0, 5), ...casual.slice(0, 5)]
    expect(computeTaste(mixed, category).formalityBias).toBe(0)
  })

  it('pares con «no me gusta» en ≥ 2 outfits, sin accesorios', () => {
    const t = computeTaste(
      [
        dislike([], 'top-polo-marino', 'bot-jeans-azul', 'acc-reloj'),
        dislike([], 'top-polo-marino', 'bot-jeans-azul', 'sho-mocasines', 'acc-reloj'),
        dislike([], 'top-oxford-azul', 'bot-chinos-beige'),
      ],
      category,
    )
    expect(t.dislikedPairs).toEqual(['bot-jeans-azul|top-polo-marino'])
    expect(t.dislikedPairs.join()).not.toContain('acc-')
  })

  it('prendas con «me gusta» y rango endurecido', () => {
    const t = computeTaste(
      [{ rating: 'like', tags: [], garmentIds: ['top-polo-marino', 'acc-reloj', 'fantasma'] }],
      category,
    )
    expect(t.likedGarmentIds).toEqual(['top-polo-marino'])
    const strict = { ...t, formalityBias: -1 }
    expect(tasteFormalityRange('casual', 'top', strict)).toEqual([1, 2])
    expect(tasteFormalityRange('office', 'bottom', strict)).toEqual([2, 3])
    expect(tasteFormalityRange('plant_work', 'top', strict)).toEqual([1, 2])
    expect(tasteFormalityRange('casual', 'shoes', strict)).toBeNull()
    expect(tasteFormalityRange('gym', 'top', strict)).toBeNull()
    expect(tasteFormalityRange('casual', 'top', { ...t, formalityBias: -0.3 })).toBeNull()
    expect(tasteFormalityRange('casual', 'top', { ...t, formalityBias: 0.8 })).toEqual([3, 4])
  })
})

describe('el gusto en el motor', () => {
  it('rechaza en validación un par con «no me gusta» si hay alternativas, y lo penaliza al componer', async () => {
    const pair = ['top-oxford-azul', 'bot-chinos-beige'] as const
    const taste = { formalityBias: 0, dislikedPairs: [`${pair[0]}|${pair[1]}`.split('|').sort().join('|')], likedGarmentIds: [], ratingCount: 4 }
    const ctx = ctxFor('office', { taste })
    const plan = buildPlan(ctx)
    expect(plan.avoidPairs.size).toBe(1)
    const bad = { garmentIds: [...pair, 'sho-mocasines'] }
    expect(validateOutfit(bad, ctx, { plan })).toMatchObject({ ok: false })
    expect(validateOutfit(bad, ctxFor('office'), {}).ok).toBe(true)
    const res = await suggestOutfits(ctx)
    for (const o of res.outfits) {
      expect(o.garmentIds.includes(pair[0]) && o.garmentIds.includes(pair[1])).toBe(false)
    }
  })

  it('si no hay alternativas, el par no se exige', () => {
    const [tops, bottoms] = [['top-polo-marino'], ['bot-chinos-beige']]
    // Un armario mínimo con una sola combinación posible.
    const garments = wardrobe30.filter((g) => [...tops, ...bottoms, 'sho-mocasines'].includes(g.id))
    const taste = { formalityBias: 0, dislikedPairs: ['bot-chinos-beige|top-polo-marino'], likedGarmentIds: [], ratingCount: 4 }
    const ctx = ctxFor('office', { garments, taste })
    const plan = buildPlan(ctx)
    expect(plan.hasCombos).toBe(true)
    expect(plan.avoidPairs.size).toBe(0)
    expect(validateOutfit({ garmentIds: ['top-polo-marino', 'bot-chinos-beige', 'sho-mocasines'] }, ctx, { plan }).ok).toBe(true)
  })

  it('si el rango endurecido deja sin outfits, se ignora el endurecimiento', async () => {
    const garments = wardrobe30.filter((g) => ['top-oxford-blanca', 'bot-vestir-gris', 'sho-zapatos-vestir'].includes(g.id))
    const taste = { formalityBias: -1, dislikedPairs: [], likedGarmentIds: [], ratingCount: 10 }
    const res = await suggestOutfits(ctxFor('formal_event', { garments, taste }))
    expect(res.outfits).toHaveLength(1)
  })

  it('el estilista recibe el perfil de gusto y hasta 5 ejemplos con atributos', async () => {
    const ai = new MockAiProvider({ json: { outfits: [] } })
    const liked = Array.from({ length: 7 }, () => ({ garmentIds: ['top-polo-marino', 'bot-chinos-beige', 'sho-mocasines'], reasoning: 'ok' }))
    await suggestOutfits(ctxFor('casual', { tasteSummary: 'Prefiere siluetas ajustadas.', likedOutfits: liked }), ai)
    const user = ai.jsonCalls[0].user
    expect(user).toContain('Prefiere siluetas ajustadas.')
    const examples = JSON.parse(user.split('use as inspiration, do not copy):\n')[1].split('\n\n')[0])
    expect(examples).toHaveLength(5)
    expect(examples[0].garments[0]).toMatchObject({ category: 'top', subcategory: 'polo', formality: 3 })
    expect(user).not.toContain('photo')
  })
})

describe('aceptación: tras 10 «no me gusta» por «muy formal» baja la formalidad promedio', () => {
  const GOOD_FORMAL_AI: Record<string, string[][]> = {
    casual: [
      ['top-oxford-azul', 'bot-chinos-beige', 'sho-mocasines'],
      ['top-polo-marino', 'bot-jeans-negros', 'sho-mocasines'],
      ['top-oxford-azul', 'bot-jeans-negros', 'sho-mocasines'],
    ],
    office: [
      ['top-oxford-blanca', 'bot-vestir-gris', 'sho-zapatos-vestir'],
      ['top-camisa-vestir', 'bot-vestir-negro', 'sho-zapatos-vestir'],
      ['top-oxford-blanca', 'bot-vestir-negro', 'sho-zapatos-vestir'],
    ],
  }

  async function dislikeTenFormal(occasion: Occasion) {
    const repo = fakeRepo()
    const shown: { garmentIds: string[]; date: string }[] = []
    let n = 0
    while (n < 10) {
      const res = await suggestOutfits(ctxFor(occasion, { recentOutfits: shown }))
      expect(res.outfits.length).toBeGreaterThan(0)
      for (const o of res.outfits) {
        if (n >= 10) break
        shown.push({ garmentIds: o.garmentIds, date: TODAY })
        const saved = await repo.outfits.create({
          garment_ids: o.garmentIds,
          occasion,
          weather_snapshot: MILD,
          reasoning: o.reasoning,
          source: 'rules',
        })
        await repo.feedback.rate(saved.id, 'dislike', ['too_formal'])
        n++
      }
    }
    return repo
  }

  for (const occasion of ['casual', 'office'] as const) {
    it(`${occasion}: sin IA (reglas)`, async () => {
      const before = await suggestOutfits(ctxFor(occasion))
      expect(before.outfits).toHaveLength(3)
      const repo = await dislikeTenFormal(occasion)
      const taste = await loadTaste(repo, wardrobe30)
      expect(taste.preferences.formalityBias).toBe(-1)
      const after = await suggestOutfits(ctxFor(occasion, { taste: taste.preferences, tasteSummary: taste.summary }))
      expect(after.outfits).toHaveLength(3)
      const [b, a] = [avgFormality(before.outfits), avgFormality(after.outfits)]
      console.log(`[aceptación reglas/${occasion}] formalidad promedio antes=${b.toFixed(2)} después=${a.toFixed(2)}`)
      expect(a).toBeLessThan(b)
    })

    it(`${occasion}: con IA correcta pero formal, el gusto la rechaza y las reglas completan`, async () => {
      const json = { outfits: GOOD_FORMAL_AI[occasion].map((ids) => ({ garment_ids: ids, reasoning: 'Formal y coherente.' })) }
      const ai = new MockAiProvider({ json })
      const before = await suggestOutfits(ctxFor(occasion), ai)
      expect(before.outfits.map((o: SuggestedOutfit) => o.source)).toEqual(['ia', 'ia', 'ia'])
      const repo = await dislikeTenFormal(occasion)
      const taste = await loadTaste(repo, wardrobe30)
      const after = await suggestOutfits(ctxFor(occasion, { taste: taste.preferences }), ai)
      expect(after.outfits).toHaveLength(3)
      expect(after.outfits.every((o) => o.source === 'reglas')).toBe(true)
      const [b, a] = [avgFormality(before.outfits), avgFormality(after.outfits)]
      console.log(`[aceptación IA/${occasion}] formalidad promedio antes=${b.toFixed(2)} después=${a.toFixed(2)}`)
      expect(a).toBeLessThan(b)
    })
  }
})

describe('resumen determinista y perfil de gusto', () => {
  const e = (rating: 'like' | 'dislike', tags: string[]) => ({ rating, tags })

  it('mayoría too_formal produce la frase de formalidad más baja', () => {
    const s = ruleBasedSummary([e('dislike', ['too_formal']), e('dislike', ['too_formal']), e('dislike', ['fit']), e('like', ['comfortable'])])
    expect(s).toContain('Prefiere un nivel de formalidad más bajo de lo que sugiere la ocasión.')
    expect(ruleBasedSummary([e('dislike', ['too_casual']), e('dislike', ['too_casual'])])).toContain('más alto')
    expect(ruleBasedSummary([])).toContain('Todavía no hay calificaciones')
    expect(ruleBasedSummary([e('like', [])])).toContain('Aún no hay un patrón')
    expect(ruleBasedSummary([e('like', ['comfortable']), e('like', ['comfortable'])])).toContain('la comodidad')
  })

  async function ratedRepo(n: number, tags = ['too_formal']) {
    const repo = fakeRepo()
    for (let i = 0; i < n; i++) {
      const o = await repo.outfits.create({
        garment_ids: ['top-oxford-blanca', 'bot-vestir-gris', 'sho-zapatos-vestir'],
        occasion: 'casual',
        weather_snapshot: MILD,
        reasoning: `r${i}`,
        source: 'rules',
      })
      await repo.feedback.rate(o.id, 'dislike', tags, '', new Date(Date.UTC(2026, 10, 1, 0, 0, i)))
    }
    return repo
  }

  it('se actualiza solo cada 10 calificaciones nuevas', async () => {
    const repo = await ratedRepo(9)
    expect(await maybeUpdateTasteProfile(repo)).toBeNull()
    expect(await repo.taste.get()).toBeNull()
    const o = await repo.outfits.create({ garment_ids: ['top-polo-marino'], occasion: 'casual', weather_snapshot: null, reasoning: '', source: 'rules' })
    await repo.feedback.rate(o.id, 'dislike', ['too_formal'])
    const first = await maybeUpdateTasteProfile(repo)
    expect(first).toContain('formalidad más bajo')
    const saved = await repo.taste.get()
    expect(saved?.summary).toBe(first)
    // Nueva ronda: 9 más no bastan, la 10.ª sí.
    for (let i = 0; i < 9; i++) {
      const x = await repo.outfits.create({ garment_ids: ['top-polo-marino'], occasion: 'casual', weather_snapshot: null, reasoning: '', source: 'rules' })
      await repo.feedback.rate(x.id, 'dislike', ['colors'], '', new Date(Date.now() + 1000 + i))
    }
    expect(await maybeUpdateTasteProfile(repo)).toBeNull()
    const y = await repo.outfits.create({ garment_ids: ['top-polo-marino'], occasion: 'casual', weather_snapshot: null, reasoning: '', source: 'rules' })
    await repo.feedback.rate(y.id, 'dislike', ['colors'], '', new Date(Date.now() + 5000))
    expect(await maybeUpdateTasteProfile(repo)).not.toBeNull()
    expect((await repo.taste.get())!.updatedAt >= saved!.updatedAt).toBe(true)
  })

  it('con IA usa su resumen (≤ 600 caracteres) y envía solo atributos', async () => {
    const repo = await ratedRepo(TASTE_UPDATE_EVERY)
    const ai = new MockAiProvider({ json: { summary: 'x'.repeat(900) } })
    const s = await maybeUpdateTasteProfile(repo, ai)
    expect(s).toHaveLength(TASTE_SUMMARY_MAX_CHARS)
    expect(ai.jsonCalls).toHaveLength(1)
    const user = ai.jsonCalls[0].user
    expect(user).toContain('too_formal')
    expect(user).toContain('camisa oxford')
    expect(user.toLowerCase()).not.toContain('photo')
    expect(user).not.toContain('top-oxford-blanca')
  })

  it('si la IA falla usa el resumen por reglas', async () => {
    const repo = await ratedRepo(TASTE_UPDATE_EVERY)
    const ai = new MockAiProvider({ error: new Error('boom') })
    expect(await maybeUpdateTasteProfile(repo, ai)).toContain('formalidad más bajo')
  })

  it('«Reiniciar gusto» borra el perfil y las calificaciones anteriores dejan de influir', async () => {
    const repo = await ratedRepo(TASTE_UPDATE_EVERY)
    await maybeUpdateTasteProfile(repo)
    expect((await loadTaste(repo, wardrobe30)).preferences.formalityBias).toBe(-1)
    await repo.taste.reset(new Date(Date.UTC(2027, 0, 1)))
    const t = await loadTaste(repo, wardrobe30)
    expect(t.summary).toBe('')
    expect(t.preferences.formalityBias).toBe(0)
    expect((await repo.feedback.listRecent(100)).length).toBe(TASTE_UPDATE_EVERY)
  })

  it('el prompt no contiene campos de foto ni ids', () => {
    const user = buildTasteUser({
      ratings: [
        {
          rating: 'dislike',
          tags: ['too_formal'],
          comment: 'muy de oficina',
          occasion: OCCASION_LABELS.casual,
          // Si alguien pasara una prenda completa, solo salen los atributos.
          garments: [{ ...(wardrobe30[0] as Garment) }],
        },
      ],
      previousSummary: 'Prefiere neutros.',
    })
    expect(user).not.toMatch(/photo|photo_path|"id"|notes/)
    expect(user).toContain('muy de oficina')
    expect(user).toContain('Prefiere neutros.')
    expect(tasteResponseSchema.safeParse({ summary: '' }).success).toBe(false)
  })
})
