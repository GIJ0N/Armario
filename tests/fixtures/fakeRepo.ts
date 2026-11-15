import { normalizeGarmentAdjust } from '../../src/canvas/adjust'
import { garmentInputSchema, type FeedbackEntry, type Garment, type Outfit, type PlannedOutfit, type Repository, type Wear, type WearEntry } from '../../src/db'
import { computeWearStats } from '../../src/db/wearStats'
import { addDays, localDateString } from '../../src/lib/date'
import { memoryFeedback } from './memoryFeedback'
import { memoryOutfits } from './memoryOutfits'
import { memoryPlans } from './memoryPlans'
import { memoryPurchases } from './memoryPurchases'
import { wardrobe30 } from './wardrobe30'

/** Repositorio en memoria para pruebas de UI. */
export function fakeRepo(initial: Garment[] = wardrobe30) {
  // Copia mutable: Comprar crea, activa y descarta prendas.
  const garments: Garment[] = [...initial]
  let n = 0
  const photos: string[] = []
  const outfits: Outfit[] = []
  const wears: Wear[] = []
  const entries = (): WearEntry[] =>
    wears
      .map((w) => ({ w, o: outfits.find((o) => o.id === w.outfit_id)! }))
      .map(({ w, o }) => ({
        wearId: w.id,
        outfitId: o.id,
        garmentIds: o.garment_ids,
        date: w.date,
        occasion: o.occasion,
        reasoning: o.reasoning,
      }))
      .reverse()
      .sort((a, b) => b.date.localeCompare(a.date))
  const mem = memoryFeedback(() => outfits)
  const buy = memoryPurchases(() => garments)
  const out = memoryOutfits(outfits, () => wears, () => mem.rows)
  const planMem = memoryPlans(outfits, wears)
  const repo: Repository & { saved: Outfit[]; savedWears: Wear[]; planRows: PlannedOutfit[]; ratings: FeedbackEntry[]; garments: Garment[]; photos: string[] } = {
    garments,
    swaps: out.swaps,
    photos,
    purchases: buy.purchases,
    feedback: mem.feedback,
    taste: mem.taste,
    ratings: mem.rows,
    saved: outfits,
    savedWears: wears,
    planRows: planMem.rows,
    plans: planMem.plans,
    outfits: out.outfits,
    wears: {
      create: async (outfitId, date) => {
        const existing = wears.find((w) => w.outfit_id === outfitId && w.date === date)
        if (existing) return existing
        const w = { id: `w${wears.length + 1}`, outfit_id: outfitId, date }
        wears.push(w)
        return w
      },
      listSince: async (days, now = new Date()) => {
        const since = addDays(localDateString(now), -days)
        return entries().filter((e) => e.date >= since)
      },
      listBetween: async (from, to) => entries().filter((e) => e.date >= from && e.date <= to).reverse(),
      listHistory: async (limit = 200) => entries().slice(0, limit),
      deleteForOutfitOnDate: async (outfitId, date) => {
        const i = wears.findIndex((w) => w.outfit_id === outfitId && w.date === date)
        if (i >= 0) wears.splice(i, 1)
      },
      stats: async (now = new Date()) => computeWearStats(garments, entries(), localDateString(now)),
    },
    list: async (f) => garments.filter((g) => !f?.statuses || f.statuses.includes(g.status)),
    get: async (id) => garments.find((g) => g.id === id) ?? null,
    create: async (input) => {
      const g = { ...garmentInputSchema.parse(input), id: `n${++n}`, created_at: new Date().toISOString() }
      garments.push(g)
      return g
    },
    update: async (id, input) => {
      const i = garments.findIndex((g) => g.id === id)
      garments[i] = { ...garments[i], ...garmentInputSchema.parse(input) }
      return garments[i]
    },
    setFavorite: async (id, favorite) => {
      const g = garments.find((x) => x.id === id)!
      g.favorite = favorite
      return g
    },
    setCanvasAdjust: async (id, adj) => {
      const g = garments.find((x) => x.id === id)!
      g.canvas_adjust = normalizeGarmentAdjust(adj)
      return g
    },
    setStatus: async (id, status) => {
      const g = garments.find((x) => x.id === id)!
      g.status = status
      return g
    },
    delete: async (id) => {
      const i = garments.findIndex((g) => g.id === id)
      if (i >= 0) garments.splice(i, 1)
    },
    savePhoto: async () => {
      photos.push(`photo:${photos.length + 1}`)
      return photos[photos.length - 1]
    },
    getPhoto: async () => null,
    deletePhoto: async () => {},
    setCutout: async (id, _blob, kind) => {
      const g = garments.find((x) => x.id === id)!
      g.cutout_path = `cutout:${id}`
      g.cutout_kind = kind
      return g
    },
    clearCutout: async (id) => {
      const g = garments.find((x) => x.id === id)!
      g.cutout_path = null
      g.cutout_kind = null
      return g
    },
    close: () => {},
  }
  return repo
}
