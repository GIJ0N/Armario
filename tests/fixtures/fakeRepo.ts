import type { Garment, Outfit, Repository } from '../../src/db'
import { wardrobe30 } from './wardrobe30'

/** Repositorio en memoria para pruebas de UI. */
export function fakeRepo(garments: Garment[] = wardrobe30) {
  const outfits: Outfit[] = []
  const repo: Repository & { saved: Outfit[] } = {
    saved: outfits,
    outfits: {
      create: async (input) => {
        const o = { ...input, id: `o${outfits.length + 1}`, created_at: new Date().toISOString() }
        outfits.push(o)
        return o
      },
      listRecent: async () => [...outfits].reverse(),
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
