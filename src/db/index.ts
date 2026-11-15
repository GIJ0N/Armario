import { SqliteGarmentRepository, type Repository } from './repository'
import { IndexedDbStorage } from './storage'

export type {
  FeedbackRepository,
  GarmentRepository,
  OutfitRepository,
  PlanRepository,
  PurchaseEvaluationRepository,
  Repository,
  SwapRepository,
  TasteProfileRepository,
  Wear,
  WearEntry,
  WearRepository,
} from './repository'
export * from './wearStats'
export type { Storage } from './storage'
export * from './types'
export * from './labels'
export { BackupError } from './backup'

let storage: IndexedDbStorage | null = null

/** Almacenamiento compartido (instantánea + fotos); lo usan el repositorio y el respaldo. */
export function getStorage(): IndexedDbStorage {
  storage ??= new IndexedDbStorage()
  return storage
}

let repoPromise: Promise<Repository> | null = null

/** Repositorio único de la app (SQLite en memoria + instantánea en IndexedDB). */
export function getRepository(): Promise<Repository> {
  if (!repoPromise) {
    void navigator.storage?.persist?.()
    repoPromise = SqliteGarmentRepository.open(getStorage())
    repoPromise.catch(() => {
      repoPromise = null
    })
  }
  return repoPromise
}
