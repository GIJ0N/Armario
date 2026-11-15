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
import { commitOutfitEdit, createManualOutfit } from '../src/outfits/edit'

const NAME = 'test-fase13'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const open = () => SqliteGarmentRepository.open(new IndexedDbStorage(NAME))

describe('migración 0007', () => {
  it('sobre una base v6 con datos: conserva todo y agrega canvas_adjust y canvas_layout nulos', async () => {
    const sqlite3 = await getSqliteStatic()
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(db, MIGRATIONS.slice(0, 6))
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(6)
    db.exec("INSERT INTO garments (id, category, formality, warmth, created_at, favorite) VALUES ('g1','top',3,3,'now',1)")
    db.exec("INSERT INTO outfits (id, garment_ids, occasion, reasoning, source, created_at, saved_at, name) VALUES ('o1','[\"g1\"]','office','r','ai','now','then','Mi outfit')")
    db.exec("INSERT INTO wears (id, outfit_id, date) VALUES ('w1','o1','2026-11-10')")
    expect(runMigrations(db)).toBe(true)
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(MIGRATIONS.length)
    expect(MIGRATIONS).toHaveLength(8)
    expect(db.selectObjects('SELECT id, favorite, canvas_adjust FROM garments')).toEqual([{ id: 'g1', favorite: 1, canvas_adjust: null }])
    expect(db.selectObjects('SELECT id, name, saved_at, canvas_layout FROM outfits')).toEqual([
      { id: 'o1', name: 'Mi outfit', saved_at: 'then', canvas_layout: null },
    ])
    expect(Number(db.selectValue('SELECT COUNT(*) FROM wears'))).toBe(1)
    db.close()
  })

  it('openSqlite respalda antes de migrar una instantánea v6 y un respaldo v6 se importa', async () => {
    const sqlite3 = await getSqliteStatic()
    const old = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(old, MIGRATIONS.slice(0, 6))
    old.exec("INSERT INTO garments (id, category, formality, warmth, created_at) VALUES ('x','top',3,3,'now')")
    const bytes = sqlite3.capi.sqlite3_js_db_export(old.pointer!)
    old.close()
    const storage = new IndexedDbStorage(NAME)
    await storage.saveSnapshot(bytes)
    const repo = await SqliteGarmentRepository.open(storage)
    expect((await repo.list())[0]).toMatchObject({ id: 'x', canvas_adjust: null })
    repo.close()
    const { openDB } = await import('idb')
    const idb = await openDB(NAME, 1)
    expect((await idb.getAllKeys('snapshot')).map(String)).toContain('backup:pre-migration-v6')
    idb.close()

    const manifest = { app: 'armario', format: 1, schemaVersion: 6, exportedAt: 'now', garmentCount: 1, photoCount: 0 }
    const zip = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)), 'armario.sqlite': bytes })
    globalThis.indexedDB = new IDBFactory()
    const s2 = new IndexedDbStorage(NAME)
    await importBackup(new Blob([zip as BlobPart]), s2)
    const r2 = await SqliteGarmentRepository.open(s2)
    expect((await r2.list())[0].id).toBe('x')
    expect((await createBackup(s2)).manifest.schemaVersion).toBe(MIGRATIONS.length)
    r2.close()
  })
})

describe('repositorio: lienzo ajustable', () => {
  it('setCanvasAdjust: ida y vuelta, normaliza, null lo quita y sobrevive a update/setStatus', async () => {
    const repo = await open()
    const g = await repo.create({ category: 'bottom', formality: 3, warmth: 2 })
    expect(g.canvas_adjust).toBeNull()
    expect((await repo.setCanvasAdjust(g.id, { scale: 1.155, dx: 3, dy: 0 })).canvas_adjust).toEqual({ scale: 1.16, dx: 3, dy: 0 })
    expect((await repo.get(g.id))?.canvas_adjust).toEqual({ scale: 1.16, dx: 3, dy: 0 })
    const edited = await repo.update(g.id, { category: 'bottom', formality: 4, warmth: 2 })
    expect(edited.canvas_adjust).toEqual({ scale: 1.16, dx: 3, dy: 0 })
    expect((await repo.setStatus(g.id, 'laundry')).canvas_adjust).toEqual({ scale: 1.16, dx: 3, dy: 0 })
    expect((await repo.setCanvasAdjust(g.id, { scale: 9, dx: 0, dy: 0 })).canvas_adjust?.scale).toBe(2)
    expect((await repo.setCanvasAdjust(g.id, { scale: 1, dx: 0, dy: 0 })).canvas_adjust).toBeNull()
    expect((await repo.get(g.id))?.canvas_adjust).toBeNull()
    await expect(repo.setCanvasAdjust('nope', null)).rejects.toThrow()
    repo.close()
  })

  it('setCanvasLayout: ida y vuelta, null lo quita, y JSON inválido en la base se ignora sin lanzar', async () => {
    const repo = await open()
    const a = await repo.create({ category: 'top', formality: 3, warmth: 2 })
    const o = await repo.outfits.create({ garment_ids: [a.id], occasion: 'casual', weather_snapshot: null, reasoning: 'r', source: 'ai' })
    expect(o.canvas_layout ?? null).toBeNull()
    const layout = { [a.id]: { dx: 4, dy: -2, scale: 1.2, z: 1 } }
    expect((await repo.outfits.setCanvasLayout(o.id, layout)).canvas_layout).toEqual(layout)
    expect((await repo.outfits.get(o.id))?.canvas_layout).toEqual(layout)
    expect((await repo.outfits.listSaved()).length).toBe(0)
    expect((await repo.outfits.setCanvasLayout(o.id, {})).canvas_layout).toBeNull()
    await expect(repo.outfits.setCanvasLayout('nope', null)).rejects.toThrow()

    // JSON dañado directamente en la base.
    const internal = repo as unknown as { db: { exec: (s: string) => void } }
    internal.db.exec(`UPDATE outfits SET canvas_layout='{no json' WHERE id='${o.id}'`)
    internal.db.exec(`UPDATE garments SET canvas_adjust='[1,2]' WHERE id='${a.id}'`)
    expect((await repo.outfits.get(o.id))?.canvas_layout).toBeNull()
    expect((await repo.get(a.id))?.canvas_adjust).toBeNull()
    expect((await repo.list())).toHaveLength(1)
    repo.close()
  })
})

