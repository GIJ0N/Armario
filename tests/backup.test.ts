// @vitest-environment node
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { strFromU8, unzipSync, zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { BackupError, createBackup, importBackup } from '../src/db/backup'
import { MIGRATIONS } from '../src/db/migrations'
import { SqliteGarmentRepository } from '../src/db/repository'
import { getSqliteStatic, runMigrations } from '../src/db/sqlite'
import { IndexedDbStorage } from '../src/db/storage'

const NAME = 'test-backup'
const weather = null

async function seed() {
  const storage = new IndexedDbStorage(NAME)
  const repo = await SqliteGarmentRepository.open(storage)
  const photoKey = await repo.savePhoto(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }))
  const g = await repo.create({ category: 'top', formality: 3, warmth: 2, subcategory: 'Camisa', photo_path: photoKey })
  const g2 = await repo.create({ category: 'bottom', formality: 2, warmth: 2, subcategory: 'Chinos' })
  const o = await repo.outfits.create({ garment_ids: [g.id, g2.id], occasion: 'office', weather_snapshot: weather, reasoning: 'x', source: 'rules' })
  await repo.wears.create(o.id, '2026-11-14')
  return { repo, g, g2, o, photoKey }
}

async function dump(repo: SqliteGarmentRepository) {
  return {
    garments: await repo.list(),
    outfits: await repo.outfits.listRecent(3650),
    wears: await repo.wears.listHistory(),
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  localStorage_reset()
})
function localStorage_reset() {
  const store: Record<string, string> = {}
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
  }
}

describe('respaldo', () => {
  it('exporta, borra IndexedDB e importa: prendas, outfits, usos y fotos idénticos', async () => {
    const { repo, photoKey } = await seed()
    const before = await dump(repo)
    const storage = new IndexedDbStorage(NAME)
    const { file, filename, manifest } = await createBackup(storage, new Date(2026, 10, 14, 12))
    repo.close()

    expect(filename).toBe('armario-respaldo-2026-11-14.zip')
    expect(manifest).toMatchObject({ app: 'armario', format: 1, schemaVersion: MIGRATIONS.length, garmentCount: 2, photoCount: 1 })
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual(['armario.sqlite', 'manifest.json', `photos/${photoKey}.jpg`].sort())
    expect(JSON.parse(strFromU8(entries['manifest.json']))).toEqual(manifest)

    // Instalación limpia.
    globalThis.indexedDB = new IDBFactory()
    const clean = new IndexedDbStorage(NAME)
    const imported = await importBackup(file, clean)
    expect(imported.garmentCount).toBe(2)

    const restored = await SqliteGarmentRepository.open(clean)
    expect(await dump(restored)).toEqual(before)
    const photo = await restored.getPhoto(photoKey)
    expect(new Uint8Array(await photo!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
    restored.close()
  })

  it('nunca incluye ajustes ni la API key', async () => {
    const secret = 'AIza-SECRETO-123'
    localStorage.setItem('armario.settings', JSON.stringify({ geminiApiKey: secret }))
    const { repo } = await seed()
    const { file } = await createBackup(new IndexedDbStorage(NAME))
    repo.close()
    const bytes = new Uint8Array(await file.arrayBuffer())
    const needle = new TextEncoder().encode(secret)
    const contains = (hay: Uint8Array) => {
      outer: for (let i = 0; i <= hay.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
        return true
      }
      return false
    }
    expect(contains(bytes)).toBe(false)
    for (const data of Object.values(unzipSync(bytes))) expect(contains(data)).toBe(false)
  })

  it('guarda una copia pre-restore de la base actual y borra las fotos que no están en el respaldo', async () => {
    const { repo } = await seed()
    const { file } = await createBackup(new IndexedDbStorage(NAME))
    // Estado actual distinto: otra foto y otra prenda.
    const extraKey = await repo.savePhoto(new Blob(['zzz'], { type: 'image/jpeg' }))
    await repo.create({ category: 'shoes', formality: 1, warmth: 1, photo_path: extraKey })
    const storage = new IndexedDbStorage(NAME)
    const currentBytes = (await storage.loadSnapshot())!
    await importBackup(file, storage, new Date('2026-11-14T10:00:00Z'))
    expect(await storage.getPhoto(extraKey)).toBeNull()
    repo.close()

    const idb = await openDB(NAME, 1)
    const keys = (await idb.getAllKeys('snapshot')).map(String)
    const preKey = keys.find((k) => k.startsWith('backup:pre-restore-'))
    expect(preKey).toBeTruthy()
    expect(((await idb.get('snapshot', preKey!)) as Uint8Array).byteLength).toBe(currentBytes.byteLength)
    idb.close()
  })

  it('migra hacia adelante un respaldo viejo', async () => {
    const sqlite3 = await getSqliteStatic()
    const old = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(old, MIGRATIONS.slice(0, 1))
    old.exec("INSERT INTO garments (id, category, formality, warmth, created_at) VALUES ('x','top',3,3,'now')")
    const oldBytes = sqlite3.capi.sqlite3_js_db_export(old.pointer!)
    old.close()
    const manifest = { app: 'armario', format: 1, schemaVersion: 1, exportedAt: 'now', garmentCount: 1, photoCount: 0 }
    const zip = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)), 'armario.sqlite': oldBytes })
    const storage = new IndexedDbStorage(NAME)
    await importBackup(new Blob([zip as BlobPart]), storage)
    const repo = await SqliteGarmentRepository.open(storage)
    expect((await repo.list()).map((g) => g.id)).toEqual(['x'])
    repo.close()
  })

  describe('rechaza archivos inválidos sin tocar los datos', () => {
    async function expectRejected(blob: Blob, message: RegExp) {
      const { repo } = await seed()
      const storage = new IndexedDbStorage(NAME)
      const before = await storage.loadSnapshot()
      await expect(importBackup(blob, storage)).rejects.toThrow(BackupError)
      await expect(importBackup(blob, storage)).rejects.toThrow(message)
      expect(await storage.loadSnapshot()).toEqual(before)
      expect((await storage.listPhotos()).length).toBe(1)
      const idb = await openDB(NAME, 1)
      expect((await idb.getAllKeys('snapshot')).map(String).some((k) => k.startsWith('backup:pre-restore'))).toBe(false)
      idb.close()
      repo.close()
    }
    const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))
    const goodManifest = { app: 'armario', format: 1, schemaVersion: 1, exportedAt: 'now', garmentCount: 0, photoCount: 0 }

    it('zip inválido', async () => {
      await expectRejected(new Blob(['esto no es un zip']), /no se pudo leer el zip/)
    })
    it('app distinta', async () => {
      const zip = zipSync({ 'manifest.json': enc({ ...goodManifest, app: 'otra' }), 'armario.sqlite': new Uint8Array(200) })
      await expectRejected(new Blob([zip as BlobPart]), /no es un respaldo de Armario/)
    })
    it('esquema más nuevo', async () => {
      const zip = zipSync({ 'manifest.json': enc({ ...goodManifest, schemaVersion: MIGRATIONS.length + 1 }), 'armario.sqlite': new Uint8Array(200) })
      await expectRejected(new Blob([zip as BlobPart]), /versión más nueva/)
    })
    it('falta la base', async () => {
      const zip = zipSync({ 'manifest.json': enc(goodManifest) })
      await expectRejected(new Blob([zip as BlobPart]), /faltan archivos/)
    })
    it('base dañada', async () => {
      const zip = zipSync({ 'manifest.json': enc(goodManifest), 'armario.sqlite': new Uint8Array(200) })
      await expectRejected(new Blob([zip as BlobPart]), /dañado/)
    })
  })
})
