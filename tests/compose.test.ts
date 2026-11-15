// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiNetworkError } from '../src/ai/errors'
import { MockAiProvider } from '../src/ai/mock'
import { OCCASIONS, type Occasion } from '../src/db/types'
import { buildPlan, suggestOutfits, validateOutfit, type EngineContext, type Weather } from '../src/engine'
import { COLD, HOT, MILD, RAINY, TODAY, wardrobe30 } from './fixtures/wardrobe30'

const fetchSpy = vi.fn()
beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

const ctxFor = (occasion: Occasion, weather: Weather, extra: Partial<EngineContext> = {}): EngineContext => ({
  occasion,
  weather,
  garments: wardrobe30,
  wears: [],
  recentOutfits: [],
  today: TODAY,
  ...extra,
})

const weathers = { hot: HOT, mild: MILD, cold: COLD } as const

describe('aceptación: 3 outfits válidos por ocasión y clima (armario de 30)', () => {
  for (const occasion of OCCASIONS) {
    for (const [name, weather] of Object.entries(weathers)) {
      it(`${occasion} / ${name}: sin IA`, async () => {
        const ctx = ctxFor(occasion, weather)
        const res = await suggestOutfits(ctx)
        expect(res.outfits).toHaveLength(3)
        expect(res.source).toBe('reglas')
        const plan = buildPlan(ctx)
        res.outfits.forEach((o, i) => {
          expect(o.source).toBe('reglas')
          expect(o.reasoning.length).toBeGreaterThan(10)
          expect(validateOutfit(o, ctx, { plan, batch: res.outfits.filter((_, j) => j !== i) })).toEqual({ ok: true })
        })
        expect(fetchSpy).not.toHaveBeenCalled()
      })

      it(`${occasion} / ${name}: IA con basura o inválida cae a reglas`, async () => {
        const ctx = ctxFor(occasion, weather)
        for (const json of [
          { nope: 1 },
          { outfits: [{ garment_ids: ['fantasma'], reasoning: 'x' }] },
          { outfits: [{ garment_ids: ['top-playera-blanca'], reasoning: 'incompleto' }] },
        ]) {
          const ai = new MockAiProvider({ json })
          const res = await suggestOutfits(ctx, ai)
          expect(res.outfits).toHaveLength(3)
          expect(res.outfits.every((o) => o.source === 'reglas')).toBe(true)
          const plan = buildPlan(ctx)
          for (const o of res.outfits) expect(validateOutfit(o, ctx, { plan }).ok).toBe(true)
          expect(fetchSpy).not.toHaveBeenCalled()
        }
      })
    }
  }
})

describe('suggestOutfits con IA', () => {
  it('usa una respuesta buena de la IA', async () => {
    const ctx = ctxFor('office', MILD)
    // Se pide primero al respaldo por reglas qué combinaciones son válidas y se devuelven como "IA".
    const base = await suggestOutfits(ctx)
    const json = { outfits: base.outfits.map((o) => ({ garment_ids: o.garmentIds, reasoning: `IA: ${o.reasoning}` })) }
    const ai = new MockAiProvider({ json })
    const res = await suggestOutfits(ctx, ai)
    expect(res.source).toBe('ia')
    expect(res.outfits.map((o) => o.source)).toEqual(['ia', 'ia', 'ia'])
    expect(res.outfits[0].reasoning.startsWith('IA:')).toBe(true)
    expect(ai.jsonCalls).toHaveLength(1)
    expect(res.warnings).toEqual([])
  })

  it('solo envía atributos: sin fotos ni rutas de foto', async () => {
    const ctx = ctxFor('casual', MILD, {
      garments: wardrobe30.map((x) => ({ ...x, photo_path: 'photo:secreto-123' })),
    })
    const ai = new MockAiProvider({ json: { outfits: [{ garment_ids: ['x'], reasoning: 'x' }] } })
    await suggestOutfits(ctx, ai)
    const req = ai.jsonCalls[0]
    expect(req.images).toBeUndefined()
    expect(req.user).not.toContain('photo')
    expect(req.user).not.toContain('secreto')
    expect(req.user).toContain('"candidates"')
    expect(req.system).toContain('statement')
  })

  it('reintenta una vez con los errores y completa con reglas', async () => {
    const ctx = ctxFor('office', MILD)
    const good = (await suggestOutfits(ctx)).outfits[0]
    const bad = { garment_ids: [good.garmentIds[0], 'fantasma'], reasoning: 'malo' }
    const ai = new MockAiProvider({ json: { outfits: [{ garment_ids: good.garmentIds, reasoning: 'bueno' }, bad, bad] } })
    const res = await suggestOutfits(ctx, ai)
    expect(ai.jsonCalls).toHaveLength(2)
    expect(ai.jsonCalls[1].user).toContain('rejected by validation')
    expect(ai.jsonCalls[1].user).toContain('Unknown garment id "fantasma"')
    expect(res.outfits).toHaveLength(3)
    expect(res.outfits.filter((o) => o.source === 'ia')).toHaveLength(1)
    expect(res.source).toBe('ia')
    expect(res.warnings.join(' ')).toMatch(/completaron con reglas/)
  })

  it('si la IA falla usa reglas y avisa en español', async () => {
    const ai = new MockAiProvider({ error: new AiNetworkError() })
    const res = await suggestOutfits(ctxFor('casual', MILD), ai)
    expect(res.outfits).toHaveLength(3)
    expect(res.source).toBe('reglas')
    expect(res.warnings.join(' ')).toMatch(/No se pudo conectar con la IA/)
    expect(ai.jsonCalls).toHaveLength(1)
  })
})

