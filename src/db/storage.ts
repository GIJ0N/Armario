import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/** Adaptador de almacenamiento: instantánea de la base y fotos. Se puede reemplazar por otro backend. */
export interface Storage {
  loadSnapshot(): Promise<Uint8Array | null>
  saveSnapshot(bytes: Uint8Array): Promise<void>
  /** Guarda una copia aparte (p. ej. antes de migrar); no reemplaza la instantánea principal. */
  saveBackupSnapshot(label: string, bytes: Uint8Array): Promise<void>
  putPhoto(key: string, blob: Blob): Promise<void>
  getPhoto(key: string): Promise<Blob | null>
  deletePhoto(key: string): Promise<void>
  /** Todas las fotos guardadas (para el respaldo). */
  listPhotos(): Promise<{ key: string; blob: Blob }[]>
  /** Reemplaza en una sola transacción la instantánea y todas las fotos (restaurar respaldo). */
  replaceAll(snapshot: Uint8Array, photos: { key: string; blob: Blob }[]): Promise<void>
  close(): void
}

interface ArmarioDb extends DBSchema {
  snapshot: { key: string; value: Uint8Array }
  photos: { key: string; value: Blob }
}

const SNAPSHOT_KEY = 'main'

export class IndexedDbStorage implements Storage {
  private dbPromise: Promise<IDBPDatabase<ArmarioDb>>

  constructor(name = 'armario') {
    this.dbPromise = openDB<ArmarioDb>(name, 1, {
      upgrade(db) {
        db.createObjectStore('snapshot')
        db.createObjectStore('photos')
      },
    })
  }

  async loadSnapshot() {
    return (await (await this.dbPromise).get('snapshot', SNAPSHOT_KEY)) ?? null
  }

  async saveSnapshot(bytes: Uint8Array) {
    await (await this.dbPromise).put('snapshot', bytes, SNAPSHOT_KEY)
  }

  async saveBackupSnapshot(label: string, bytes: Uint8Array) {
    await (await this.dbPromise).put('snapshot', bytes, `backup:${label}`)
  }

  async putPhoto(key: string, blob: Blob) {
    await (await this.dbPromise).put('photos', blob, key)
  }

  async getPhoto(key: string) {
    return (await (await this.dbPromise).get('photos', key)) ?? null
  }

  async deletePhoto(key: string) {
    await (await this.dbPromise).delete('photos', key)
  }

  async listPhotos() {
    const db = await this.dbPromise
    const tx = db.transaction('photos')
    const [keys, blobs] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()])
    await tx.done
    return keys.map((key, i) => ({ key: String(key), blob: blobs[i] }))
  }

  async replaceAll(snapshot: Uint8Array, photos: { key: string; blob: Blob }[]) {
    const db = await this.dbPromise
    const tx = db.transaction(['snapshot', 'photos'], 'readwrite')
    const done = tx.done
    await tx.objectStore('photos').clear()
    for (const p of photos) await tx.objectStore('photos').put(p.blob, p.key)
    await tx.objectStore('snapshot').put(snapshot, SNAPSHOT_KEY)
    await done
  }

  close() {
    void this.dbPromise.then((db) => db.close())
  }
}
