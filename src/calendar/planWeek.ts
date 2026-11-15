import { OCCASIONS, type Occasion } from '../db'
import { addDays } from '../lib/date'
import { isWeekend } from './grid'

/** Ocasión por defecto de un día entre semana si no hay historial. */
export const DEFAULT_WEEKDAY_OCCASION: Occasion = 'plant_work'
export const DEFAULT_WEEKEND_OCCASION: Occasion = 'casual'
/** Cuántos días entre semana se proponen por defecto en «Planear semana». */
export const DEFAULT_PLAN_DAYS = 5
/** Máximo de días que se buscan hacia adelante para completar los 5 (por si hay muchos planes). */
const MAX_LOOKAHEAD_DAYS = 60

/**
 * Los próximos `count` días entre semana (lunes a viernes) después de `today` que todavía no tienen un outfit planeado.
 * `planned` es el conjunto de fechas con plan.
 */
export function defaultPlanDays(today: string, planned: ReadonlySet<string>, count = DEFAULT_PLAN_DAYS): string[] {
  const out: string[] = []
  for (let i = 1; i <= MAX_LOOKAHEAD_DAYS && out.length < count; i++) {
    const d = addDays(today, i)
    if (!isWeekend(d) && !planned.has(d)) out.push(d)
  }
  return out
}

/** La ocasión que más se ha usado entre semana en el historial (empate: la primera en el orden de OCCASIONS). */
export function mostUsedWeekdayOccasion(history: { date: string; occasion: Occasion }[]): Occasion {
  const counts = new Map<Occasion, number>()
  for (const h of history) if (!isWeekend(h.date)) counts.set(h.occasion, (counts.get(h.occasion) ?? 0) + 1)
  let best: Occasion = DEFAULT_WEEKDAY_OCCASION
  let bestN = 0
  for (const o of OCCASIONS) {
    const n = counts.get(o) ?? 0
    if (n > bestN) {
      best = o
      bestN = n
    }
  }
  return bestN > 0 ? best : DEFAULT_WEEKDAY_OCCASION
}

/** Ocasión sugerida para un día: la más usada entre semana de lunes a viernes; «Casual» el fin de semana. */
export function defaultOccasionFor(date: string, weekday: Occasion): Occasion {
  return isWeekend(date) ? DEFAULT_WEEKEND_OCCASION : weekday
}
