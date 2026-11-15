// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Garment } from '../src/db/types'
import {
  buildPlan,
  composeFallback,
  filterGarments,
  formalityRange,
  isNeutral,
  nonNeutralColors,
  OCCASION_RULES,
  rankByRotation,
  rotationScores,
  validateOutfit,
  weatherBand,
  type EngineContext,
} from '../src/engine'
import { COLD, HOT, MILD, RAINY, TODAY, wardrobe30 } from './fixtures/wardrobe30'

const byId = (id: string) => wardrobe30.find((g) => g.id === id)!
const ids = (list: Garment[]) => list.map((g) => g.id)
const ctx = (over: Partial<EngineContext> = {}): EngineContext => ({
  occasion: 'office',
  weather: MILD,
  garments: wardrobe30,
  wears: [],
  recentOutfits: [],
  today: TODAY,
  ...over,
})

describe('occasions', () => {
  it('tiene la tabla de formalidad de la especificación', () => {
    expect(OCCASION_RULES.plant_work.formality).toEqual([1, 3])
    expect(OCCASION_RULES.office.formality).toEqual([3, 4])
    expect(OCCASION_RULES.gym.formality).toEqual([1, 1])
    expect(OCCASION_RULES.casual.formality).toEqual([2, 3])
    expect(OCCASION_RULES.date.formality).toEqual([3, 4])
    expect(OCCASION_RULES.formal_event.formality).toEqual([4, 5])
  })
  it('gym relaja calzado y capa exterior; accesorios tienen margen ±1', () => {
    expect(formalityRange('gym', 'shoes')).toEqual([1, 2])
    expect(formalityRange('gym', 'outerwear')).toEqual([1, 2])
    expect(formalityRange('gym', 'top')).toEqual([1, 1])
    expect(formalityRange('office', 'accessory')).toEqual([2, 5])
  })
})

describe('filterGarments (paso 1)', () => {
  it('quita lavandería, retiradas y candidatas', () => {
    const garments = wardrobe30.map((g) =>
      g.id === 'top-oxford-azul' ? { ...g, status: 'laundry' as const }
      : g.id === 'top-polo-marino' ? { ...g, status: 'retired' as const }
      : g.id === 'top-camisa-vestir' ? { ...g, status: 'candidate' as const }
      : g,
    )
    const r = filterGarments(ctx({ garments }))
    expect(r.eligibleIds.has('top-oxford-azul')).toBe(false)
    expect(r.eligibleIds.has('top-polo-marino')).toBe(false)
    expect(r.eligibleIds.has('top-camisa-vestir')).toBe(false)
    expect(r.eligibleIds.has('top-oxford-blanca')).toBe(true)
  })

  it('bandas de clima', () => {
    expect(weatherBand(HOT).outerwearAdvice).toBe('none')
    expect(weatherBand({ ...HOT, tempC: 27 }).top).toEqual([1, 3])
    expect(weatherBand(MILD).outerwearAdvice).toBe('optional')
    expect(weatherBand({ ...MILD, tempC: 15 }).outerwearAdvice).toBe('recommended')
    expect(weatherBand(COLD).outerwearAdvice).toBe('required')
    // La sensación térmica manda sobre la temperatura.
    expect(weatherBand({ ...MILD, feelsLikeC: 8 }).outerwearAdvice).toBe('required')
  })

  it('calor: solo prendas ligeras; calzado sin filtro de clima', () => {
    const r = filterGarments(ctx({ occasion: 'plant_work', weather: HOT }))
    expect(ids(r.bySlot.top).every((id) => byId(id).warmth <= 2)).toBe(true)
    expect(r.eligibleIds.has('bot-jeans-azul')).toBe(false)
    expect(r.eligibleIds.has('sho-botas-trabajo')).toBe(true)
    expect(r.needsOuterwear).toBe(false)
  })

  it('frío: capa exterior obligatoria con abrigo 3-5', () => {
    const r = filterGarments(ctx({ occasion: 'casual', weather: COLD }))
    expect(r.needsOuterwear).toBe(true)
    expect(ids(r.bySlot.outerwear).sort()).toEqual(['out-chamarra-mezclilla', 'out-rompevientos'])
    expect(r.eligibleIds.has('top-playera-blanca')).toBe(false)
  })

  it('lluvia marca capa exterior si hay una apta; si no, solo advierte', () => {
    const r = filterGarments(ctx({ occasion: 'casual', weather: RAINY }))
    expect(r.needsOuterwear).toBe(true)
    const none = filterGarments(ctx({ occasion: 'casual', weather: RAINY, garments: wardrobe30.filter((g) => g.category !== 'outerwear') }))
    expect(none.needsOuterwear).toBe(false)
    expect(none.warnings).toHaveLength(1)
  })

  it('formalidad: rango de la ocasión o garment.occasions la incluye', () => {
    const r = filterGarments(ctx({ occasion: 'gym', weather: MILD }))
    expect(r.eligibleIds.has('top-playera-dryfit-ml')).toBe(true)
    expect(r.eligibleIds.has('top-oxford-blanca')).toBe(false)
    // sudadera formalidad 2 pero etiquetada gym
    const cold = filterGarments(ctx({ occasion: 'gym', weather: COLD }))
    expect(cold.eligibleIds.has('top-sudadera-gris')).toBe(true)
    // calzado de formalidad 2 permitido en gym (relajado)
    expect(r.eligibleIds.has('sho-tenis-blancos')).toBe(true)
    expect(r.eligibleIds.has('sho-mocasines')).toBe(false)
  })

  it('reporta espacios faltantes en español', () => {
    const r = filterGarments(ctx({ garments: [] }))
    expect(r.missing).toHaveLength(3)
    const noShoes = filterGarments(ctx({ garments: wardrobe30.filter((g) => g.category !== 'shoes') }))
    expect(noShoes.missing).toEqual(['No tienes calzado apto para oficina.'])
    const weatherCaused = filterGarments(ctx({ occasion: 'casual', weather: COLD, garments: wardrobe30.filter((g) => g.id !== 'top-sueter-cafe' && g.id !== 'top-sudadera-gris' && g.id !== 'top-oxford-azul' && g.id !== 'top-polo-marino' && g.id !== 'top-oxford-blanca' && g.id !== 'top-camisa-vestir') }))
    expect(weatherCaused.missing[0]).toBe('No tienes prendas superiores aptas para casual con este clima.')
  })
})

