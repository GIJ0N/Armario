import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { MIGRATIONS } from './migrations'
import type { Storage } from './storage'

let sqlitePromise: Promise<Sqlite3Static> | null = null

function getSqlite() {
  sqlitePromise ??= sqlite3InitModule()
  return sqlitePromise
}

/**
 * Abre una base SQLite en memoria, restaurada desde la instantánea guardada (si existe)
 * y con las migraciones pendientes aplicadas. Si se migró, guarda la instantánea.
 */
export async function openSqlite(storage: Storage): Promise<Database> {
  const sqlite3 = await getSqlite()
  const db = new sqlite3.oo1.DB(':memory:', 'c')
  const snapshot = await storage.loadSnapshot()
  if (snapshot && snapshot.byteLength > 0) {
    const ptr = sqlite3.wasm.allocFromTypedArray(snapshot)
    const flags =
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer!,
      'main',
      ptr,
      snapshot.byteLength,
      snapshot.byteLength,
      flags,
    )
    if (rc !== 0) {
      db.close()
      throw new Error(`No se pudo restaurar la base (código ${rc})`)
    }
  }
  if (snapshot && snapshot.byteLength > 0) {
    const version = Number(db.selectValue('PRAGMA user_version') ?? 0)
    if (version < MIGRATIONS.length) {
      // Regla: ninguna migración corre sin un respaldo previo de la base.
      await storage.saveBackupSnapshot(`pre-migration-v${version}`, snapshot)
    }
  }
  const migrated = runMigrations(db)
  db.exec('PRAGMA foreign_keys = ON')
  if (migrated) await saveSnapshot(sqlite3, db, storage)
  return db
}

/** Corredor de migraciones solo hacia adelante. Devuelve true si aplicó alguna. */
export function runMigrations(db: Database, migrations: readonly string[] = MIGRATIONS): boolean {
  const current = Number(db.selectValue('PRAGMA user_version') ?? 0)
  if (current > migrations.length) {
    throw new Error(
      `La base tiene la versión ${current}, más nueva que esta app (${migrations.length}).`,
    )
  }
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
  return current < migrations.length
}

export async function saveSnapshot(sqlite3: Sqlite3Static, db: Database, storage: Storage) {
  const bytes = sqlite3.capi.sqlite3_js_db_export(db.pointer!)
  await storage.saveSnapshot(bytes)
}

export async function getSqliteStatic() {
  return getSqlite()
}
