import type { Category, Occasion, Rating } from '../db/types'
import { formalityRange, type Range } from './occasions'

/** Lo mínimo de una calificación que el motor necesita (sin depender de la base de datos). */
export interface TasteFeedback {
  rating: Rating
  tags: string[]
  garmentIds: string[]
}

export interface TastePreferences {
  /** -1 (prefiere menos formal) .. +1 (prefiere más formal). */
  formalityBias: number
  /** Claves `a|b` (ids ordenados) de pares de prendas que aparecen juntas en ≥ 2 outfits con «no me gusta». */
  dislikedPairs: string[]
  /** Prendas (no accesorios) de outfits con «me gusta». */
  likedGarmentIds: string[]
  ratingCount: number
}

export const NEUTRAL_TASTE: TastePreferences = { formalityBias: 0, dislikedPairs: [], likedGarmentIds: [], ratingCount: 0 }

/** Con menos calificaciones que esto el sesgo se diluye (3 de 3 «muy formal» = -0.5). */
export const BIAS_MIN_SAMPLE = 6
/** A partir de este sesgo (en valor absoluto) se endurece el rango de formalidad. */
export const BIAS_HARD_THRESHOLD = 0.5
export const DISLIKED_PAIR_MIN = 2

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Pares de ids distintos (sin repetir). */
function pairsOf(ids: string[]): string[] {
  const u = [...new Set(ids)]
  const out: string[] = []
  for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) out.push(pairKey(u[i], u[j]))
  return out
}

/**
 * Preferencias deterministas a partir de las calificaciones (función pura).
 * `categoryOf` permite ignorar accesorios; si una prenda ya no existe se ignora.
 */
export function computeTaste(
  feedback: TasteFeedback[],
  categoryOf: (garmentId: string) => Category | undefined,
): TastePreferences {
  const core = (ids: string[]) => ids.filter((id) => {
    const c = categoryOf(id)
    return c !== undefined && c !== 'accessory'
  })
  let formal = 0
  let casual = 0
  const pairCount = new Map<string, number>()
  const liked = new Set<string>()
  for (const f of feedback) {
    const ids = core(f.garmentIds)
    if (f.rating === 'dislike') {
      if (f.tags.includes('too_formal')) formal++
      if (f.tags.includes('too_casual')) casual++
      for (const p of pairsOf(ids)) pairCount.set(p, (pairCount.get(p) ?? 0) + 1)
    } else {
      ids.forEach((id) => liked.add(id))
    }
  }
  const raw = (casual - formal) / Math.max(feedback.length, BIAS_MIN_SAMPLE)
  return {
    formalityBias: Math.max(-1, Math.min(1, raw)),
    dislikedPairs: [...pairCount].filter(([, n]) => n >= DISLIKED_PAIR_MIN).map(([k]) => k).sort(),
    likedGarmentIds: [...liked].sort(),
    ratingCount: feedback.length,
  }
}

/**
 * Rango de formalidad endurecido por el gusto para superiores e inferiores (null = sin cambio).
 * Sesgo ≤ -0.5: se baja el techo y se permite un punto menos (nunca bajo 1). Sesgo ≥ 0.5: al revés (nunca sobre 5).
 * El gym no se ajusta.
 */
export function tasteFormalityRange(
  occasion: Occasion,
  category: Category,
  taste: TastePreferences | undefined,
): Range | null {
  if (!taste || occasion === 'gym' || (category !== 'top' && category !== 'bottom')) return null
  const [min, max] = formalityRange(occasion, category)
  if (taste.formalityBias <= -BIAS_HARD_THRESHOLD) {
    const lo = Math.max(1, min - 1)
    return [lo, Math.max(lo, max - 1)]
  }
  if (taste.formalityBias >= BIAS_HARD_THRESHOLD) {
    const hi = Math.min(5, max + 1)
    return [Math.min(hi, min + 1), hi]
  }
  return null
}

/** ¿El gusto cambia algo para esta ocasión? */
export function tasteTightens(occasion: Occasion, taste: TastePreferences | undefined): boolean {
  return tasteFormalityRange(occasion, 'top', taste) !== null
}
