import type { Garment, Occasion } from '../db/types'
import { filterGarments } from './filter'
import { buildPlan, comboKey, hasAvoidedPair, spreadOf, type Plan } from './plan'
import type { EngineContext, OutfitSuggestion, OutfitValidation, Weather } from './types'

export interface ValidateOptions {
  plan?: Plan
  /** Otras sugerencias del mismo lote (no se pueden repetir). */
  batch?: OutfitSuggestion[]
}

/** Paso 4: reglas duras. Los mensajes están en inglés porque se reenvían a la IA en el reintento. */
export function validateOutfit(
  suggestion: Pick<OutfitSuggestion, 'garmentIds'>,
  ctx: EngineContext,
  opts: ValidateOptions = {},
): OutfitValidation {
  const plan = opts.plan ?? buildPlan(ctx)
  const errors: string[] = []
  const ids = suggestion.garmentIds

  if (new Set(ids).size !== ids.length) errors.push('Duplicate garment ids.')
  const items: Garment[] = []
  for (const id of new Set(ids)) {
    const g = plan.byId.get(id)
    if (!g) errors.push(`Unknown garment id "${id}".`)
    else if (!plan.filter.eligibleIds.has(id)) {
      errors.push(`Garment "${id}" is not eligible for this occasion, weather or status.`)
    } else items.push(g)
  }
  if (errors.length) return { ok: false, errors }

  for (const issue of structureIssues(items, { needsOuterwear: plan.filter.needsOuterwear, complete: true })) {
    errors.push(issue.message)
  }
  const core = items.filter((g) => g.category !== 'accessory')

  if (plan.priorityIds.size > 0 && !core.some((g) => plan.priorityIds.has(g.id))) {
    errors.push('Include at least one priority garment (least-worn).')
  }

  if (plan.requireFavorite && !items.some((g) => g.favorite)) {
    errors.push('Include at least one favorite garment.')
  }

  if (hasAvoidedPair(ids, plan.byId, plan.avoidPairs)) {
    errors.push('This outfit combines garments the user disliked together; pick a different combination.')
  }

  const key = comboKey(ids, plan.byId)
  if (plan.plannedKeys.has(key)) errors.push('This outfit repeats an outfit already planned within 2 days of this date.')
  else if (plan.recentKeys.has(key)) errors.push('This outfit repeats an outfit worn (or already shown) in the last 14 days.')
  if ((opts.batch ?? []).some((o) => comboKey(o.garmentIds, plan.byId) === key)) {
    errors.push('This outfit duplicates another outfit in the same answer.')
  }

  return errors.length ? { ok: false, errors } : { ok: true }
}

export type StructureCode =
  | 'slot_count'
  | 'outerwear_max'
  | 'outerwear_required'
  | 'accessory_max'
  | 'formality_spread'
  | 'accessory_formality'
  | 'statement'

export interface StructureIssue {
  code: StructureCode
  message: string
}

/**
 * Reglas estructurales de un outfit ya con prendas elegibles: espacios, capa exterior, accesorios, dispersión
 * de formalidad y un solo protagonista. Con `complete: false` (outfit a medio armar) solo se señalan los excesos
 * y las incompatibilidades, no lo que todavía falta.
 */
export function structureIssues(
  items: Garment[],
  opts: { needsOuterwear: boolean; complete: boolean },
): StructureIssue[] {
  const issues: StructureIssue[] = []
  const add = (code: StructureCode, message: string) => issues.push({ code, message })
  const count = (c: Garment['category']) => items.filter((g) => g.category === c)
  for (const [slot, label] of [['top', 'top'], ['bottom', 'bottom'], ['shoes', 'pair of shoes']] as const) {
    const n = count(slot).length
    if (opts.complete ? n !== 1 : n > 1) add('slot_count', `Exactly one ${label} is required (got ${n}).`)
  }
  const outer = count('outerwear').length
  if (outer > 1) add('outerwear_max', 'At most one outerwear piece is allowed.')
  if (opts.complete && opts.needsOuterwear && outer !== 1) {
    add('outerwear_required', 'One outerwear piece is required for this weather.')
  }
  const accessories = count('accessory')
  if (accessories.length > 2) add('accessory_max', 'At most 2 accessories are allowed.')

  const core = items.filter((g) => g.category !== 'accessory')
  const spread = spreadOf(core)
  if (spread > 1) add('formality_spread', `Formality spread across clothing and shoes must be at most 1 (got ${spread}).`)
  if (core.length) {
    const mean = core.reduce((s, g) => s + g.formality, 0) / core.length
    for (const a of accessories) {
      if (Math.abs(a.formality - mean) > 1) {
        add('accessory_formality', `Accessory "${a.id}" formality ${a.formality} is not within 1 of the outfit (${mean.toFixed(1)}).`)
      }
    }
  }
  if (items.filter((g) => g.is_statement).length > 1) add('statement', 'At most one statement piece is allowed.')
  return issues
}

export interface ManualContext {
  occasion: Occasion
  /** null = sin clima (p. ej. «Crear outfit» en Armario): no se filtra por abrigo ni se exige capa exterior. */
  weather: Weather | null
  garments: Garment[]
}

/** Clima de relleno cuando no hay clima (`ignoreWeather` hace que no se use). */
export const PLACEHOLDER_WEATHER: Weather = { tempC: 20, precipProbability: 0, isRaining: false, tempMinC: 20, tempMaxC: 20 }

/**
 * Validación de un outfit armado a mano: mismas reglas duras de clima, formalidad y estructura, pero sin las de
 * rotación (prioritaria, no repetir, pares evitados, favorita), que solo aplican a lo que sugiere la app.
 */
export function validateManualOutfit(
  garmentIds: string[],
  ctx: ManualContext,
  opts: { complete?: boolean } = {},
): OutfitValidation {
  const filter = filterGarments(
    { occasion: ctx.occasion, weather: ctx.weather ?? PLACEHOLDER_WEATHER, garments: ctx.garments },
    undefined,
    { ignoreWeather: !ctx.weather },
  )
  const byId = new Map(ctx.garments.map((g) => [g.id, g]))
  const errors: string[] = []
  const items: Garment[] = []
  for (const id of new Set(garmentIds)) {
    const g = byId.get(id)
    if (!g) errors.push(`Unknown garment id "${id}".`)
    else if (!filter.eligibleIds.has(id)) errors.push(`Garment "${id}" is not eligible for this occasion, weather or status.`)
    else items.push(g)
  }
  if (garmentIds.length !== new Set(garmentIds).size) errors.push('Duplicate garment ids.')
  if (errors.length) return { ok: false, errors }
  const needsOuterwear = !!ctx.weather && filter.needsOuterwear
  const issues = structureIssues(items, { needsOuterwear, complete: opts.complete ?? true })
  return issues.length ? { ok: false, errors: issues.map((i) => i.message) } : { ok: true }
}
