// @vitest-environment node
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { unzipSync, zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { createBackup, importBackup } from '../src/db/backup'
import { MIGRATIONS } from '../src/db/migrations'
import { SqliteGarmentRepository } from '../src/db/repository'
import { getSqliteStatic, runMigrations } from '../src/db/sqlite'
import { IndexedDbStorage } from '../src/db/storage'

const NAME = 'test-cutout'
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
const jpg = () => new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' })

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  const store: Record<string, string> = {}
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
  }
})

async function withGarment() {
  const storage = new IndexedDbStorage(NAME)
  const repo = await SqliteGarmentRepository.open(storage)
  const photo = await repo.savePhoto(jpg())
  const g = await repo.create({ category: 'top', formality: 3, warmth: 2, photo_path: photo })
  return { repo, storage, photo, g }
}

describe('migración 0005', () => {
  it('agrega columnas nulas sin perder datos y valida cutout_kind', async () => {
    const sqlite3 = await getSqliteStatic()
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(db, MIGRATIONS.slice(0, 4))
    db.exec("INSERT INTO garments (id, category, formality, warmth, created_at) VALUES ('x','top',3,3,'now')")
    expect(runMigrations(db)).toBe(true)
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(5)
    expect(db.selectObjects('SELECT id, cutout_path, cutout_kind FROM garments')).toEqual([
      { id: 'x', cutout_path: null, cutout_kind: null },
    ])
    expect(() => db.exec("UPDATE garments SET cutout_path='cutout:1', cutout_kind='mask'")).not.toThrow()
    expect(() => db.exec("UPDATE garments SET cutout_kind='bbox'")).not.toThrow()
    expect(() => db.exec("UPDATE garments SET cutout_kind='otro'")).toThrow()
    db.close()
  })
})

describe('repositorio: recorte', () => {
  it('setCutout guarda el blob y reemplazar borra el anterior', async () => {
    const { repo, g, photo } = await withGarment()
    expect(g).toMatchObject({ cutout_path: null, cutout_kind: null })
    const first = await repo.setCutout(g.id, png(), 'mask')
    expect(first.cutout_path).toMatch(/^cutout:/)
    expect(first.cutout_kind).toBe('mask')
    expect(await repo.getPhoto(first.cutout_path!)).not.toBeNull()
    expect(await repo.get(g.id)).toMatchObject({ cutout_path: first.cutout_path, cutout_kind: 'mask', photo_path: photo })

    const second = await repo.setCutout(g.id, jpg(), 'bbox')
    expect(second.cutout_path).not.toBe(first.cutout_path)
    expect(await repo.getPhoto(first.cutout_path!)).toBeNull()
    expect(await repo.getPhoto(second.cutout_path!)).not.toBeNull()
    expect((await repo.get(g.id))?.cutout_kind).toBe('bbox')
    repo.close()
  })

  it('clearCutout quita columnas y blob; la foto original se conserva', async () => {
    const { repo, g, photo } = await withGarment()
    const withCut = await repo.setCutout(g.id, png(), 'mask')
    const cleared = await repo.clearCutout(g.id)
    expect(cleared).toMatchObject({ cutout_path: null, cutout_kind: null })
    expect(await repo.getPhoto(withCut.cutout_path!)).toBeNull()
    expect(await repo.getPhoto(photo)).not.toBeNull()
    repo.close()
  })

  it('exige que la prenda exista y tenga foto', async () => {
    const { repo } = await withGarment()
    const noPhoto = await repo.create({ category: 'top', formality: 3, warmth: 2 })
    await expect(repo.setCutout(noPhoto.id, png(), 'mask')).rejects.toThrow()
    await expect(repo.setCutout('nope', png(), 'mask')).rejects.toThrow()
    repo.close()
  })

  it('borrar la prenda borra foto y recorte', async () => {
    const { repo, g, photo } = await withGarment()
    const { cutout_path } = await repo.setCutout(g.id, png(), 'mask')
    await repo.delete(g.id)
    expect(await repo.getPhoto(photo)).toBeNull()
    expect(await repo.getPhoto(cutout_path!)).toBeNull()
    repo.close()
  })

  it('editar sin cambiar la foto conserva el recorte; cambiar la foto lo descarta junto con su blob', async () => {
    const { repo, g, photo } = await withGarment()
    const { cutout_path } = await repo.setCutout(g.id, png(), 'mask')
    const same = await repo.update(g.id, { ...(await repo.get(g.id))!, subcategory: 'Polo' })
    expect(same).toMatchObject({ cutout_path, cutout_kind: 'mask' })
    expect(await repo.getPhoto(cutout_path!)).not.toBeNull()

    const newPhoto = await repo.savePhoto(jpg())
    const changed = await repo.update(g.id, { ...(await repo.get(g.id))!, photo_path: newPhoto })
    expect(changed).toMatchObject({ cutout_path: null, cutout_kind: null })
    expect(await repo.get(g.id)).toMatchObject({ cutout_path: null, cutout_kind: null })
    expect(await repo.getPhoto(cutout_path!)).toBeNull()
    expect(await repo.getPhoto(photo)).toBeNull()
    repo.close()
  })

  it('quitar la foto también descarta el recorte', async () => {
    const { repo, g } = await withGarment()
    const { cutout_path } = await repo.setCutout(g.id, png(), 'mask')
    await repo.update(g.id, { ...(await repo.get(g.id))!, photo_path: null })
    expect(await repo.getPhoto(cutout_path!)).toBeNull()
    expect((await repo.get(g.id))?.cutout_path).toBeNull()
    repo.close()
  })
})

