import { OCCASION_LABELS } from '../db/labels'
import { CATEGORIES, type Category, type Garment } from '../db/types'
import { formalityRange, type Range } from './occasions'
import { tasteFormalityRange, type TastePreferences } from './taste'
import type { EngineContext, OuterwearAdvice, Weather } from './types'

export interface WeatherBand {
  /** Temperatura efectiva mínima (°C) para esta banda. */
  minTemp: number
  top: Range
  bottom: Range
  outerwear: Range
  outerwearAdvice: OuterwearAdvice
}

/**
 * Temperatura efectiva -> abrigo aceptable (1-5). Ordenada de más calor a más frío.
 * En frío las prendas base pueden ser más ligeras (2) porque la capa exterior abriga.
 * Calzado y accesorios no se filtran por clima.
 */
export const WEATHER_BANDS: readonly WeatherBand[] = [
  { minTemp: 30, top: [1, 2], bottom: [1, 2], outerwear: [1, 2], outerwearAdvice: 'none' },
  { minTemp: 24, top: [1, 3], bottom: [1, 3], outerwear: [1, 3], outerwearAdvice: 'none' },
  { minTemp: 18, top: [2, 3], bottom: [2, 3], outerwear: [2, 3], outerwearAdvice: 'optional' },
  { minTemp: 12, top: [2, 4], bottom: [2, 4], outerwear: [2, 4], outerwearAdvice: 'recommended' },
  { minTemp: -Infinity, top: [2, 5], bottom: [2, 5], outerwear: [3, 5], outerwearAdvice: 'required' },
]

/** A partir de este porcentaje se considera que va a llover. */
export const RAIN_PROBABILITY_THRESHOLD = 60

export function effectiveTemp(w: Weather): number {
  return w.feelsLikeC ?? w.tempC
}

export function weatherBand(w: Weather): WeatherBand {
  const t = effectiveTemp(w)
  return WEATHER_BANDS.find((b) => t >= b.minTemp) ?? WEATHER_BANDS[WEATHER_BANDS.length - 1]
}

export function isRainy(w: Weather): boolean {
  return w.isRaining || w.precipProbability >= RAIN_PROBABILITY_THRESHOLD
}

const inRange = (v: number, r: Range) => v >= r[0] && v <= r[1]

/** Rango de abrigo aceptable de una categoría con este clima (null = no se filtra por clima). */
export function warmthRangeFor(category: Category, weather: Weather): Range | null {
  const band = weatherBand(weather)
  if (category === 'top') return band.top
  if (category === 'bottom') return band.bottom
  if (category === 'outerwear') {
    return isRainy(weather) ? [band.outerwear[0], Math.max(band.outerwear[1], 3)] : band.outerwear
  }
  return null
}

/** Rango de formalidad con el que `filterGarments` evalúa una categoría (el gusto lo puede endurecer). */
export function formalityRangeFor(occasion: EngineContext['occasion'], category: Category, taste?: TastePreferences): Range {
  return tasteFormalityRange(occasion, category, taste) ?? formalityRange(occasion, category)
}

export interface FilterResult {
  bySlot: Record<Category, Garment[]>
  eligibleIds: Set<string>
  /** Capa exterior obligatoria (frío, o lluvia con alguna capa apta). */
  needsOuterwear: boolean
  outerwearAdvice: OuterwearAdvice
  /** Espacios sin prendas aptas; vacío si se puede armar un outfit. */
  missing: string[]
  warnings: string[]
}

const SLOT_NOUN: Record<Category, string> = {
  top: 'prendas superiores aptas',
  bottom: 'prendas inferiores aptas',
  shoes: 'calzado apto',
  outerwear: 'capa exterior apta',
  accessory: 'accesorios aptos',
}

/** Paso 1: prendas elegibles por espacio según estado, clima y formalidad. */
export function filterGarments(
  ctx: Pick<EngineContext, 'occasion' | 'weather' | 'garments'>,
  /** Preferencias de gusto que endurecen la formalidad de superiores e inferiores (fase 5). */
  taste?: TastePreferences,
  /** Fase 12: `ignoreWeather` omite abrigo y capa exterior (sin clima, p. ej. «Crear outfit» en Armario). */
  opts: { ignoreWeather?: boolean } = {},
): FilterResult {
  const { occasion, weather } = ctx
  const band = weatherBand(weather)
  const rainy = isRainy(weather)
  const bySlot = Object.fromEntries(CATEGORIES.map((c) => [c, [] as Garment[]])) as Record<Category, Garment[]>
  const formalityOk: Record<Category, number> = { top: 0, bottom: 0, shoes: 0, outerwear: 0, accessory: 0 }

  for (const g of ctx.garments) {
    if (g.status !== 'active') continue
    // Con el gusto aplicado el rango manda: la etiqueta de ocasión ya no abre la puerta a prendas más formales.
    const tasteRange = tasteFormalityRange(occasion, g.category, taste)
    const fits = tasteRange
      ? inRange(g.formality, tasteRange)
      : inRange(g.formality, formalityRange(occasion, g.category)) || g.occasions.includes(occasion)
    if (!fits) continue
    formalityOk[g.category]++
    const wr = opts.ignoreWeather ? null : warmthRangeFor(g.category, weather)
    if (wr && !inRange(g.warmth, wr)) continue
    bySlot[g.category].push(g)
  }

  const occ = OCCASION_LABELS[occasion].toLowerCase()
  const missing: string[] = []
  const warnings: string[] = []
  for (const slot of ['top', 'bottom', 'shoes'] as const) {
    if (bySlot[slot].length === 0) {
      const weatherCaused = formalityOk[slot] > 0
      missing.push(`No tienes ${SLOT_NOUN[slot]} para ${occ}${weatherCaused ? ' con este clima' : ''}.`)
    }
  }

  const cold = !opts.ignoreWeather && band.outerwearAdvice === 'required'
  const haveOuter = bySlot.outerwear.length > 0
  let advice = band.outerwearAdvice
  let needsOuterwear = false
  if (cold) {
    needsOuterwear = true
    if (!haveOuter) missing.push(`No tienes ${SLOT_NOUN.outerwear} para este frío.`)
  } else if (rainy && !opts.ignoreWeather) {
    if (haveOuter) {
      needsOuterwear = true
      advice = 'required'
    } else {
      warnings.push('Hay probabilidad de lluvia y no tienes una capa exterior apta.')
    }
  }

  const eligibleIds = new Set<string>()
  for (const c of CATEGORIES) for (const g of bySlot[c]) eligibleIds.add(g.id)
  return { bySlot, eligibleIds, needsOuterwear, outerwearAdvice: advice, missing, warnings }
}