describe('rotation (paso 2)', () => {
  const mk = (id: string, category: Garment['category'], created: string): Garment => ({
    ...byId('top-playera-blanca'), id, category, created_at: created,
  })

  it('nunca usadas puntúan más; desempate por la más antigua', () => {
    const a = mk('a', 'top', '2026-01-01T00:00:00Z')
    const b = mk('b', 'top', '2026-06-01T00:00:00Z')
    const c = mk('c', 'top', '2026-02-01T00:00:00Z')
    const scores = rotationScores([a, b, c], [{ garmentIds: ['c'], date: '2026-11-10' }], TODAY)
    expect(scores.get('a')!.score).toBeGreaterThan(scores.get('b')!.score)
    expect(scores.get('b')!.score).toBeGreaterThan(scores.get('c')!.score)
    expect(scores.get('c')).toMatchObject({ wears: 1, daysSinceWorn: 4 })
    expect(scores.get('a')).toMatchObject({ wears: 0, daysSinceWorn: null })
  })

  it('más días sin usar y menos usos puntúan más', () => {
    const a = mk('a', 'top', '2026-01-01T00:00:00Z')
    const b = mk('b', 'top', '2026-01-01T00:00:00Z')
    const s = rotationScores([a, b], [
      { garmentIds: ['a'], date: '2026-10-01' }, { garmentIds: ['b'], date: '2026-10-20' }, { garmentIds: ['b'], date: '2026-11-01' },
    ], TODAY)
    expect(s.get('a')!.score).toBeGreaterThan(s.get('b')!.score)
  })

  it('sin usos: todo es prioritario (accesorios no cuentan)', () => {
    const r = rankByRotation(wardrobe30, [], TODAY)
    expect(r.order[0]).toBe('top-playera-blanca') // la más antigua
    for (const g of wardrobe30) expect(r.priorityIds.has(g.id)).toBe(g.category !== 'accessory')
  })

  it('con usos: el tercio menos usado de cada espacio, al menos 1', () => {
    const tops = wardrobe30.filter((g) => g.category === 'top')
    const wears = tops.slice(0, 7).map((g) => ({ garmentIds: [g.id], date: '2026-11-05' }))
    const r = rankByRotation(tops, wears, TODAY)
    expect(r.priorityIds.size).toBe(Math.ceil(tops.length / 3))
    for (const g of tops.slice(7)) expect(r.priorityIds.has(g.id)).toBe(true)
    const one = rankByRotation([tops[0]], [{ garmentIds: [tops[0].id], date: '2026-10-01' }], TODAY)
    expect(one.priorityIds.size).toBe(1)
  })

  it('las usadas en los últimos 2 días nunca son prioritarias', () => {
    const tops = wardrobe30.filter((g) => g.category === 'top').slice(0, 3)
    // a: hoy, b: hace 2 días, c: hace 3 días; el tercio menos usado es 1 prenda.
    const wears = [
      { garmentIds: [tops[0].id], date: TODAY },
      { garmentIds: [tops[1].id], date: '2026-11-12' },
      { garmentIds: [tops[2].id], date: '2026-11-11' },
    ]
    const r = rankByRotation(tops, wears, TODAY)
    expect(r.priorityIds.has(tops[0].id)).toBe(false)
    expect(r.priorityIds.has(tops[1].id)).toBe(false)
    expect(r.priorityIds.has(tops[2].id)).toBe(true)
    // Si el único candidato del espacio se usó ayer, no hay prioritarias en ese espacio.
    const one = rankByRotation([tops[0]], [{ garmentIds: [tops[0].id], date: '2026-11-13' }], TODAY)
    expect(one.priorityIds.size).toBe(0)
  })

  it('lista vacía', () => {
    const r = rankByRotation([], [], TODAY)
    expect(r.order).toEqual([])
    expect(r.priorityIds.size).toBe(0)
  })
})

