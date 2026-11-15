import type { Garment, Outfit, Repository, Wear, WearEntry } from '../../src/db'
import { computeWearStats } from '../../src/db/wearStats'
import { addDays, localDateString } from '../../src/lib/date'
import { wardrobe30 } from './wardrobe30'

/** Repositorio en memoria para pruebas de UI. */
export function fakeRepo(garments: Garment[] = wardrobe30) {
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
  const repo: Repository & { saved: Outfit[]; savedWears: Wear[] } = {
    saved: outfits,
    savedWears: wears,
    outfits: {
      create: async (input) => {
        const o = { ...input, id: `o${outfits.length + 1}`, created_at: new Date().toISOString() }
        outfits.push(o)
        return o
      },
      listRecent: async () => [...outfits].reverse(),
    },
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
      listHistory: async (limit = 200) => entries().slice(0, limit),
      deleteForOutfitOnDate: async (outfitId, date) => {
        const i = wears.findIndex((w) => w.outfit_id === outfitId && w.date === date)
        if (i >= 0) wears.splice(i, 1)
      },
      stats: async (now = new Date()) => computeWearStats(garments, entries(), localDateString(now)),
    },
    list: async (f) => garments.filter((g) => !f?.statuses || f.statuses.includes(g.status)),
    get: async () => null,
    create: async () => {
      throw new Error('no usado')
    },
    update: async () => {
      throw new Error('no usado')
    },
    setStatus: async () => {
      throw new Error('no usado')
    },
    delete: async () => {},
    savePhoto: async () => 'photo:1',
    getPhoto: async () => null,
    deletePhoto: async () => {},
    close: () => {},
  }
  return repo
}
