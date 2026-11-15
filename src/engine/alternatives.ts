import { OCCASION_LABELS } from '../db/labels'
import type { Category, Garment, Occasion } from '../db/types'
import { effectiveTemp, filterGarments, formalityRangeFor, warmthRangeFor } from './filter'
import { rotationScores, type RotationInfo } from './rotation'
import type { StructureCode } from './validate'
import { PLACEHOLDER_WEATHER, structureIssues } from './validate'
import type { Weather, WearRecord } from './types'

export interface AlternativesInput {
  occasion: Occasion
  /** null = sin clima: no se filtra por abrigo. */
  weather: Weather | null
  /** Prendas candidatas (activas y en lavandería; retiradas y candidatas se ignoran siempre). */
  garments: Garment[]
  wears: WearRecord[]
  /** YYYY-MM-DD */
  today: string
  /** Prendas actuales del outfit. */
  items: Garment[]
  /** Prenda que se reemplaza; null para agregar una pieza nueva. */
  replaceId: string | null
  category: Category
}

export interface UnfitGarment {
  garment: Garment
  /** Motivo en español por el que no encaja, p. ej. «muy formal para gym». */
  reason: string
}

export interface Alternatives {
  /** Válidas para la ocasión y el clima, de la menos usada a la más usada. */
  valid: Garment[]
  /** El resto, cada una con su motivo (las de lavandería siempre aquí). */
  others: UnfitGarment[]
  /** Usos y días desde el último uso de cada candidata (para mostrarlos). */
  rotation: Map<string, RotationInfo>
}

const STRUCTURE_REASONS: Record<StructureCode, string> = {
  slot_count: 'ya hay otra prenda del mismo tipo',
  outerwear_max: 'ya hay una capa exterior',
  outerwear_required: 'falta una capa exterior',
  accessory_max: 'ya hay 2 accesorios',
  formality_spread: 'su formalidad no va con el resto del outfit',
  accessory_formality: 'no combina en formalidad con el resto',
  statement: 'ya hay una prenda protagonista',
}

/** Motivo por el que una prenda no pasa el filtro de la ocasión y el clima (null si lo pasa). */
export function ineligibleReason(g: Garment, occasion: Occasion, weather: Weather | null): string | null {
  if (g.status === 'laundry') return 'en lavandería'
  const [fMin, fMax] = formalityRangeFor(occasion, g.category)
  if (!(g.formality >= fMin && g.formality <= fMax) && !g.occasions.includes(occasion)) {
    const occ = OCCASION_LABELS[occasion].toLowerCase()
    return g.formality > fMax ? `muy formal para ${occ}` : `muy informal para ${occ}`
  }
  const wr = weather ? warmthRangeFor(g.category, weather) : null
  if (weather && wr && (g.warmth < wr[0] || g.warmth > wr[1])) {
    const t = Math.round(effectiveTemp(weather))
    return g.warmth > wr[1] ? `muy abrigadora para ${t}°` : `muy ligera para ${t}°`
  }
  return null
}

/**
 * Alternativas para cambiar (o agregar) una pieza de un outfit. Reutiliza el filtro del motor
 * (estado, clima, formalidad) y las reglas estructurales del validador; no aplica las de rotación.
 * Primero las válidas (la menos usada primero) y luego las demás con su motivo.
 */
export function findAlternatives(input: AlternativesInput): Alternatives {
  const { occasion, weather, items, replaceId, category } = input
  const pool = input.garments.filter((g) => g.status === 'active' || g.status === 'laundry')
  const filter = filterGarments({ occasion, weather: weather ?? PLACEHOLDER_WEATHER, garments: pool }, undefined, {
    ignoreWeather: !weather,
  })
  const kept = items.filter((g) => g.id !== replaceId)
  const keptIds = new Set(items.map((g) => g.id))
  const candidates = pool.filter((g) => g.category === category && !keptIds.has(g.id))
  const scores = rotationScores(candidates, input.wears, input.today)

  const valid: Garment[] = []
  const others: UnfitGarment[] = []
  for (const g of candidates) {
    const base = ineligibleReason(g, occasion, weather)
    if (base || !filter.eligibleIds.has(g.id)) {
      others.push({ garment: g, reason: base ?? 'no encaja con la ocasión o el clima' })
      continue
    }
    const issue = structureIssues([...kept, g], { needsOuterwear: false, complete: false })[0]
    if (issue) others.push({ garment: g, reason: STRUCTURE_REASONS[issue.code] })
    else valid.push(g)
  }
  const urgency = (g: Garment) => scores.get(g.id)?.score ?? 0
  valid.sort((a, b) => urgency(b) - urgency(a) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  others.sort((a, b) => a.reason.localeCompare(b.reason) || a.garment.id.localeCompare(b.garment.id))
  return { valid, others, rotation: scores }
}

/** «Barajar»: una alternativa válida al azar (null si no hay). `rng` devuelve [0, 1). */
export function shuffleAlternative(alternatives: Alternatives, rng: () => number = Math.random): Garment | null {
  const { valid } = alternatives
  return valid.length ? valid[Math.min(valid.length - 1, Math.floor(rng() * valid.length))] : null
}

/**
 * «Quitar» solo existe para capa exterior y accesorios: arriba, abajo y calzado son obligatorios, y la capa
 * también cuando el clima la exige.
 */
export function canRemoveCategory(
  category: Category,
  ctx: { occasion: Occasion; weather: Weather | null; garments: Garment[] },
): boolean {
  if (category === 'accessory') return true
  if (category !== 'outerwear' || !ctx.weather) return category === 'outerwear'
  const filter = filterGarments({ occasion: ctx.occasion, weather: ctx.weather, garments: ctx.garments })
  return !filter.needsOuterwear
}
