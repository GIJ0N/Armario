import { describeAiError } from '../ai/errors'
import type { AiProvider } from '../ai/provider'
import {
  buildPurchaseGapsUser,
  buildWardrobeGapsUser,
  PURCHASE_GAPS_JSON_SCHEMA,
  PURCHASE_GAPS_SYSTEM,
  purchaseGapsResponseSchema,
  WARDROBE_GAPS_JSON_SCHEMA,
  WARDROBE_GAPS_SYSTEM,
  wardrobeGapsResponseSchema,
  MAX_EXPLANATION_CHARS,
} from '../ai/prompts/purchaseGaps'
import { OCCASIONS, type Garment, type NewPurchaseEvaluation, type StoredComplement, type Verdict } from '../db/types'
import { activeWardrobe, type ComplementDescriptor } from './common'
import { suggestComplements, toStoredComplement, unlockedByComplement, MAX_COMPLEMENTS } from './complements'
import { findDuplicates, type DuplicateResult } from './duplicates'
import { analyzeGaps } from './gaps'
import { simulateWithGarment, type SimulationResult } from './simulate'
import { computeVerdict, DEFAULT_THRESHOLDS, type VerdictThresholds } from './verdict'
import type { WardrobeGapSuggestion } from './wardrobeGaps'

export interface EvaluationReport {
  verdict: Verdict
  duplicate: DuplicateResult
  simulation: SimulationResult
  /** Mensajes en español del análisis por reglas. */
  gaps: string[]
  complements: StoredComplement[]
  /** Explicación en español (≤ 400 caracteres); de la IA si hubo, si no por reglas. */
  explanation: string
  /** Aviso en español sobre el origen del análisis ('' si no hay nada que avisar). */
  note: string
  usedAi: boolean
}

export interface EvaluateOptions {
  ai?: AiProvider
  thresholds?: VerdictThresholds
}

function ruleExplanation(verdict: Verdict, dup: DuplicateResult, sim: SimulationResult, gaps: string[]): string {
  let text: string
  if (dup.isDuplicate) {
    text = `Ya tienes ${dup.matches.length} prendas casi iguales (misma subcategoría, color y formalidad): no sumaría variedad.`
  } else if (verdict === 'buy') {
    text = `Combina con ${sim.partnerIds.length} prendas de tu armario en ${sim.occasionCount} ocasiones.`
  } else if (verdict === 'with_complements') {
    text = `${gaps[0] ?? 'Forma pocos outfits con lo que tienes.'} Con un complemento rendiría mucho más.`
  } else {
    text = gaps[0] ?? 'No forma ningún outfit válido con tu armario actual.'
  }
  return text.slice(0, MAX_EXPLANATION_CHARS)
}

const attributes = (g: Garment) => ({
  category: g.category,
  subcategory: g.subcategory,
  colors: g.colors,
  pattern: g.pattern,
  material: g.material,
  fit: g.fit,
  formality: g.formality,
  warmth: g.warmth,
  is_statement: g.is_statement,
})

/** Complementos propuestos por la IA, simulados por el motor: los números de la IA nunca se usan. */
async function aiEnhance(
  ai: AiProvider,
  candidate: Garment,
  wardrobe: Garment[],
  sim: SimulationResult,
  gaps: string[],
): Promise<{ explanation: string; complements: StoredComplement[] }> {
  const response = await ai.generateJson({
    system: PURCHASE_GAPS_SYSTEM,
    user: buildPurchaseGapsUser({
      candidate: attributes(candidate),
      wardrobe: wardrobe.map(attributes),
      outfitsPerOccasion: sim.perOccasion,
      totalOutfits: sim.total,
      gaps,
    }),
    schema: purchaseGapsResponseSchema,
    jsonSchema: PURCHASE_GAPS_JSON_SCHEMA,
  })
  const seen = new Set<string>()
  const complements: StoredComplement[] = []
  for (const c of response.complements) {
    const d: ComplementDescriptor = {
      category: c.category,
      subcategory: c.subcategory,
      colors: c.colors,
      formality: c.formality,
      warmth: c.warmth,
      fit: c.fit,
      material: c.material || undefined,
      pattern: c.pattern || undefined,
    }
    const unlocks = unlockedByComplement(candidate, wardrobe, sim, d)
    const stored = toStoredComplement(d, unlocks, 'ai', c.reason || undefined)
    if (unlocks <= 0 || seen.has(stored.label)) continue
    seen.add(stored.label)
    complements.push(stored)
  }
  complements.sort((a, b) => b.unlocks - a.unlocks)
  return { explanation: response.explanation, complements: complements.slice(0, MAX_COMPLEMENTS) }
}

