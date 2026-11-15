import { TAGS_BY_RATING, type FeedbackEntry, type FeedbackRepository, type Outfit, type TasteProfile, type TasteProfileRepository } from '../../src/db'

/** Calificaciones y perfil de gusto en memoria para pruebas de UI y de motor. */
export function memoryFeedback(outfits: () => Outfit[]): { feedback: FeedbackRepository; taste: TasteProfileRepository; rows: FeedbackEntry[] } {
  const rows: FeedbackEntry[] = []
  let profile: TasteProfile | null = null
  const sorted = () => [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const feedback: FeedbackRepository = {
    rate: async (outfitId, rating, tags, comment = '', now = new Date()) => {
      const o = outfits().find((x) => x.id === outfitId)
      if (!o) throw new Error('Outfit no encontrado')
      if (tags.some((t) => !TAGS_BY_RATING[rating].includes(t))) throw new Error('Motivo no válido')
      const entry: FeedbackEntry = {
        id: `f${rows.length + 1}`,
        outfitId,
        rating,
        tags: [...new Set(tags)],
        comment,
        createdAt: now.toISOString(),
        garmentIds: o.garment_ids,
        occasion: o.occasion,
        reasoning: o.reasoning,
      }
      const i = rows.findIndex((r) => r.outfitId === outfitId)
      if (i >= 0) rows[i] = { ...entry, id: rows[i].id }
      else rows.push(entry)
      return rows.find((r) => r.outfitId === outfitId)!
    },
    get: async (outfitId) => rows.find((r) => r.outfitId === outfitId) ?? null,
    listRecent: async (limit) => sorted().slice(0, limit),
    countSince: async (since) => rows.filter((r) => r.createdAt > since).length,
    likedOutfits: async (limit) => sorted().filter((r) => r.rating === 'like').slice(0, limit),
  }
  const taste: TasteProfileRepository = {
    get: async () => profile,
    save: async (summary, now = new Date()) => (profile = { summary, updatedAt: now.toISOString(), resetAt: profile?.resetAt ?? '' }),
    reset: async (now = new Date()) => (profile = { summary: '', updatedAt: now.toISOString(), resetAt: now.toISOString() }),
  }
  return { feedback, taste, rows }
}