describe('validateOutfit (paso 4)', () => {
  const good = ['top-oxford-azul', 'bot-chinos-beige', 'sho-mocasines']
  const run = (garmentIds: string[], c = ctx(), batch: { garmentIds: string[]; reasoning: string }[] = []) =>
    validateOutfit({ garmentIds }, c, { batch })
  const errs = (r: ReturnType<typeof run>) => (r.ok ? [] : r.errors.join(' | '))

  it('acepta un outfit correcto, con y sin accesorios', () => {
    expect(run(good)).toEqual({ ok: true })
    expect(run([...good, 'acc-reloj', 'acc-cinturon-cafe'])).toEqual({ ok: true })
  })
  it('ids desconocidos, duplicados y no elegibles', () => {
    expect(errs(run([...good, 'nada']))).toMatch(/Unknown garment id "nada"/)
    expect(errs(run([...good, good[0]]))).toMatch(/Duplicate/)
    expect(errs(run(['top-playera-dryfit', 'bot-chinos-beige', 'sho-mocasines']))).toMatch(/not eligible/)
  })
  it('exige un superior, un inferior y un calzado', () => {
    expect(errs(run(['top-oxford-azul', 'sho-mocasines']))).toMatch(/one bottom/)
    expect(errs(run(['top-oxford-azul', 'top-polo-marino', 'bot-chinos-beige', 'sho-mocasines']))).toMatch(/one top/)
    expect(errs(run(['top-oxford-azul', 'bot-chinos-beige']))).toMatch(/shoes/)
  })
  it('capa exterior: máximo una y obligatoria con frío', () => {
    const cold = ctx({ occasion: 'casual', weather: COLD })
    const base = ['top-sueter-cafe', 'bot-jeans-negros', 'sho-mocasines']
    expect(errs(run(base, cold))).toMatch(/outerwear piece is required/)
    expect(run([...base, 'out-chamarra-mezclilla'], cold)).toEqual({ ok: true })
    expect(errs(run([...base, 'out-chamarra-mezclilla', 'out-rompevientos'], cold))).toMatch(/At most one outerwear/)
  })
  it('accesorios: máximo 2 y formalidad cercana', () => {
    expect(errs(run([...good, 'acc-reloj', 'acc-cinturon-cafe', 'acc-cinturon-negro']))).toMatch(/At most 2 accessories/)
    // gorra (formalidad 1) con outfit de 3 -> fuera de ±1 y además no elegible en office por rango (2-5): se rechaza
    expect(run([...good, 'acc-gorra']).ok).toBe(false)
    const casual = ctx({ occasion: 'casual', weather: HOT })
    expect(errs(run(['top-playera-blanca', 'bot-shorts-caqui', 'sho-tenis-blancos', 'acc-cinturon-negro'], casual))).toMatch(/Accessory "acc-cinturon-negro"/)
  })
  it('dispersión de formalidad ≤ 1', () => {
    const plant = ctx({ occasion: 'plant_work', weather: MILD })
    expect(errs(run(['top-playera-dryfit-ml', 'bot-chinos-beige', 'sho-mocasines'], plant))).toMatch(/spread/)
  })
  it('máximo una prenda protagonista', () => {
    const c = ctx({ occasion: 'casual', weather: { ...HOT, tempC: 27 } })
    expect(errs(run(['top-playera-estampada', 'bot-jeans-azul', 'sho-tenis-blancos', 'out-rompevientos'], c))).toMatch(/statement/)
  })
  it('incluye al menos una prioritaria si existe alguna', () => {
    const unworn = ['top-oxford-blanca', 'bot-vestir-gris', 'sho-zapatos-vestir']
    const wears = [{ garmentIds: wardrobe30.map((g) => g.id).filter((id) => !unworn.includes(id)), date: '2026-11-13' }]
    const c = ctx({ wears })
    const plan = buildPlan(c)
    expect(plan.priorityIds.size).toBeGreaterThan(0)
    expect(errs(run(good, c))).toMatch(/priority/)
  })
  it('no repite outfits de los últimos 14 días ni del mismo lote', () => {
    const recent = ctx({ recentOutfits: [{ garmentIds: [...good, 'acc-reloj'], date: '2026-11-05' }] })
    expect(errs(run(good, recent))).toMatch(/last 14 days/)
    const old = ctx({ recentOutfits: [{ garmentIds: good, date: '2026-10-01' }] })
    expect(run(good, old)).toEqual({ ok: true })
    expect(errs(run(good, ctx(), [{ garmentIds: [...good].reverse(), reasoning: '' }]))).toMatch(/same answer/)
    // distinto accesorio = mismo outfit
    expect(errs(run([...good, 'acc-reloj'], ctx(), [{ garmentIds: good, reasoning: '' }]))).toMatch(/same answer/)
  })
})

