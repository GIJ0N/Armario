// @vitest-environment node
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { createBackup, importBackup } from '../src/db/backup'
import { MIGRATIONS } from '../src/db/migrations'
import { SqliteGarmentRepository } from '../src/db/repository'
import { getSqliteStatic, runMigrations } from '../src/db/sqlite'
import { IndexedDbStorage } from '../src/db/storage'
import { commitOutfitEdit, createManualOutfit, diffSwaps } from '../src/outfits/edit'

const NAME = 'test-fase12'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

async function open() {
  return SqliteGarmentRepository.open(new IndexedDbStorage(NAME))
}

describe('migración 0006', () => {
  it('sobre una base v5 con datos: conserva todo y agrega favorite, saved_at, name y outfit_swaps', async () => {
    const sqlite3 = await getSqliteStatic()
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(db, MIGRATIONS.slice(0, 5))
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(5)
    db.exec("INSERT INTO garments (id, category, formality, warmth, created_at) VALUES ('g1','top',3,3,'now'),('g2','bottom',3,3,'now')")
    db.exec(
      "INSERT INTO outfits (id, garment_ids, occasion, reasoning, source, created_at) VALUES ('o1','[\"g1\",\"g2\"]','office','r','ai','now')",
    )
    db.exec("INSERT INTO wears (id, outfit_id, date) VALUES ('w1','o1','2026-11-10')")
    db.exec("INSERT INTO feedback (id, outfit_id, rating, tags, comment, created_at) VALUES ('f1','o1','like','[]','','now')")

    expect(runMigrations(db)).toBe(true)
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(7)
    expect(db.selectObjects('SELECT id, favorite FROM garments ORDER BY id')).toEqual([
      { id: 'g1', favorite: 0 },
      { id: 'g2', favorite: 0 },
    ])
    expect(db.selectObjects('SELECT id, saved_at, name, garment_ids FROM outfits')).toEqual([
      { id: 'o1', saved_at: null, name: null, garment_ids: '["g1","g2"]' },
    ])
    expect(Number(db.selectValue('SELECT COUNT(*) FROM wears'))).toBe(1)
    expect(Number(db.selectValue('SELECT COUNT(*) FROM feedback'))).toBe(1)
    expect(Number(db.selectValue('SELECT COUNT(*) FROM outfit_swaps'))).toBe(0)
    expect(() => db.exec("UPDATE garments SET favorite = 1 WHERE id = 'g1'")).not.toThrow()
    expect(() => db.exec("UPDATE garments SET favorite = 2 WHERE id = 'g1'")).toThrow()
    db.close()
  })

  it('openSqlite guarda un respaldo antes de migrar una instantánea v5', async () => {
    const sqlite3 = await getSqliteStatic()
    const old = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(old, MIGRATIONS.slice(0, 5))
    old.exec("INSERT INTO garments (id, category, formality, warmth, created_at) VALUES ('x','top',3,3,'now')")
    const storage = new IndexedDbStorage(NAME)
    await storage.saveSnapshot(sqlite3.capi.sqlite3_js_db_export(old.pointer!))
    old.close()
    const repo = await SqliteGarmentRepository.open(storage)
    expect((await repo.list()).map((g) => [g.id, g.favorite])).toEqual([['x', false]])
    repo.close()
    const { openDB } = await import('idb')
    const idb = await openDB(NAME, 1)
    expect((await idb.getAllKeys('snapshot')).map(String)).toContain('backup:pre-migration-v5')
    idb.close()
  })

  it('un respaldo v5 se sigue importando y el manifiesto nuevo usa la versión actual', async () => {
    const sqlite3 = await getSqliteStatic()
    const old = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(old, MIGRATIONS.slice(0, 5))
    old.exec("INSERT INTO garments (id, category, formality, warmth, created_at) VALUES ('x','top',3,3,'now')")
    const bytes = sqlite3.capi.sqlite3_js_db_export(old.pointer!)
    old.close()
    const manifest = { app: 'armario', format: 1, schemaVersion: 5, exportedAt: 'now', garmentCount: 1, photoCount: 0 }
    const zip = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)), 'armario.sqlite': bytes })
    const storage = new IndexedDbStorage(NAME)
    await importBackup(new Blob([zip as BlobPart]), storage)
    const repo = await SqliteGarmentRepository.open(storage)
    const [g] = await repo.list()
    expect(g).toMatchObject({ id: 'x', favorite: false })
    await repo.setFavorite('x', true)
    const { manifest: fresh } = await createBackup(storage)
    expect(fresh.schemaVersion).toBe(MIGRATIONS.length)
    repo.close()
  })
})

