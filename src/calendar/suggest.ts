import type { AiAccess } from '../ai/AiProviderContext'
import type { AiProvider } from '../ai/provider'
import type { Garment, Occasion, Repository } from '../db'
import { daysBetween, NO_REPEAT_DAYS, PLANNED_WINDOW_DAYS, suggestOutfits, type SuggestResult, type Weather } from '../engine'
import { addDays } from '../lib/date'
import { loadSettings } from '../settings'
import { loadTaste } from '../taste'

/** Historial de usos que alimenta la rotación (días); igual que en Hoy. */
export const WEARS_LOOKBACK_DAYS = 60

/** El proveedor de IA si está configurado y se puede crear; si no, undefined (se usan reglas). */
export function providerOf(ai: AiAccess): AiProvider | undefined {
  if (!ai.configured) return undefined
  try {
    return ai.getProvider()
  } catch {
    return undefined
  }
}

export interface SuggestForDateInput {
  repo: Repository
  provider?: AiProvider
  /** Día para el que se sugiere (YYYY-MM-DD): pasado, hoy o futuro. */
  date: string
  occasion: Occasion
  weather: Weather
  /** Outfits ya armados (aún sin guardar) para días cercanos, p. ej. los demás días de «Planear semana». */
  drafts?: { garmentIds: string[]; date: string }[]
  /** Combinaciones que ya se mostraron y no deben repetirse. */
  shown?: string[][]
}

export interface SuggestForDateResult extends SuggestResult {
  /** Activas y en lavandería (para dibujar y editar). */
  pool: Garment[]
}

/**
 * Corre el motor de sugerencias para una fecha cualquiera, con la misma lógica que Hoy (rotación, no repetir 14 días,
 * gusto) más los outfits PLANEADOS a ±2 días de esa fecha, que cuentan como ocupados.
 */
export async function suggestForDate(input: SuggestForDateInput): Promise<SuggestForDateResult> {
  const { repo, date } = input
  const pool = await repo.list({ statuses: ['active', 'laundry'] })
  const garments = pool.filter((g) => g.status === 'active')
  const wearEntries = await repo.wears.listSince(WEARS_LOOKBACK_DAYS)
  const wears = wearEntries.map((w) => ({ garmentIds: w.garmentIds, date: w.date }))
  const recentOutfits = wears.filter((w) => {
    const d = daysBetween(w.date, date)
    return d >= 0 && d <= NO_REPEAT_DAYS
  })
  // Lo ya mostrado o armado en esta sesión cuenta como «reciente» para esa fecha.
  for (const ids of input.shown ?? []) recentOutfits.push({ garmentIds: ids, date })
  for (const d of input.drafts ?? []) recentOutfits.push({ garmentIds: d.garmentIds, date })
  const stored = await repo.plans.listBetween(addDays(date, -PLANNED_WINDOW_DAYS), addDays(date, PLANNED_WINDOW_DAYS))
  const plannedOutfits = [
    ...stored.map((p) => ({ garmentIds: p.garmentIds, date: p.date })),
    ...(input.drafts ?? []),
  ]
  // El gusto nunca debe impedir sugerir: si falla, se sugiere sin él.
  const taste = await loadTaste(repo, garments).catch(() => null)
  const requireFavorite = loadSettings().requireFavorite
  const result = await suggestOutfits(
    {
      occasion: input.occasion,
      weather: input.weather,
      garments,
      wears,
      recentOutfits,
      plannedOutfits,
      today: date,
      ...(requireFavorite ? { requireFavorite: true } : {}),
      ...(taste ? { taste: taste.preferences, tasteSummary: taste.summary, likedOutfits: taste.likedOutfits } : {}),
    },
    input.provider,
  )
  return { ...result, pool }
}
