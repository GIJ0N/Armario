import { describeAiError } from '../ai/errors'
import type { AiProvider } from '../ai/provider'
import {
  buildStylistUser,
  STYLIST_JSON_SCHEMA,
  STYLIST_SYSTEM,
  stylistResponseSchema,
  garmentAttributes,
  MAX_LIKED_EXAMPLES,
  type LikedExample,
  type StylistCandidate,
  type StylistResponse,
} from '../ai/prompts/stylist'
import { OCCASION_LABELS } from '../db/labels'
import { composeFallback } from './fallback'
import { buildPlan, type Plan } from './plan'
import type { EngineContext, OutfitSource, SuggestedOutfit } from './types'
import { validateOutfit } from './validate'

export const OUTFIT_COUNT = 3
const MAX_REASONING = 300

export interface SuggestResult {
  outfits: SuggestedOutfit[]
  /** 'ia' si al menos un outfit lo propuso la IA; 'reglas' en caso contrario. */
  source: OutfitSource
  warnings: string[]
}

function candidatesFor(plan: Plan): StylistCandidate[] {
  return plan.ctx.garments
    .filter((g) => plan.filter.eligibleIds.has(g.id))
    .map((g) => ({
      id: g.id,
      category: g.category,
      subcategory: g.subcategory,
      colors: g.colors,
      pattern: g.pattern,
      material: g.material,
      fit: g.fit,
      formality: g.formality,
      warmth: g.warmth,
      is_statement: g.is_statement,
      priority: plan.priorityIds.has(g.id),
      ...(g.notes ? { notes: g.notes } : {}),
    }))
}

/** Hasta 5 outfits con «me gusta» como ejemplos, solo con atributos (sin fotos ni ids). */
function likedExamples(plan: Plan): LikedExample[] {
  return (plan.ctx.likedOutfits ?? []).slice(0, MAX_LIKED_EXAMPLES).map((o) => ({
    garments: o.garmentIds.flatMap((id) => {
      const g = plan.byId.get(id)
      return g ? [garmentAttributes(g)] : []
    }),
    reasoning: o.reasoning,
  }))
}

function promptFor(plan: Plan, errors?: string[]) {
  const { ctx, filter } = plan
  const w = ctx.weather
  return {
    system: STYLIST_SYSTEM,
    user: buildStylistUser({
      occasion: ctx.occasion,
      occasionLabel: OCCASION_LABELS[ctx.occasion],
      weather: {
        temp_c: w.tempC,
        ...(w.feelsLikeC !== undefined ? { feels_like_c: w.feelsLikeC } : {}),
        min_c: w.tempMinC,
        max_c: w.tempMaxC,
        rain_probability_percent: w.precipProbability,
        raining: w.isRaining,
      },
      outerwearRequired: filter.needsOuterwear,
      outerwearRecommended: filter.outerwearAdvice === 'recommended',
      candidates: candidatesFor(plan),
      recentOutfits: ctx.recentOutfits.map((o) => o.garmentIds),
      errors,
      tasteProfile: ctx.tasteSummary,
      likedExamples: likedExamples(plan),
    }),
  }
}

async function askAi(ai: AiProvider, plan: Plan, errors?: string[]): Promise<StylistResponse> {
  const { system, user } = promptFor(plan, errors)
  return ai.generateJson({
    system,
    user,
    schema: stylistResponseSchema,
    jsonSchema: STYLIST_JSON_SCHEMA,
  })
}

/** Valida las propuestas de la IA; devuelve las válidas y los errores de las demás. */
function checkAiOutfits(plan: Plan, response: StylistResponse, kept: SuggestedOutfit[]) {
  const valid: SuggestedOutfit[] = []
  const errors: string[] = []
  for (const o of response.outfits.slice(0, OUTFIT_COUNT)) {
    const candidate = { garmentIds: [...new Set(o.garment_ids)], reasoning: o.reasoning.slice(0, MAX_REASONING) }
    const result = validateOutfit(candidate, plan.ctx, { plan, batch: [...kept, ...valid] })
    if (result.ok) valid.push({ ...candidate, source: 'ia' })
    else errors.push(`Outfit [${o.garment_ids.join(', ')}]: ${result.errors.join(' ')}`)
  }
  return { valid, errors }
}

/**
 * Orquesta los pasos 1-4: filtra, prioriza, pide la composición a la IA (si hay) y valida.
 * Nunca devuelve un outfit inválido; si la IA falla se completa con el compositor por reglas.
 */
export async function suggestOutfits(ctx: EngineContext, ai?: AiProvider): Promise<SuggestResult> {
  const plan = buildPlan(ctx)
  const warnings = [...plan.filter.warnings]

  if (plan.filter.missing.length > 0) {
    return { outfits: [], source: 'reglas', warnings: [...plan.filter.missing, ...warnings] }
  }
  if (!plan.hasCombos) {
    warnings.push(
      ctx.recentOutfits.length > 0
        ? 'No hay más combinaciones nuevas con las prendas aptas; prueba otra ocasión o agrega prendas.'
        : 'Tus prendas aptas no combinan entre sí (formalidad muy distinta); prueba otra ocasión o agrega prendas.',
    )
    return { outfits: [], source: 'reglas', warnings }
  }

  const outfits: SuggestedOutfit[] = []
  if (ai) {
    try {
      const first = checkAiOutfits(plan, await askAi(ai, plan), outfits)
      outfits.push(...first.valid)
      if (outfits.length < OUTFIT_COUNT) {
        // Reintento único con los errores de validación en el prompt.
        const errors = first.errors.length ? first.errors : ['The answer did not contain 3 valid outfits.']
        try {
          const second = checkAiOutfits(plan, await askAi(ai, plan, errors), outfits)
          outfits.push(...second.valid.slice(0, OUTFIT_COUNT - outfits.length))
        } catch {
          /* se completa con reglas */
        }
      }
    } catch (e) {
      warnings.push(`${describeAiError(e)} Se usaron reglas en su lugar.`)
    }
    if (outfits.length > 0 && outfits.length < OUTFIT_COUNT) {
      warnings.push('Algunos outfits de la IA no cumplieron las reglas y se completaron con reglas.')
    }
  }

  if (outfits.length < OUTFIT_COUNT) {
    const fill = composeFallback(plan, OUTFIT_COUNT - outfits.length, outfits)
    outfits.push(...fill.map((o): SuggestedOutfit => ({ ...o, source: 'reglas' })))
  }
  if (outfits.length === 0) warnings.push('No se pudo armar ningún outfit con las prendas disponibles.')
  else if (outfits.length < OUTFIT_COUNT) {
    warnings.push('Solo hay combinaciones distintas suficientes para menos de 3 outfits.')
  }

  return { outfits, source: outfits.some((o) => o.source === 'ia') ? 'ia' : 'reglas', warnings }
}