describe('respaldo con recortes', () => {
  it('ida y vuelta: los recortes viajan en el zip (png/jpg) y se restauran', async () => {
    const { repo, g, photo } = await withGarment()
    const g2 = await repo.create({ category: 'bottom', formality: 2, warmth: 2, photo_path: await repo.savePhoto(jpg()) })
    const a = await repo.setCutout(g.id, png(), 'mask')
    const b = await repo.setCutout(g2.id, jpg(), 'bbox')
    const before = await repo.list()
    const { file, manifest } = await createBackup(new IndexedDbStorage(NAME))
    repo.close()

    expect(manifest).toMatchObject({ schemaVersion: MIGRATIONS.length, photoCount: 2, cutoutCount: 2 })
    const names = Object.keys(unzipSync(new Uint8Array(await file.arrayBuffer())))
    expect(names).toContain(`photos/${a.cutout_path}.png`)
    expect(names).toContain(`photos/${b.cutout_path}.jpg`)
    expect(names).toContain(`photos/${photo}.jpg`)

    globalThis.indexedDB = new IDBFactory()
    const clean = new IndexedDbStorage(NAME)
    await importBackup(file, clean)
    const restored = await SqliteGarmentRepository.open(clean)
    expect(await restored.list()).toEqual(before)
    const blobA = await restored.getPhoto(a.cutout_path!)
    expect(blobA?.type).toBe('image/png')
    expect(new Uint8Array(await blobA!.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
    expect((await restored.getPhoto(b.cutout_path!))?.type).toBe('image/jpeg')
    restored.close()
  })

  it('importa un respaldo de la versión 4 (sin recortes) y migra sin perder datos', async () => {
    const sqlite3 = await getSqliteStatic()
    const old = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(old, MIGRATIONS.slice(0, 4))
    old.exec("INSERT INTO garments (id, category, formality, warmth, photo_path, created_at) VALUES ('v4','top',3,3,'photo:abc','now')")
    const bytes = sqlite3.capi.sqlite3_js_db_export(old.pointer!)
    old.close()
    const manifest = { app: 'armario', format: 1, schemaVersion: 4, exportedAt: 'now', garmentCount: 1, photoCount: 1 }
    const zip = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
      'armario.sqlite': bytes,
      'photos/photo:abc.jpg': new Uint8Array([1, 2, 3]),
    })
    const storage = new IndexedDbStorage(NAME)
    await importBackup(new Blob([zip as BlobPart]), storage)
    const repo = await SqliteGarmentRepository.open(storage)
    expect(await repo.list()).toMatchObject([{ id: 'v4', photo_path: 'photo:abc', cutout_path: null, cutout_kind: null }])
    expect(await repo.getPhoto('photo:abc')).not.toBeNull()
    repo.close()
  })
})
