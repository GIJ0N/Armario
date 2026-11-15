import type { Verdict } from '../db/types'

export interface VerdictThresholds {
  /** Outfits mínimos para «Cómprala». */
  buyMinOutfits: number
  /** Ocasiones mínimas (con al menos 1 outfit) para «Cómprala». */
  buyMinOccasions: number
}

export const DEFAULT_THRESHOLDS: VerdictThresholds = { buyMinOutfits: 5, buyMinOccasions: 2 }

export const VERDICT_LABELS: Record<Verdict, string> = {
  buy: 'Cómprala',
  with_complements: 'Solo con complementos',
  skip: 'No te conviene',
}

/**
 * «Cómprala»: total ≥ mínimo y ≥ mínimo de ocasiones con outfit. «No te conviene»: 0 outfits o duplicado.
 * «Solo con complementos»: el resto (1 o más outfits, pero pocos o en una sola ocasión).
 */
export function computeVerdict(
  input: { total: number; occasionCount: number; isDuplicate: boolean },
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): Verdict {
  if (input.isDuplicate || input.total === 0) return 'skip'
  if (input.total >= thresholds.buyMinOutfits && input.occasionCount >= thresholds.buyMinOccasions) return 'buy'
  return 'with_complements'
}
