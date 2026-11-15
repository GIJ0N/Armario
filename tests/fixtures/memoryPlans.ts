import type { Occasion, Outfit, PlanEntry, PlannedOutfit, PlanRepository, Wear } from '../../src/db'
import { localDateString } from '../../src/lib/date'

/** Planes del calendario en memoria (misma semántica que el repositorio SQLite). */
export function memoryPlans(
  outfits: Outfit[],
  wears: Wear[],
  plans: PlannedOutfit[] = [],
): { plans: PlanRepository; rows: PlannedOutfit[] } {
  const entry = (p: PlannedOutfit): PlanEntry => {
    const o = outfits.find((x) => x.id === p.outfitId)!
    return { ...p, garmentIds: o.garment_ids, outfitOccasion: o.occasion, reasoning: o.reasoning }
  }
  const repo: PlanRepository = {
    create: async (outfitId, date, occasion) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Fecha inválida (se espera AAAA-MM-DD)')
      if (!outfits.some((o) => o.id === outfitId)) throw new Error('Outfit no encontrado')
      const existing = plans.find((p) => p.outfitId === outfitId && p.date === date)
      if (existing) {
        if (occasion) existing.occasion = occasion
        return existing
      }
      const p: PlannedOutfit = {
        id: `p${plans.length + 1}-${outfitId}-${date}`,
        outfitId,
        date,
        occasion: (occasion ?? null) as Occasion | null,
        createdAt: new Date().toISOString(),
      }
      plans.push(p)
      return p
    },
    listBetween: async (from, to) =>
      plans
        .filter((p) => p.date >= from && p.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(entry),
    listForOutfit: async (outfitId) => plans.filter((p) => p.outfitId === outfitId),
    remove: async (id) => {
      const i = plans.findIndex((p) => p.id === id)
      if (i >= 0) plans.splice(i, 1)
    },
    convertToWear: async (id) => {
      const i = plans.findIndex((p) => p.id === id)
      if (i < 0) throw new Error('Plan no encontrado')
      const p = plans[i]
      if (p.date > localDateString()) throw new Error('Un día futuro todavía no se puede marcar como usado')
      let w = wears.find((x) => x.outfit_id === p.outfitId && x.date === p.date)
      if (!w) {
        w = { id: `w${wears.length + 1}`, outfit_id: p.outfitId, date: p.date }
        wears.push(w)
      }
      plans.splice(i, 1)
      return w
    },
    setOutfit: async (id, outfitId) => {
      const p = plans.find((x) => x.id === id)
      if (!p) throw new Error('Plan no encontrado')
      p.outfitId = outfitId
      return p
    },
  }
  return { plans: repo, rows: plans }
}
