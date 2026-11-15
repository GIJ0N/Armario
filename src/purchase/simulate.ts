import { OCCASIONS, type Category, type Garment, type Occasion } from '../db/types'
import { MAX_NON_NEUTRAL_COLORS, nonNeutralColors, scoreCombo } from '../engine/fallback'
import { filterGarments, type FilterResult } from '../engine/filter'
import { comboKey, forEachBaseCombo, type Plan } from '../engine/plan'
import type { EngineContext } from '../engine/types'
import { validateOutfit } from '../engine/validate'
import type { RotationResult } from '../engine/rotation'
import { WEATHER_PRESETS, type WeatherPresetKey } from '../weather/presets'
import { activeWardrobe, norm } from './common'

/** Climas de la simulación: templado (MILD), calor (HOT) y frío (COLD), con los presets del motor. */
export const SIM_WEATHERS: readonly WeatherPresetKey[] = ['warm', 'hot', 'cold']
/** Prendas por espacio que se exploran (las de formalidad más cercana a la candidata) para acotar el tiempo. */
export const SIM_SLOT_LIMIT = 30
export const MAX_EXAMPLES = 3

export interface SimulatedOutfit {
  occasion: Occasion
  weather: WeatherPresetKey
  /** Ids de prendas (superior, inferior, calzado, capa exterior si aplica) y la candidata si es accesorio. */
  garmentIds: string[]
  score: number
}

export interface SimulationResult {
  /** Outfits distintos (por ids no accesorio, unión entre climas) por ocasión. */
  perOccasion: Record<Occasion, number>
  /** Combinaciones (ocasión, clima) válidas por clima. */
  perWeather: Record<WeatherPresetKey, number>
  /** Suma de `perOccasion`. */
  total: number
  /** Ocasiones con al menos 1 outfit. */
  occasionCount: number
  /** Prendas distintas del armario con las que combina. */
  partnerIds: string[]
  /** Hasta 3 ejemplos por ocasión, los mejores por puntaje del compositor por reglas. */
  examples: Record<Occasion, SimulatedOutfit[]>
}

export interface SimulationContext {
  /** Armario; solo cuentan las prendas activas (la candidata se trata como activa). */
  garments: Garment[]
}

export interface SimulateOptions {
  /** false: solo cuenta (más rápido; lo usa «qué le falta»). Por defecto true. */
  examples?: boolean
  slotLimit?: number
}

const emptyRecord = <T>(make: () => T) => Object.fromEntries(OCCASIONS.map((o) => [o, make()])) as Record<Occasion, T>

function stubPlan(occasion: Occasion, weather: EngineContext['weather'], all: Garment[], filter: FilterResult): Plan {
  const rotation: RotationResult = { scores: new Map(), order: [], priorityIds: new Set() }
  return {
    ctx: { occasion, weather, garments: all, wears: [], recentOutfits: [], today: '2100-01-01' },
    filter,
    rotation,
    byId: new Map(all.map((g) => [g.id, g])),
    priorityIds: new Set(),
    recentKeys: new Set(),
    hasCombos: true,
    avoidPairs: new Set(),
    tasteApplied: false,
  }
}

function accessoryFits(acc: Garment, core: Garment[]): boolean {
  const mean = core.reduce((s, g) => s + g.formality, 0) / core.length
  if (Math.abs(acc.formality - mean) > 1) return false
  if (acc.is_statement && core.some((g) => g.is_statement)) return false
  if (nonNeutralColors([...core, acc]).size > MAX_NON_NEUTRAL_COLORS) return false
  const shoes = core.find((g) => g.category === 'shoes')
  if (norm(acc.subcategory).startsWith('cinturon') && shoes?.colors[0] && acc.colors[0] && norm(acc.colors[0]) !== norm(shoes.colors[0])) {
    return false
  }
  return true
}

/**
 * Simula los outfits VÁLIDOS (solo reglas, sin IA, determinista y acotado) que incluyen a `candidate` en
 * cada ocasión y en los climas templado, calor y frío. La candidata se trata como activa y tan elegible como
 * cualquier otra prenda; se ignoran la prioridad de rotación y la regla de no repetir recientes.
 * La capa exterior opcional no multiplica los outfits: solo cuenta cuando el clima la exige o cuando la
 * candidata ES la capa.
 */