describe('repositorio: favoritas', () => {
  it('setFavorite, crear favorita y conservar la marca al editar o cambiar el estado', async () => {
    const repo = await open()
    const a = await repo.create({ category: 'top', formality: 3, warmth: 2 })
    const b = await repo.create({ category: 'top', formality: 3, warmth: 2, favorite: true })
    expect(a.favorite).toBe(false)
    expect(b.favorite).toBe(true)
    expect((await repo.setFavorite(a.id, true)).favorite).toBe(true)
    // Editar sin indicar favorite no la borra.
    const edited = await repo.update(a.id, { category: 'top', formality: 4, warmth: 2, subcategory: 'Polo' })
    expect(edited.favorite).toBe(true)
    expect((await repo.setStatus(a.id, 'laundry')).favorite).toBe(true)
    expect((await repo.get(a.id))?.favorite).toBe(true)
    expect((await repo.setFavorite(a.id, false)).favorite).toBe(false)
    expect((await repo.list()).filter((g) => g.favorite).map((g) => g.id)).toEqual([b.id])
    await expect(repo.setFavorite('nope', true)).rejects.toThrow()
    repo.close()
  })
})

describe('repositorio: outfits guardados y cambios', () => {
  it('guardar con nombre, listar con último uso, quitar de guardados y actualizar en su lugar', async () => {
    const repo = await open()
    const g = await repo.create({ category: 'top', formality: 3, warmth: 2 })
    const h = await repo.create({ category: 'bottom', formality: 3, warmth: 2 })
    const o = await repo.outfits.create({ garment_ids: [g.id], occasion: 'office', weather_snapshot: null, reasoning: 'r', source: 'ai' })
    expect(await repo.outfits.listSaved()).toEqual([])
    const saved = await repo.outfits.save(o.id, '  Viernes  ')
    expect(saved.name).toBe('Viernes')
    expect(saved.saved_at).toBeTruthy()
    await repo.wears.create(o.id, '2026-11-01')
    await repo.wears.create(o.id, '2026-11-09')
    const list = await repo.outfits.listSaved()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ lastWorn: '2026-11-09', outfit: { id: o.id, name: 'Viernes' } })

    const updated = await repo.outfits.updateItems(o.id, { garmentIds: [g.id, h.id], reasoning: 'nuevo', occasion: 'casual' })
    expect(updated).toMatchObject({ garment_ids: [g.id, h.id], reasoning: 'nuevo', occasion: 'casual', source: 'manual', name: 'Viernes' })
    expect(await repo.outfits.hasHistory(o.id)).toBe(true)

    await repo.outfits.unsave(o.id)
    expect(await repo.outfits.listSaved()).toEqual([])
    // La fila (y su historial) se conserva.
    expect(await repo.outfits.get(o.id)).toMatchObject({ saved_at: null, name: null })
    expect((await repo.wears.listHistory()).length).toBe(2)
    await expect(repo.outfits.save('nope')).rejects.toThrow()
    repo.close()
  })

  it('swaps: registrar y listar, más recientes primero', async () => {
    const repo = await open()
    await repo.swaps.record([])
    await repo.swaps.record([
      { outfitId: 'o1', fromGarmentId: 'a', toGarmentId: 'b', createdAt: '2026-11-01T00:00:00.000Z' },
      { outfitId: 'o1', fromGarmentId: null, toGarmentId: 'c', createdAt: '2026-11-02T00:00:00.000Z' },
      { outfitId: null, fromGarmentId: 'd', toGarmentId: null, createdAt: '2026-11-03T00:00:00.000Z' },
    ])
    const list = await repo.swaps.list(10)
    expect(list.map((s) => [s.fromGarmentId, s.toGarmentId])).toEqual([['d', null], [null, 'c'], ['a', 'b']])
    expect(await repo.swaps.list(1)).toHaveLength(1)
    repo.close()
  })
})

