import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { getSqliteStatic, openSqlite, saveSnapshot } from './sqlite'
import type { Storage } from './storage'
import {
  garmentInputSchema,
  type Garment,
  type GarmentFilter,
  type GarmentInput,
} from './types'

/** Interfaz de acceso a prendas y fotos; la UI solo depende de esto. */
export interface GarmentRepository {
  list(filter?: GarmentFilter): Promise<Garment[]>
  get(id: string): Promise<Garment | null>
  create(input: GarmentInput): Promise<Garment>
  update(id: string, input: GarmentInput): Promise<Garment>
  /** Cambia solo el estado (p. ej. lavandería). */
  setStatus(id: string, status: Garment['status']): Promise<Garment>
  delete(id: string): Promise<void>
  savePhoto(blob: Blob): Promise<string>
  getPhoto(key: string): Promise<Blob | null>
  deletePhoto(key: string): Promise<void>
  close(): void
}

type Row = Record<string, unknown>

function rowToGarment(row: Row): Garment {
  return {
    id: row.id as string,
    photo_path: (row.photo_path as string | null) ?? null,
    category: row.category as Garment['category'],
    subcategory: row.subcategory as string,
    colors: JSON.parse(row.colors as string),
    pattern: row.pattern as string,
    material: row.material as string,
    fit: row.fit as Garment['fit'],
    formality: row.formality as number,
    warmth: row.warmth as number,
    occasions: JSON.parse(row.occasions as string),
    is_statement: row.is_statement === 1,
    status: row.status as Garment['status'],
    notes: row.notes as string,
    created_at: row.created_at as string,
  }
}

export class SqliteGarmentRepository implements GarmentRepository {
  private queue: Promise<unknown> = Promise.resolve()

  private sqlite3: Sqlite3Static
  private db: Database
  private storage: Storage

  private constructor(sqlite3: Sqlite3Static, db: Database, storage: Storage) {
    this.sqlite3 = sqlite3
    this.db = db
    this.storage = storage
  }

  static async open(storage: Storage): Promise<SqliteGarmentRepository> {
    const sqlite3 = await getSqliteStatic()
    const db = await openSqlite(storage)
    return new SqliteGarmentRepository(sqlite3, db, storage)
  }

  /** Ejecuta una escritura en transacción y espera a que la instantánea quede en IndexedDB. */
  private write<T>(fn: () => T): Promise<T> {
    const run = async () => {
      const result = this.db.transaction(fn)
      await saveSnapshot(this.sqlite3, this.db, this.storage)
      return result
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  private select(id: string): Garment | null {
    const rows = this.db.selectObjects('SELECT * FROM garments WHERE id = ?', [id])
    return rows.length ? rowToGarment(rows[0]) : null
  }

  async list(filter: GarmentFilter = {}) {
    const where: string[] = []
    const bind: string[] = []
    if (filter.category) {
      where.push('category = ?')
      bind.push(filter.category)
    }
    if (filter.statuses) {
      if (filter.statuses.length === 0) return []
      where.push(`status IN (${filter.statuses.map(() => '?').join(',')})`)
      bind.push(...filter.statuses)
    }
    const sql = `SELECT * FROM garments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, rowid DESC`
    return this.db.selectObjects(sql, bind).map(rowToGarment)
  }

  async get(id: string) {
    return this.select(id)
  }

  async create(input: GarmentInput) {
    const data = garmentInputSchema.parse(input)
    const id = crypto.randomUUID()
    const created_at = new Date().toISOString()
    await this.write(() => {
      this.db.exec({
        sql: `INSERT INTO garments (id, photo_path, category, subcategory, colors, pattern, material, fit,
          formality, warmth, occasions, is_statement, status, notes, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        bind: [
          id,
          data.photo_path,
          data.category,
          data.subcategory,
          JSON.stringify(data.colors),
          data.pattern,
          data.material,
          data.fit,
          data.formality,
          data.warmth,
          JSON.stringify(data.occasions),
          data.is_statement ? 1 : 0,
          data.status,
          data.notes,
          created_at,
        ],
      })
    })
    return { ...data, id, created_at }
  }

  async update(id: string, input: GarmentInput) {
    const data = garmentInputSchema.parse(input)
    const before = this.select(id)
    if (!before) throw new Error('Prenda no encontrada')
    await this.write(() => {
      this.db.exec({
        sql: `UPDATE garments SET photo_path=?, category=?, subcategory=?, colors=?, pattern=?, material=?,
          fit=?, formality=?, warmth=?, occasions=?, is_statement=?, status=?, notes=? WHERE id=?`,
        bind: [
          data.photo_path,
          data.category,
          data.subcategory,
          JSON.stringify(data.colors),
          data.pattern,
          data.material,
          data.fit,
          data.formality,
          data.warmth,
          JSON.stringify(data.occasions),
          data.is_statement ? 1 : 0,
          data.status,
          data.notes,
          id,
        ],
      })
    })
    if (before.photo_path && before.photo_path !== data.photo_path) {
      await this.storage.deletePhoto(before.photo_path)
    }
    return { ...data, id, created_at: before.created_at }
  }

  async setStatus(id: string, status: Garment['status']) {
    const before = this.select(id)
    if (!before) throw new Error('Prenda no encontrada')
    return this.update(id, { ...before, status })
  }

  async delete(id: string) {
    const before = this.select(id)
    if (!before) return
    await this.write(() => {
      this.db.exec({ sql: 'DELETE FROM garments WHERE id = ?', bind: [id] })
    })
    if (before.photo_path) await this.storage.deletePhoto(before.photo_path)
  }

  async savePhoto(blob: Blob) {
    const key = `photo:${crypto.randomUUID()}`
    await this.storage.putPhoto(key, blob)
    return key
  }

  getPhoto(key: string) {
    return this.storage.getPhoto(key)
  }

  deletePhoto(key: string) {
    return this.storage.deletePhoto(key)
  }

  close() {
    this.db.close()
    this.storage.close()
  }
}
