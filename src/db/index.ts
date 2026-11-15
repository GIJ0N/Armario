import { SqliteGarmentRepository, type Repository } from './repository'
import { IndexedDbStorage } from './storage'

export type {
  FeedbackRepository,
  GarmentRepository,
  OutfitRepository,
  Repository,
  TasteProfileRepository,
  Wear,
  WearEntry,
  WearRepository,
} from './repository'
export * from './wearStats'
export type { Storage } from './storage'
export * from './types'
export * from './labels'

let repoPromise: Promise<Repository> | null = null

/** Repositorio único de la app (SQLite en memoria + instantánea en IndexedDB). */
export function getRepository(): Promise<Repository> {
  if (!repoPromise) {
    void navigator.storage?.persist?.()
    repoPromise = SqliteGarmentRepository.open(new IndexedDbStorage())
    repoPromise.catch(() => {
      repoPromise = null
    })
  }
  return repoPromise
}