export function simulateWithGarment(
  candidate: Garment,
  ctx: SimulationContext,
  opts: SimulateOptions = {},
): SimulationResult {
  const wantExamples = opts.examples !== false
  const cand: Garment = { ...candidate, status: 'active' }
  const all = [...activeWardrobe(ctx.garments, cand.id), cand]
  const byId = new Map(all.map((g) => [g.id, g]))
  const isAccessory = cand.category === 'accessory'
  const limit = opts.slotLimit ?? (isAccessory ? 20 : SIM_SLOT_LIMIT)
  const closest = (list: Garment[]) =>
    [...list]
      .sort((a, b) => Math.abs(a.formality - cand.formality) - Math.abs(b.formality - cand.formality) || a.id.localeCompare(b.id))
      .slice(0, limit)

  const perOccasion = emptyRecord(() => 0)
  const perWeather = Object.fromEntries(SIM_WEATHERS.map((w) => [w, 0])) as Record<WeatherPresetKey, number>
  const examples = emptyRecord<SimulatedOutfit[]>(() => [])
  const partners = new Set<string>()

  for (const occasion of OCCASIONS) {
    const keys = new Set<string>()
    const best = new Map<string, SimulatedOutfit>()
    for (const w of SIM_WEATHERS) {
      const weather = WEATHER_PRESETS[w]
      const filter = filterGarments({ occasion, weather, garments: all })
      if (!filter.eligibleIds.has(cand.id) || filter.missing.length > 0) continue

      const slots = { ...filter.bySlot }
      let needsOuterwear = filter.needsOuterwear
      if (!isAccessory) slots[cand.category] = [cand]
      for (const c of ['top', 'bottom', 'shoes', 'outerwear'] as Category[]) {
        if (c !== cand.category) slots[c] = closest(slots[c])
      }
      if (cand.category === 'outerwear') needsOuterwear = true
      else if (!needsOuterwear) slots.outerwear = []
      slots.accessory = []

      const plan = stubPlan(occasion, weather, all, { ...filter, bySlot: slots, needsOuterwear })
      const scorePlan = wantExamples ? stubPlan(occasion, weather, all, filter) : plan
      let found = 0
      forEachBaseCombo(plan, (items) => {
        let core = items
        if (isAccessory) {
          if (!accessoryFits(cand, items)) return
        } else if (!items.some((g) => g.id === cand.id)) return
        found++
        const key = comboKey(core.map((g) => g.id), byId)
        keys.add(key)
        for (const g of items) if (g.id !== cand.id) partners.add(g.id)
        if (wantExamples) {
          const score = scoreCombo(scorePlan, core, new Map())
          const prev = best.get(key)
          if (!prev || score > prev.score) {
            if (isAccessory) core = [...items, cand]
            best.set(key, { occasion, weather: w, garmentIds: core.map((g) => g.id), score })
          }
        }
      })
      perWeather[w] += found > 0 ? 1 : 0
    }
    perOccasion[occasion] = keys.size
    if (wantExamples) {
      examples[occasion] = [...best.values()]
        .sort((a, b) => b.score - a.score || a.garmentIds.join('|').localeCompare(b.garmentIds.join('|')))
        .slice(0, MAX_EXAMPLES)
    }
  }

  const total = OCCASIONS.reduce((s, o) => s + perOccasion[o], 0)
  return {
    perOccasion,
    perWeather,
    total,
    occasionCount: OCCASIONS.filter((o) => perOccasion[o] > 0).length,
    partnerIds: [...partners].sort(),
    examples,
  }
}

/** Vuelve a validar un ejemplo con el validador del motor (reglas duras, sin prioridad de rotación). */
export function isValidExample(ex: SimulatedOutfit, wardrobeWithCandidate: Garment[]): boolean {
  const all = wardrobeWithCandidate.map((g) => ({ ...g, status: 'active' as const }))
  const weather = WEATHER_PRESETS[ex.weather]
  const filter = filterGarments({ occasion: ex.occasion, weather, garments: all })
  const plan = stubPlan(ex.occasion, weather, all, filter)
  return validateOutfit({ garmentIds: ex.garmentIds }, plan.ctx, { plan }).ok
}
