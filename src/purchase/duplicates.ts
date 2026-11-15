import type { Garment } from '../db/types'
import { activeWardrobe, norm, primaryColor } from './common'

/** Prendas activas necesarias con los mismos atributos para considerar duplicada a la candidata. */
export const DUPLICATE_MIN_MATCHES = 2

export interface DuplicateResult {
  isDuplicate: boolean
  /** Prendas activas con la misma categoría, subcategoría, color principal y formalidad. */
  matches: Garment[]
}

/**
 * Duplicado: 2 o más prendas ACTIVAS con la misma categoría + subcategoría normalizada (sin mayúsculas ni
 * acentos) + color principal (el primero) + la misma formalidad. Sin subcategoría no se puede afirmar nada.
 */
export function findDuplicates(candidate: Garment, wardrobe: Garment[]): DuplicateResult {
  const sub = norm(candidate.subcategory)
  if (!sub) return { isDuplicate: false, matches: [] }
  const color = primaryColor(candidate)
  const matches = activeWardrobe(wardrobe, candidate.id).filter(
    (g) =>
      g.category === candidate.category &&
      norm(g.subcategory) === sub &&
      primaryColor(g) === color &&
      g.formality === candidate.formality,
  )
  return { isDuplicate: matches.length >= DUPLICATE_MIN_MATCHES, matches }
}
