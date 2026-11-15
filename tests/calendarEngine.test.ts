// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Category, Garment } from '../src/db/types'
import {
  buildPlan,
  composeFallback,
  PLANNED_GARMENT_PENALTY,
  PLANNED_PENALTY_CAP,
  PLANNED_WINDOW_DAYS,
  plannedPenalty,
  scoreCombo,
  suggestOutfits,
  validateOutfit,
  type EngineContext,
} from '../src/engine'
import { addDays } from '../src/lib/date'
import { MILD, TODAY, wardrobe30 } from './fixtures/wardrobe30'

const keyOf = (ids: string[]) => [...ids].sort().join('|')
const ctxFor = (extra: Partial<EngineContext> = {}): EngineContext => ({
  occasion: 'casual',
  weather: MILD,
  garments: wardrobe30,
  wears: [],
  recentOutfits: [],
  today: TODAY,
  ...extra,
})

describe('outfits planeados en el motor (fase 13b)', () => {
  it('un combo planeado a ±2 días no se vuelve a sugerir ni valida; a 3 días sí', async () => {
    const base = await suggestOutfits(ctxFor())
    expect(base.outfits.length).toBe(3)
    const first = base.outfits[0].garmentIds
    for (const offset of [-2, -1, 0, 1, 2]) {
      const ctx = ctxFor({ plannedOutfits: [{ garmentIds: first, date: addDays(TODAY, offset) }] })
      const res = await suggestOutfits(ctx)
      expect(res.outfits.map((o) => keyOf(o.garmentIds.filter((id) => wardrobe30.find((g) => g.id === id)!.category !== 'accessory'))))
        .not.toContain(keyOf(first.filter((id) => wardrobe30.find((g) => g.id === id)!.category !== 'accessory')))
      const verdict = validateOutfit({ garmentIds: first }, ctx)
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.errors.join(' ')).toMatch(/already planned within 2 days/)
    }
    for (const offset of [-3, 3, 10]) {
      const ctx = ctxFor({ plannedOutfits: [{ garmentIds: first, date: addDays(TODAY, offset) }] })
      expect(validateOutfit({ garmentIds: first }, ctx).ok).toBe(true)
      expect(buildPlan(ctx).plannedKeys.size).toBe(0)
    }
    expect(PLANNED_WINDOW_DAYS).toBe(2)
  })

  it('el orden de las prendas y los accesorios no cambian la clave de lo planeado', () => {
    const ids = ['top-oxford-azul', 'bot-chinos-beige', 'sho-mocasines', 'acc-reloj']
    const plan = buildPlan(ctxFor({ plannedOutfits: [{ garmentIds: [...ids].reverse(), date: TODAY }] }))
    expect(plan.plannedKeys.size).toBe(1)
    expect(plan.recentKeys.size).toBe(1)
  })
})

describe('penalización blanda por prendas ya planeadas', () => {
  const mk = (id: string, category: Category): Garment => ({
    id,
    photo_path: null,
    category,
    subcategory: id,
    colors: ['gris'],
    pattern: 'liso',
    material: 'algodón',
    fit: 'regular',
    formality: 3,
    warmth: 2,
    occasions: ['casual'],
    is_statement: false,
    status: 'active',
    notes: '',
    created_at: '2026-01-01T00:00:00.000Z',
  })
  const small = [mk('t1', 'top'), mk('t2', 'top'), mk('b1', 'bottom'), mk('b2', 'bottom'), mk('s1', 'shoes')]
  const get = (id: string) => small.find((g) => g.id === id)!

  it('prefiere las prendas que no están planeadas en días cercanos', () => {
    const ctx = ctxFor({ garments: small, plannedOutfits: [{ garmentIds: ['t1', 'b1', 's1'], date: addDays(TODAY, 1) }] })
    const plan = buildPlan(ctx)
    // Todas son prioritarias (nunca usadas): la penalización decide.
    const best = composeFallback(plan, 1)[0]
    expect(keyOf(best.garmentIds)).toBe(keyOf(['t2', 'b2', 's1']))
    const rank = new Map(plan.rotation.order.map((id, i) => [id, i]))
    const clean = scoreCombo(plan, ['t2', 'b2', 's1'].map(get), rank)
    const dirty = scoreCombo(plan, ['t1', 'b2', 's1'].map(get), rank)
    expect(clean).toBeGreaterThan(dirty)
  })

  it('sin planes cercanos no hay penalización', () => {
    const plan = buildPlan(ctxFor({ garments: small, plannedOutfits: [{ garmentIds: ['t1', 'b1', 's1'], date: addDays(TODAY, 5) }] }))
    expect(plannedPenalty(plan, small)).toBe(0)
    expect(plan.plannedUse.size).toBe(0)
  })

  it('la penalización está acotada: no pasa de PLANNED_PENALTY_CAP aunque la prenda esté en muchos planes', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ garmentIds: ['t1', 'b1', 's1', `x${i}`], date: addDays(TODAY, (i % 5) - 2) }))
    const plan = buildPlan(ctxFor({ garments: small, plannedOutfits: many }))
    expect(plan.plannedUse.get('t1')).toBe(5)
    const penalty = plannedPenalty(plan, ['t1', 'b1', 's1'].map(get))
    expect(penalty).toBe(PLANNED_PENALTY_CAP)
    expect(PLANNED_PENALTY_CAP).toBeLessThan(100) // una prenda prioritaria pesa 100
    // Una sola aparición pesa PLANNED_GARMENT_PENALTY por prenda.
    const one = buildPlan(ctxFor({ garments: small, plannedOutfits: [{ garmentIds: ['t1'], date: TODAY }] }))
    expect(plannedPenalty(one, [get('t1')])).toBe(PLANNED_GARMENT_PENALTY)
  })

  it('no rompe la validación: una combinación con prendas planeadas sigue siendo válida', () => {
    const ctx = ctxFor({ garments: small, plannedOutfits: [{ garmentIds: ['t1', 'b1', 's1'], date: addDays(TODAY, 1) }] })
    expect(validateOutfit({ garmentIds: ['t1', 'b2', 's1'] }, ctx).ok).toBe(true)
  })

  it('los accesorios no cuentan para la penalización', () => {
    const withAcc = [...small, mk('a1', 'accessory')]
    const plan = buildPlan(ctxFor({ garments: withAcc, plannedOutfits: [{ garmentIds: ['t1', 'b1', 's1', 'a1'], date: TODAY }] }))
    expect(plan.plannedUse.has('a1')).toBe(false)
  })
})