describe('commitOutfitEdit y lienzo', () => {
  async function setup() {
    const repo = await open()
    const top = await repo.create({ category: 'top', formality: 3, warmth: 2 })
    const top2 = await repo.create({ category: 'top', formality: 3, warmth: 2 })
    const bot = await repo.create({ category: 'bottom', formality: 3, warmth: 2 })
    const o = await repo.outfits.create({ garment_ids: [top.id, bot.id], occasion: 'casual', weather_snapshot: null, reasoning: 'r', source: 'ai' })
    const layout = { [top.id]: { dx: 5, dy: 0, scale: 1.3, z: 1 }, [bot.id]: { dx: 0, dy: 4, scale: 1.1, z: 0 } }
    const original = await repo.outfits.setCanvasLayout(o.id, layout)
    const categoryOf = (id: string) => (id === bot.id ? 'bottom' : 'top')
    return { repo, top, top2, bot, original, layout, categoryOf }
  }

  it('fila nueva (con historial): conserva las entradas de prendas que se quedan y descarta las de la quitada', async () => {
    const { repo, top, top2, bot, original, layout, categoryOf } = await setup()
    await repo.wears.create(original.id, '2026-11-10')
    const res = await commitOutfitEdit(repo, {
      original,
      baseIds: [top.id, bot.id],
      next: { garmentIds: [top2.id, bot.id], occasion: 'casual', weather: null },
      categoryOf,
    })
    expect(res.createdNew).toBe(true)
    expect(res.outfit.canvas_layout).toEqual({ [bot.id]: layout[bot.id] })
    expect((await repo.outfits.get(res.outfit.id))?.canvas_layout).toEqual({ [bot.id]: layout[bot.id] })
    // La original conserva el suyo.
    expect((await repo.outfits.get(original.id))?.canvas_layout).toEqual(layout)
    repo.close()
  })

  it('en su lugar (sin historial): poda las entradas de prendas quitadas', async () => {
    const { repo, top, top2, bot, original, layout, categoryOf } = await setup()
    const res = await commitOutfitEdit(repo, {
      original,
      baseIds: [top.id, bot.id],
      next: { garmentIds: [top2.id, bot.id], occasion: 'casual', weather: null },
      categoryOf,
    })
    expect(res.createdNew).toBe(false)
    expect(res.outfit.id).toBe(original.id)
    expect((await repo.outfits.get(original.id))?.canvas_layout).toEqual({ [bot.id]: layout[bot.id] })
    repo.close()
  })

  it('si el outfit guardado se copia, el guardado y el ajuste pasan a la fila nueva; createManualOutfit guarda el ajuste', async () => {
    const { repo, top, bot, original, layout, categoryOf } = await setup()
    await repo.outfits.save(original.id, 'Mío')
    await repo.wears.create(original.id, '2026-11-10')
    const res = await commitOutfitEdit(repo, {
      original: (await repo.outfits.get(original.id))!,
      baseIds: [top.id, bot.id],
      next: { garmentIds: [top.id, bot.id], occasion: 'office', weather: null },
      categoryOf,
    })
    expect(res.outfit).toMatchObject({ name: 'Mío', canvas_layout: layout })
    const made = await createManualOutfit(repo, { garmentIds: [top.id, bot.id], occasion: 'casual', canvasLayout: { ...layout, ghost: { dx: 1, dy: 0, scale: 1, z: 0 } }, categoryOf })
    expect(made.canvas_layout).toEqual(layout)
    repo.close()
  })
})