describe('fallback', () => {
  it('colores: neutros y límite de tonos', () => {
    expect(['negro', 'Blanco', 'gris claro', 'azul marino', 'café', 'cafe', 'crema', 'beige'].every(isNeutral)).toBe(true)
    expect(isNeutral('azul')).toBe(false)
    expect(isNeutral('rojo')).toBe(false)
    expect([...nonNeutralColors([byId('top-playera-estampada'), byId('out-rompevientos'), byId('bot-jeans-azul')])].sort()).toEqual(['amarillo', 'azul', 'rojo'])
  })

  it('devuelve hasta 3 outfits distintos y válidos', () => {
    const c = ctx({ occasion: 'casual' })
    const plan = buildPlan(c)
    const out = composeFallback(plan, 3)
    expect(out).toHaveLength(3)
    expect(new Set(out.map((o) => o.garmentIds.join())).size).toBe(3)
    for (const o of out) expect(validateOutfit(o, c, { plan }).ok).toBe(true)
  })

  it('es determinista', () => {
    const plan = buildPlan(ctx({ occasion: 'casual' }))
    expect(composeFallback(plan, 3)).toEqual(composeFallback(plan, 3))
  })

  it('respeta lo ya elegido en el lote', () => {
    const plan = buildPlan(ctx({ occasion: 'casual' }))
    const first = composeFallback(plan, 1)
    const more = composeFallback(plan, 2, first)
    expect(more.map((o) => o.garmentIds.join())).not.toContain(first[0].garmentIds.join())
  })

  it('prioriza las prendas menos usadas', () => {
    const tops = wardrobe30.filter((g) => g.category === 'top' && g.id !== 'top-polo-marino').map((g) => g.id)
    const c = ctx({ occasion: 'office', wears: [{ garmentIds: tops, date: '2026-11-13' }] })
    const plan = buildPlan(c)
    expect(plan.priorityIds.has('top-polo-marino')).toBe(true)
    const out = composeFallback(plan, 3)
    expect(out.length).toBeGreaterThan(0)
    for (const o of out) expect(o.garmentIds.some((id) => plan.priorityIds.has(id))).toBe(true)
  })

  it('a lo más un protagonista, a lo más 3 colores no neutros', () => {
    for (const occasion of ['casual', 'plant_work', 'gym'] as const) {
      const c = ctx({ occasion, weather: MILD })
      for (const o of composeFallback(buildPlan(c), 3)) {
        const items = o.garmentIds.map(byId)
        expect(items.filter((g) => g.is_statement).length).toBeLessThanOrEqual(1)
        expect(nonNeutralColors(items).size).toBeLessThanOrEqual(3)
      }
    }
  })

  it('vacío si falta un espacio o no hay combinaciones', () => {
    expect(composeFallback(buildPlan(ctx({ garments: [] })), 3)).toEqual([])
    const noShoes = buildPlan(ctx({ garments: wardrobe30.filter((g) => g.category !== 'shoes') }))
    expect(composeFallback(noShoes, 3)).toEqual([])
    // formalidades incompatibles: top 3, bottom 3, calzado 4 -> ok; calzado 5 no
    const incompatible = wardrobe30.filter((g) => ['top-polo-marino', 'bot-chinos-beige'].includes(g.id)).concat({ ...byId('sho-zapatos-vestir'), formality: 5, occasions: ['office'] })
    expect(composeFallback(buildPlan(ctx({ garments: incompatible })), 3)).toEqual([])
    expect(composeFallback(buildPlan(ctx()), 0)).toEqual([])
  })

  it('con un solo outfit posible devuelve uno y ya no repite', () => {
    const tiny = wardrobe30.filter((g) => ['top-polo-marino', 'bot-chinos-beige', 'sho-mocasines'].includes(g.id))
    const c = ctx({ garments: tiny })
    expect(composeFallback(buildPlan(c), 3)).toHaveLength(1)
    const used = ctx({ garments: tiny, recentOutfits: [{ garmentIds: tiny.map((g) => g.id), date: TODAY }] })
    expect(composeFallback(buildPlan(used), 3)).toEqual([])
  })
})