describe('regla de edición (commitOutfitEdit)', () => {
  async function setup() {
    const repo = await open()
    const t1 = await repo.create({ category: 'top', formality: 3, warmth: 2, subcategory: 'polo' })
    const t2 = await repo.create({ category: 'top', formality: 3, warmth: 2, subcategory: 'camisa' })
    const b = await repo.create({ category: 'bottom', formality: 3, warmth: 2 })
    const s = await repo.create({ category: 'shoes', formality: 3, warmth: 2 })
    const cat = new Map([t1, t2, b, s].map((g) => [g.id, g.category]))
    const base = { occasion: 'casual' as const, weather: null }
    const original = await repo.outfits.create({
      garment_ids: [t1.id, b.id, s.id],
      occasion: 'casual',
      weather_snapshot: null,
      reasoning: 'ia',
      source: 'ai',
    })
    return { repo, t1, t2, b, s, original, base, categoryOf: (id: string): string | undefined => cat.get(id as never) }
  }

  it('sin calificación ni uso: actualiza en su lugar (pasa a manual) y registra el cambio', async () => {
    const { repo, t1, t2, b, s, original, base, categoryOf } = await setup()
    const res = await commitOutfitEdit(repo, {
      original,
      baseIds: original.garment_ids,
      next: { ...base, garmentIds: [t2.id, b.id, s.id] },
      categoryOf,
    })
    expect(res.createdNew).toBe(false)
    expect(res.outfit.id).toBe(original.id)
    expect(res.outfit).toMatchObject({ source: 'manual', garment_ids: [t2.id, b.id, s.id] })
    expect(await repo.outfits.listRecent(1)).toHaveLength(1)
    expect((await repo.swaps.list(10)).map((x) => [x.fromGarmentId, x.toGarmentId, x.outfitId])).toEqual([[t1.id, t2.id, original.id]])
    repo.close()
  })

  it('con un uso: crea una fila nueva manual y deja la original intacta con su uso', async () => {
    const { repo, t2, b, s, original, base, categoryOf } = await setup()
    await repo.wears.create(original.id, '2026-11-10')
    const res = await commitOutfitEdit(repo, {
      original,
      baseIds: original.garment_ids,
      next: { ...base, garmentIds: [t2.id, b.id, s.id] },
      categoryOf,
    })
    expect(res.createdNew).toBe(true)
    expect(res.outfit.id).not.toBe(original.id)
    expect(res.outfit.source).toBe('manual')
    expect((await repo.outfits.get(original.id))!.garment_ids).toEqual(original.garment_ids)
    expect((await repo.wears.listHistory()).map((w) => w.outfitId)).toEqual([original.id])
    repo.close()
  })

  it('con una calificación: crea una fila nueva y la calificación sigue en la original', async () => {
    const { repo, t2, b, s, original, base, categoryOf } = await setup()
    await repo.feedback.rate(original.id, 'like', [])
    const res = await commitOutfitEdit(repo, {
      original,
      baseIds: original.garment_ids,
      next: { ...base, garmentIds: [t2.id, b.id, s.id] },
      categoryOf,
    })
    expect(res.createdNew).toBe(true)
    expect(await repo.feedback.get(res.outfit.id)).toBeNull()
    expect((await repo.feedback.get(original.id))!.garmentIds).toEqual(original.garment_ids)
    repo.close()
  })

  it('si la original estaba guardada y tenía historial, el guardado y el nombre pasan a la nueva', async () => {
    const { repo, t2, b, s, original, base, categoryOf } = await setup()
    const saved = await repo.outfits.save(original.id, 'Mi favorito')
    await repo.wears.create(original.id, '2026-11-10')
    const res = await commitOutfitEdit(repo, {
      original: saved,
      baseIds: original.garment_ids,
      next: { ...base, garmentIds: [t2.id, b.id, s.id] },
      categoryOf,
    })
    const list = await repo.outfits.listSaved()
    expect(list.map((x) => x.outfit.id)).toEqual([res.outfit.id])
    expect(list[0].outfit.name).toBe('Mi favorito')
    expect((await repo.outfits.get(original.id))!.saved_at).toBeNull()
    repo.close()
  })

  it('sin outfit original (no estaba en el historial) crea uno manual', async () => {
    const { repo, t1, b, s, base, categoryOf } = await setup()
    const res = await commitOutfitEdit(repo, { original: null, baseIds: [t1.id, b.id, s.id], next: { ...base, garmentIds: [t1.id, b.id, s.id] }, categoryOf })
    expect(res.createdNew).toBe(true)
    expect(await repo.swaps.list(10)).toEqual([])
    repo.close()
  })

  it('createManualOutfit: manual, guardado con nombre y con una señal de «elegida» por prenda', async () => {
    const { repo, t1, b, s, categoryOf } = await setup()
    const o = await createManualOutfit(repo, { garmentIds: [t1.id, b.id, s.id], occasion: 'date', name: 'Cita', categoryOf })
    expect(o).toMatchObject({ source: 'manual', occasion: 'date', name: 'Cita' })
    expect((await repo.outfits.listSaved()).map((x) => x.outfit.id)).toEqual([o.id])
    const swaps = await repo.swaps.list(10)
    expect(swaps).toHaveLength(3)
    expect(swaps.every((x) => x.fromGarmentId === null && x.toGarmentId !== null)).toBe(true)
    repo.close()
  })
})

describe('diffSwaps', () => {
  const cat = (id: string) => id.split('-')[0]
  it('empareja por categoría y separa agregadas y quitadas', () => {
    expect(diffSwaps(['top-a', 'bot-a', 'out-a'], ['top-b', 'bot-a', 'acc-a'], cat)).toEqual([
      { fromGarmentId: 'top-a', toGarmentId: 'top-b' },
      { fromGarmentId: 'out-a', toGarmentId: null },
      { fromGarmentId: null, toGarmentId: 'acc-a' },
    ])
    expect(diffSwaps(['a'], ['a'], cat)).toEqual([])
  })
})
