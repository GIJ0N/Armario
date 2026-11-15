import type { Category, Occasion } from '../db/types'

export type Range = readonly [min: number, max: number]

export interface OccasionRule {
  /** Rango de formalidad (1-5) de las prendas de la ocasión. */
  formality: Range
  /** Rangos más amplios para ciertas categorías. */
  relaxed?: Partial<Record<Category, Range>>
  /** Si es true, no se exige equilibrar siluetas (holgado/ajustado). */
  relaxSilhouette?: boolean
}

/** Tabla de datos: fácil de ajustar. */
export const OCCASION_RULES: Record<Occasion, OccasionRule> = {
  plant_work: { formality: [1, 3] },
  office: { formality: [3, 4] },
  gym: { formality: [1, 1], relaxed: { shoes: [1, 2], outerwear: [1, 2] }, relaxSilhouette: true },
  casual: { formality: [2, 3] },
  date: { formality: [3, 4] },
  formal_event: { formality: [4, 5] },
}

/** Rango de formalidad aplicable a una categoría. Los accesorios tienen un margen de ±1. */
export function formalityRange(occasion: Occasion, category: Category): Range {
  const rule = OCCASION_RULES[occasion]
  const base = rule.relaxed?.[category] ?? rule.formality
  if (category === 'accessory') return [Math.max(1, base[0] - 1), Math.min(5, base[1] + 1)]
  return base
}