/**
 * Evaluación completa de una prenda candidata: duplicado, simulación, veredicto, huecos y complementos.
 * Con IA se mejora la explicación y los complementos; si falla o no está configurada se usan las reglas.
 */
export async function evaluatePurchase(
  candidate: Garment,
  garments: Garment[],
  opts: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS
  const wardrobe = activeWardrobe(garments, candidate.id)
  const duplicate = findDuplicates(candidate, wardrobe)
  const simulation = simulateWithGarment(candidate, { garments: wardrobe })
  const verdict = computeVerdict({ total: simulation.total, occasionCount: simulation.occasionCount, isDuplicate: duplicate.isDuplicate }, thresholds)
  const gaps = analyzeGaps(candidate, wardrobe, simulation).map((g) => g.message)
  let explanation = ruleExplanation(verdict, duplicate, simulation, gaps)
  let complements: StoredComplement[] = []
  let note = ''
  let usedAi = false

  if (!duplicate.isDuplicate) {
    complements = suggestComplements(candidate, wardrobe, simulation)
    if (!opts.ai) {
      note = 'Sin IA: la explicación y los complementos se calcularon con reglas.'
    } else {
      try {
        const enhanced = await aiEnhance(opts.ai, candidate, wardrobe, simulation, gaps)
        if (enhanced.explanation) explanation = enhanced.explanation
        if (enhanced.complements.length > 0) complements = enhanced.complements
        else note = 'La IA no propuso complementos útiles; se usaron las reglas.'
        usedAi = true
      } catch (e) {
        note = `${describeAiError(e)} Se usó el análisis por reglas.`
      }
    }
  }
  return { verdict, duplicate, simulation, gaps, complements, explanation, note, usedAi }
}

/** Resumen listo para `repo.purchases.save`. */
export function toStoredEvaluation(garmentId: string, r: EvaluationReport): NewPurchaseEvaluation {
  const perOccasion = Object.fromEntries(OCCASIONS.filter((o) => r.simulation.perOccasion[o] > 0).map((o) => [o, r.simulation.perOccasion[o]]))
  return {
    garmentId,
    verdict: r.verdict,
    outfitCount: r.simulation.total,
    gaps: r.gaps,
    complements: r.complements,
    details: {
      perOccasion,
      occasionCount: r.simulation.occasionCount,
      partnerCount: r.simulation.partnerIds.length,
      duplicateIds: r.duplicate.matches.map((g) => g.id),
      examples: OCCASIONS.flatMap((o) => r.simulation.examples[o].map((e) => ({ occasion: o, garmentIds: e.garmentIds }))),
      explanation: r.explanation,
      note: r.note,
      usedAi: r.usedAi,
    },
  }
}

/** Frases de la IA para las sugerencias de «Qué le falta»; los números siguen siendo del motor. */
export async function phraseWardrobeGaps(ai: AiProvider, suggestions: WardrobeGapSuggestion[]): Promise<WardrobeGapSuggestion[]> {
  try {
    const { phrases } = await ai.generateJson({
      system: WARDROBE_GAPS_SYSTEM,
      user: buildWardrobeGapsUser(suggestions.map((s) => ({ label: s.label, category: s.descriptor.category, formality: s.descriptor.formality }))),
      schema: wardrobeGapsResponseSchema,
      jsonSchema: WARDROBE_GAPS_JSON_SCHEMA,
    })
    return suggestions.map((s, i) => (phrases[i] ? { ...s, phrase: phrases[i] } : s))
  } catch {
    return suggestions
  }
}

