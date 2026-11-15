import type { Category, Garment } from '../db/types'
import { daysBetween } from './dates'
import type { WearRecord } from './types'

export interface RotationInfo {
  wears: number
  /** null si nunca se ha usado. */
  daysSinceWorn: number | null
  /** Más alto = más urgente usarla. */
  score: number
}

/** Una prenda usada hace este número de días o menos no puede ser prioritaria. */
export const RECENT_WEAR_DAYS = 2
const NEVER_WORN_BASE = 1000
const MAX_DAYS = 365

/**
 * Puntaje de rotación: nunca usada = 1000 + antigüedad en el armario (desempate: la más vieja primero);
 * usada = días desde el último uso + 100 / (1 + usos totales).
 */
export function rotationScores(
  garments: Garment[],
  wears: WearRecord[],
  today: string,
): Map<string, RotationInfo> {
  const count = new Map<string, number>()
  const last = new Map<string, string>()
  for (const w of wears) {
    for (const id of new Set(w.garmentIds)) {
      count.set(id, (count.get(id) ?? 0) + 1)
      if (!last.has(id) || w.date > last.get(id)!) last.set(id, w.date)
    }
  }
  const out = new Map<string, RotationInfo>()
  for (const g of garments) {
    const n = count.get(g.id) ?? 0
    const lastDate = last.get(g.id)
    if (n === 0 || !lastDate) {
      const age = Math.min(Math.max(daysBetween(g.created_at, today), 0), 3650)
      out.set(g.id, { wears: 0, daysSinceWorn: null, score: NEVER_WORN_BASE + age / 10 })
    } else {
      const days = Math.min(Math.max(daysBetween(lastDate, today), 0), MAX_DAYS)
      out.set(g.id, { wears: n, daysSinceWorn: days, score: days + 100 / (1 + n) })
    }
  }
  return out
}

export interface RotationResult {
  scores: Map<string, RotationInfo>
  /** Ids ordenados de más a menos urgente. */
  order: string[]
  /**
   * Prendas prioritarias (superior, inferior, calzado, capa exterior): el tercio menos usado de cada
   * espacio (mínimo 1). Si en un espacio ninguna se ha usado nunca, todas lo son.
   * Las usadas en los últimos 2 días nunca son prioritarias. Los accesorios no cuentan.
   */
  priorityIds: Set<string>
}

const PRIORITY_SLOTS: readonly Category[] = ['top', 'bottom', 'shoes', 'outerwear']

/** Paso 2: ordena las prendas elegibles por rotación y marca las prioritarias. */
export function rankByRotation(garments: Garment[], wears: WearRecord[], today: string): RotationResult {
  const scores = rotationScores(garments, wears, today)
  const sorter = (a: Garment, b: Garment) =>
    scores.get(b.id)!.score - scores.get(a.id)!.score ||
    a.created_at.localeCompare(b.created_at) ||
    a.id.localeCompare(b.id)
  const order = [...garments].sort(sorter).map((g) => g.id)
  const priorityIds = new Set<string>()
  for (const slot of PRIORITY_SLOTS) {
    const inSlot = garments.filter((g) => g.category === slot).sort(sorter)
    if (inSlot.length === 0) continue
    if (inSlot.every((g) => scores.get(g.id)!.wears === 0)) {
      inSlot.forEach((g) => priorityIds.add(g.id))
    } else {
      inSlot
        .slice(0, Math.max(1, Math.ceil(inSlot.length / 3)))
        .filter((g) => {
          const d = scores.get(g.id)!.daysSinceWorn
          return d === null || d > RECENT_WEAR_DAYS
        })
        .forEach((g) => priorityIds.add(g.id))
    }
  }
  return { scores, order, priorityIds }
}
