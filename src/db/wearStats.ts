import { addDays } from '../lib/date'
import type { Garment } from './types'

/** Ventana (días) del porcentaje de armario usado. */
export const USAGE_WINDOW_DAYS = 30

export interface GarmentWearStat {
  garmentId: string
  /** Veces que se ha usado en total (un outfit cuenta una vez por prenda). */
  total: number
  /** YYYY-MM-DD o null si nunca se ha usado. */
  lastWorn: string | null
}

export interface WearStats {
  /** Una entrada por cada prenda existente (cualquier estado), incluidas las nunca usadas. */
  garments: GarmentWearStat[]
  /** Prendas activas. */
  activeCount: number
  /** Prendas activas distintas usadas en los últimos 30 días. */
  usedLast30: number
  /** usedLast30 / activeCount * 100 (0 si no hay prendas activas). Sin redondear. */
  usedPercent: number
}

export interface WearForStats {
  garmentIds: string[]
  /** YYYY-MM-DD */
  date: string
}

/** Cálculo puro de estadísticas de uso; lo comparten el repositorio SQLite y los dobles de prueba. */
export function computeWearStats(
  garments: Pick<Garment, 'id' | 'status'>[],
  wears: WearForStats[],
  today: string,
): WearStats {
  const total = new Map<string, number>()
  const last = new Map<string, string>()
  const recent = new Set<string>()
  const since = addDays(today, -USAGE_WINDOW_DAYS)
  for (const w of wears) {
    for (const id of new Set(w.garmentIds)) {
      total.set(id, (total.get(id) ?? 0) + 1)
      if (!last.has(id) || w.date > last.get(id)!) last.set(id, w.date)
      if (w.date >= since && w.date <= today) recent.add(id)
    }
  }
  const active = garments.filter((g) => g.status === 'active')
  const usedLast30 = active.filter((g) => recent.has(g.id)).length
  return {
    garments: garments.map((g) => ({ garmentId: g.id, total: total.get(g.id) ?? 0, lastWorn: last.get(g.id) ?? null })),
    activeCount: active.length,
    usedLast30,
    usedPercent: active.length ? (usedLast30 / active.length) * 100 : 0,
  }
}
