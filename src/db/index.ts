import { SqliteGarmentRepository, type GarmentRepository } from './repository'
import { IndexedDbStorage } from './storage'

export type { GarmentRepository } from './repository'
export type { Storage } from './storage'
export * from './types'
export * from './labels'

let repoPromise: Promise<GarmentRepository> | null = null

/** Repositorio único de la app (SQLite en memoria + instantánea en IndexedDB). */
export function getRepository(): Promise<GarmentRepository> {
  if (!repoPromise) {
    void navigator.storage?.persist?.()
    repoPromise = SqliteGarmentRepository.open(new IndexedDbStorage())
    repoPromise.catch(() => {
      repoPromise = null
    })
  }
  return repoPromise
}