describe('casos límite', () => {
  it('armario vacío: sin outfits y explica qué falta', async () => {
    const res = await suggestOutfits(ctxFor('office', MILD, { garments: [] }))
    expect(res.outfits).toEqual([])
    expect(res.warnings).toEqual(
      expect.arrayContaining([
        'No tienes prendas superiores aptas para oficina.',
        'No tienes prendas inferiores aptas para oficina.',
        'No tienes calzado apto para oficina.',
      ]),
    )
  })

  it('sin calzado apto para oficina', async () => {
    const garments = wardrobe30.filter((x) => x.category !== 'shoes' || x.formality <= 2)
    const res = await suggestOutfits(ctxFor('office', MILD, { garments }))
    expect(res.outfits).toEqual([])
    expect(res.warnings).toContain('No tienes calzado apto para oficina.')
  })

  it('todo en lavandería', async () => {
    const garments = wardrobe30.map((x) => ({ ...x, status: 'laundry' as const }))
    const ai = new MockAiProvider({ json: { outfits: [{ garment_ids: ['x'], reasoning: 'x' }] } })
    const res = await suggestOutfits(ctxFor('casual', MILD, { garments }), ai)
    expect(res.outfits).toEqual([])
    expect(res.warnings.length).toBeGreaterThan(0)
    expect(ai.jsonCalls).toHaveLength(0)
  })

  it('frío sin capa exterior apta', async () => {
    const garments = wardrobe30.filter((x) => x.category !== 'outerwear')
    const res = await suggestOutfits(ctxFor('casual', COLD, { garments }))
    expect(res.outfits).toEqual([])
    expect(res.warnings).toContain('No tienes capa exterior apta para este frío.')
  })

  it('con lluvia exige capa exterior', async () => {
    const res = await suggestOutfits(ctxFor('casual', RAINY))
    expect(res.outfits).toHaveLength(3)
    for (const o of res.outfits) {
      expect(o.garmentIds.some((id) => id.startsWith('out-'))).toBe(true)
    }
  })

  it('lluvia sin capa apta: sugiere igual y advierte', async () => {
    const garments = wardrobe30.filter((x) => x.category !== 'outerwear')
    const res = await suggestOutfits(ctxFor('casual', RAINY, { garments }))
    expect(res.outfits).toHaveLength(3)
    expect(res.warnings.join(' ')).toMatch(/lluvia/)
  })

  it('"otras opciones": excluye combinaciones ya mostradas', async () => {
    const ctx = ctxFor('casual', MILD)
    const first = await suggestOutfits(ctx)
    const second = await suggestOutfits({
      ...ctx,
      recentOutfits: first.outfits.map((o) => ({ garmentIds: o.garmentIds, date: TODAY })),
    })
    const keys = (r: typeof first) => r.outfits.map((o) => o.garmentIds.filter((id) => !id.startsWith('acc-')).sort().join())
    expect(second.outfits).toHaveLength(3)
    for (const k of keys(second)) expect(keys(first)).not.toContain(k)
  })

  it('rápido con más de 100 prendas', async () => {
    const big = Array.from({ length: 4 }, (_, i) =>
      wardrobe30.map((x) => ({ ...x, id: `${x.id}-${i}`, created_at: x.created_at.replace('2026', `20${10 + i}`) })),
    ).flat()
    expect(big.length).toBeGreaterThan(100)
    const t = performance.now()
    const res = await suggestOutfits(ctxFor('casual', MILD, { garments: big }))
    expect(performance.now() - t).toBeLessThan(2000)
    expect(res.outfits).toHaveLength(3)
  })
})
