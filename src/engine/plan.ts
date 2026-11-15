import type { Garment } from '../db/types'
import { daysBetween } from './dates'
import { filterGarments, type FilterResult } from './filter'
import { rankByRotation, type RotationResult } from './rotation'
import { pairKey, tasteTightens } from './taste'
import type { EngineContext } from './types'

/** Un outfit no puede repetirse dentro de esta ventana (días). */
export const NO_REPEAT_DAYS = 14
/** Tope de combinaciones exploradas para no bloquear la UI. */
export const MAX_COMBO_ITERATIONS = 400_000

export interface Plan {
  ctx: EngineContext
  filter: FilterResult
  rotation: RotationResult
  byId: Map<string, Garment>
  /** Prioritarias que además pueden formar al menos un outfit válido. */
  priorityIds: Set<string>
  /** Claves (ids no accesorio ordenados) de outfits recientes. */
  recentKeys: Set<string>
  /** Hay al menos una combinación base posible. */
  hasCombos: boolean
  /** Pares con «no me gusta» que se rechazan en validación (vacío si no hay alternativas suficientes). */
  avoidPairs: Set<string>
  /** El gusto endureció el rango de formalidad en este plan. */
  tasteApplied: boolean
}

/** Mínimo de combinaciones sin pares evitados para exigir evitarlos. */
export const MIN_CLEAN_COMBOS = 3

/** ¿Algún par de prendas (no accesorios) del outfit está en `pairs`? */
export function hasAvoidedPair(ids: string[], byId: Map<string, Garment>, pairs: Set<string> | string[]): boolean {
  const set = pairs instanceof Set ? pairs : new Set(pairs)
  if (set.size === 0) return false
  const core = [...new Set(ids)].filter((id) => byId.get(id) && byId.get(id)!.category !== 'accessory')
  for (let i = 0; i < core.length; i++) for (let j = i + 1; j < core.length; j++) if (set.has(pairKey(core[i], core[j]))) return true
  return false
}

/** Clave de un outfit: ids de prendas no accesorio, ordenados. */
export function comboKey(ids: string[], byId: Map<string, Garment>): string {
  return ids
    .filter((id) => byId.get(id)?.category !== 'accessory')
    .sort()
    .join('|')
}

export function spreadOf(items: Garment[]): number {
  if (items.length === 0) return 0
  const f = items.map((g) => g.formality)
  return Math.max(...f) - Math.min(...f)
}

/**
 * Recorre combinaciones base válidas (superior + inferior + calzado [+ capa exterior]) respetando
 * dispersión de formalidad ≤ 1, un solo protagonista y no repetir recientes. `visit` devuelve false para parar.
 */
export function forEachBaseCombo(
  plan: Pick<Plan, 'filter' | 'byId' | 'recentKeys'>,
  visit: (items: Garment[]) => boolean | void,
  slotLimit = Infinity,
  order?: (a: Garment, b: Garment) => number,
): void {
  const { bySlot, needsOuterwear } = plan.filter
  const cut = (list: Garment[]) => {
    const l = order ? [...list].sort(order) : list
    return l.length > slotLimit ? l.slice(0, slotLimit) : l
  }
  const tops = cut(bySlot.top)
  const bottoms = cut(bySlot.bottom)
  const shoes = cut(bySlot.shoes)
  const outers: (Garment | null)[] = [...(needsOuterwear ? [] : [null]), ...cut(bySlot.outerwear)]
  let iterations = 0
  for (const t of tops) {
    for (const b of bottoms) {
      if (Math.abs(t.formality - b.formality) > 1) continue
      if (t.is_statement && b.is_statement) continue
      for (const s of shoes) {
        const lo = Math.min(t.formality, b.formality, s.formality)
        const hi = Math.max(t.formality, b.formality, s.formality)
        if (hi - lo > 1) continue
        const statements = Number(t.is_statement) + Number(b.is_statement) + Number(s.is_statement)
        if (statements > 1) continue
        for (const o of outers) {
          if (++iterations > MAX_COMBO_ITERATIONS) return
          if (o) {
            if (Math.max(hi, o.formality) - Math.min(lo, o.formality) > 1) continue
            if (statements + Number(o.is_statement) > 1) continue
          }
          const items = o ? [t, b, s, o] : [t, b, s]
          if (plan.recentKeys.has(comboKey(items.map((g) => g.id), plan.byId))) continue
          if (visit(items) === false) return
        }
      }
    }
  }
}

function buildPlanWith(ctx: EngineContext, applyTaste: boolean): Plan {
  const filter = filterGarments(ctx, applyTaste ? ctx.taste : undefined)
  const eligible = ctx.garments.filter((g) => filter.eligibleIds.has(g.id))
  const rotation = rankByRotation(eligible, ctx.wears, ctx.today)
  const byId = new Map(ctx.garments.map((g) => [g.id, g]))
  const recentKeys = new Set(
    ctx.recentOutfits
      .filter((o) => {
        const d = daysBetween(o.date, ctx.today)
        return d >= 0 && d <= NO_REPEAT_DAYS
      })
      .map((o) => comboKey(o.garmentIds, byId)),
  )
  const plan: Plan = {
    ctx,
    filter,
    rotation,
    byId,
    priorityIds: new Set(),
    recentKeys,
    hasCombos: false,
    avoidPairs: new Set(),
    tasteApplied: applyTaste && tasteTightens(ctx.occasion, ctx.taste),
  }
  if (filter.missing.length === 0) {
    const feasible = new Set<string>()
    const disliked = new Set(ctx.taste?.dislikedPairs ?? [])
    let clean = 0
    forEachBaseCombo(plan, (items) => {
      plan.hasCombos = true
      items.forEach((g) => feasible.add(g.id))
      if (disliked.size > 0 && clean < MIN_CLEAN_COMBOS && !hasAvoidedPair(items.map((g) => g.id), byId, disliked)) clean++
    })
    plan.priorityIds = new Set([...rotation.priorityIds].filter((id) => feasible.has(id)))
    if (clean >= MIN_CLEAN_COMBOS) plan.avoidPairs = disliked
  }
  return plan
}

/**
 * Pasos 1 y 2 combinados con lo necesario para validar y componer.
 * Si el gusto endurece la formalidad y deja sin outfits posibles, se descarta ese endurecimiento.
 */
export function buildPlan(ctx: EngineContext): Plan {
  const plan = buildPlanWith(ctx, true)
  if (plan.tasteApplied && (plan.filter.missing.length > 0 || !plan.hasCombos)) return buildPlanWith(ctx, false)
  return plan
}
