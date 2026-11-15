import type { Garment } from '../db/types'
import { buildPlan, comboKey, spreadOf, type Plan } from './plan'
import type { EngineContext, OutfitSuggestion, OutfitValidation } from './types'

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

  const count = (c: Garment['category']) => items.filter((g) => g.category === c)
  for (const [slot, label] of [['top', 'top'], ['bottom', 'bottom'], ['shoes', 'pair of shoes']] as const) {
    if (count(slot).length !== 1) errors.push(`Exactly one ${label} is required (got ${count(slot).length}).`)
  }
  const outer = count('outerwear').length
  if (outer > 1) errors.push('At most one outerwear piece is allowed.')
  if (plan.filter.needsOuterwear && outer !== 1) errors.push('One outerwear piece is required for this weather.')
  const accessories = count('accessory')
  if (accessories.length > 2) errors.push('At most 2 accessories are allowed.')

  const core = items.filter((g) => g.category !== 'accessory')
  const spread = spreadOf(core)
  if (spread > 1) errors.push(`Formality spread across clothing and shoes must be at most 1 (got ${spread}).`)
  if (core.length) {
    const mean = core.reduce((s, g) => s + g.formality, 0) / core.length
    for (const a of accessories) {
      if (Math.abs(a.formality - mean) > 1) {
        errors.push(`Accessory "${a.id}" formality ${a.formality} is not within 1 of the outfit (${mean.toFixed(1)}).`)
      }
    }
  }
  if (items.filter((g) => g.is_statement).length > 1) errors.push('At most one statement piece is allowed.')

  if (plan.priorityIds.size > 0 && !core.some((g) => plan.priorityIds.has(g.id))) {
    errors.push('Include at least one priority garment (least-worn).')
  }

  const key = comboKey(ids, plan.byId)
  if (plan.recentKeys.has(key)) errors.push('This outfit repeats an outfit worn (or already shown) in the last 14 days.')
  if ((opts.batch ?? []).some((o) => comboKey(o.garmentIds, plan.byId) === key)) {
    errors.push('This outfit duplicates another outfit in the same answer.')
  }

  return errors.length ? { ok: false, errors } : { ok: true }
}
