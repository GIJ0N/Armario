import { normalizeLayout } from '../../src/canvas/adjust'
import type { FeedbackEntry, NewOutfitSwap, Outfit, OutfitRepository, OutfitSwap, SwapRepository } from '../../src/db'

interface WearLike {
  outfit_id: string
  date: string
}

/** Outfits (con guardados, edición en su lugar e historial) y cambios manuales en memoria. */
export function memoryOutfits(
  rows: Outfit[],
  wears: () => WearLike[] = () => [],
  ratings: () => FeedbackEntry[] = () => [],
): { outfits: OutfitRepository; swaps: SwapRepository; swapRows: OutfitSwap[] } {
  const swapRows: OutfitSwap[] = []
  const find = (id: string) => {
    const o = rows.find((x) => x.id === id)
    if (!o) throw new Error('Outfit no encontrado')
    return o
  }
  const outfits: OutfitRepository = {
    create: async (input) => {
      const o: Outfit = { ...input, id: `o${rows.length + 1}`, created_at: new Date().toISOString(), saved_at: null, name: null, canvas_layout: null }
      rows.push(o)
      return o
    },
    listRecent: async () => [...rows].reverse(),
    get: async (id) => rows.find((o) => o.id === id) ?? null,
    updateItems: async (id, patch) => {
      const o = find(id)
      o.garment_ids = patch.garmentIds
      o.source = 'manual'
      if (patch.reasoning !== undefined) o.reasoning = patch.reasoning
      if (patch.occasion !== undefined) o.occasion = patch.occasion
      return o
    },
    hasHistory: async (id) => wears().some((w) => w.outfit_id === id) || ratings().some((r) => r.outfitId === id),
    setCanvasLayout: async (id, layout) => {
      const o = find(id)
      o.canvas_layout = normalizeLayout(layout)
      return o
    },
    save: async (id, name) => {
      const o = find(id)
      o.saved_at ??= new Date().toISOString()
      o.name = name?.trim() || null
      return o
    },
    unsave: async (id) => {
      const o = find(id)
      o.saved_at = null
      o.name = null
      return o
    },
    listSaved: async () =>
      rows
        .filter((o) => o.saved_at)
        .reverse()
        .map((outfit) => ({
          outfit,
          lastWorn:
            wears()
              .filter((w) => w.outfit_id === outfit.id)
              .map((w) => w.date)
              .sort()
              .pop() ?? null,
        })),
  }
  const swaps: SwapRepository = {
    record: async (list: NewOutfitSwap[]) => {
      for (const s of list) {
        swapRows.push({ id: `s${swapRows.length + 1}`, ...s, createdAt: s.createdAt ?? new Date().toISOString() })
      }
    },
    list: async (limit) => [...swapRows].reverse().slice(0, limit),
  }
  return { outfits, swaps, swapRows }
}
