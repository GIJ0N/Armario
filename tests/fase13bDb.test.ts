// @vitest-environment node
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { createBackup, importBackup } from '../src/db/backup'
import { MIGRATIONS } from '../src/db/migrations'
import { SqliteGarmentRepository } from '../src/db/repository'
import { getSqliteStatic, openSqlite, runMigrations } from '../src/db/sqlite'
import { IndexedDbStorage } from '../src/db/storage'
import { addDays, localDateString } from '../src/lib/date'
import { commitOutfitEdit } from '../src/outfits/edit'

const NAME = 'test-fase13b'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const open = () => SqliteGarmentRepository.open(new IndexedDbStorage(NAME))
const TODAY = localDateString()
const YESTERDAY = addDays(TODAY, -1)
const TOMORROW = addDays(TODAY, 1)

async function seed(repo: SqliteGarmentRepository) {
  const top = await repo.create({ category: 'top', formality: 3, warmth: 2 })
  const top2 = await repo.create({ category: 'top', formality: 3, warmth: 2 })
  const bottom = await repo.create({ category: 'bottom', formality: 3, warmth: 2 })
  const shoes = await repo.create({ category: 'shoes', formality: 3, warmth: 2 })
  const outfit = await repo.outfits.create({
    garment_ids: [top.id, bottom.id, shoes.id],
    occasion: 'casual',
    weather_snapshot: null,
    reasoning: 'r',
    source: 'rules',
  })
  return { top, top2, bottom, shoes, outfit }
}

describe('migración 0008', () => {
  it('sobre una base v7 con datos: conserva todo y agrega planned_outfits vacía', async () => {
    const sqlite3 = await getSqliteStatic()
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(db, MIGRATIONS.slice(0, 7))
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(7)
    db.exec("INSERT INTO garments (id, category, formality, warmth, created_at, favorite, canvas_adjust) VALUES ('g1','top',3,3,'now',1,'{\"scale\":1.1,\"dx\":0,\"dy\":0}')")
    db.exec("INSERT INTO outfits (id, garment_ids, occasion, reasoning, source, created_at, saved_at, name) VALUES ('o1','[\"g1\"]','office','r','ai','now','then','Mi outfit')")
    db.exec("INSERT INTO wears (id, outfit_id, date) VALUES ('w1','o1','2026-11-10')")
    expect(runMigrations(db)).toBe(true)
    expect(MIGRATIONS).toHaveLength(8)
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(8)
    expect(db.selectObjects('SELECT id, favorite FROM garments')).toEqual([{ id: 'g1', favorite: 1 }])
    expect(db.selectObjects('SELECT id, name FROM outfits')).toEqual([{ id: 'o1', name: 'Mi outfit' }])
    expect(Number(db.selectValue('SELECT COUNT(*) FROM wears'))).toBe(1)
    expect(Number(db.selectValue('SELECT COUNT(*) FROM planned_outfits'))).toBe(0)
    const columns = db.selectObjects("SELECT name FROM pragma_table_info('planned_outfits')").map((r) => r.name)
    expect(columns).toEqual(['id', 'outfit_id', 'date', 'occasion', 'created_at'])
    expect(db.selectValue("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_planned_outfits_date'")).toBe('idx_planned_outfits_date')
    db.close()
  })

  it('openSqlite respalda antes de migrar una instantánea v7 y deja la base en v8', async () => {
    const sqlite3 = await getSqliteStatic()
    const old = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(old, MIGRATIONS.slice(0, 7))
    old.exec("INSERT INTO garments (id, category, formality, warmth, created_at) VALUES ('x','top',3,3,'now')")
    const bytes = sqlite3.capi.sqlite3_js_db_export(old.pointer!)
    old.close()
    const storage = new IndexedDbStorage(NAME)
    await storage.saveSnapshot(bytes)
    const repo = await SqliteGarmentRepository.open(storage)
    expect((await repo.list())[0].id).toBe('x')
    expect(await repo.plans.listBetween('2000-01-01', '2100-01-01')).toEqual([])
    repo.close()
    const { openDB } = await import('idb')
    const idb = await openDB(NAME, 1)
    expect((await idb.getAllKeys('snapshot')).map(String)).toContain('backup:pre-migration-v7')
    idb.close()
  })

  it('la clave foránea borra el plan junto con su outfit (PRAGMA foreign_keys activo al abrir)', async () => {
    const storage = new IndexedDbStorage(NAME)
    const db = await openSqlite(storage)
    db.exec("INSERT INTO outfits (id, garment_ids, occasion, reasoning, source, created_at) VALUES ('o1','[]','casual','r','ai','now')")
    db.exec("INSERT INTO planned_outfits (id, outfit_id, date, created_at) VALUES ('p1','o1','2026-11-20','now')")
    expect(() => db.exec("INSERT INTO planned_outfits (id, outfit_id, date, created_at) VALUES ('p2','o1','2026-11-20','now')")).toThrow()
    expect(() => db.exec("INSERT INTO planned_outfits (id, outfit_id, date, created_at) VALUES ('p3','nope','2026-11-20','now')")).toThrow()
    db.exec("DELETE FROM outfits WHERE id='o1'")
    expect(Number(db.selectValue('SELECT COUNT(*) FROM planned_outfits'))).toBe(0)
    db.close()
  })
})

describe('repositorio: planes', () => {
  it('create es idempotente por (outfit, fecha), valida y guarda la ocasión', async () => {
    const repo = await open()
    const { outfit } = await seed(repo)
    const a = await repo.plans.create(outfit.id, TOMORROW, 'office')
    const b = await repo.plans.create(outfit.id, TOMORROW)
    expect(b.id).toBe(a.id)
    expect(b.occasion).toBe('office')
    const c = await repo.plans.create(outfit.id, TOMORROW, 'gym')
    expect(c.id).toBe(a.id)
    expect(c.occasion).toBe('gym')
    expect(await repo.plans.listBetween(TOMORROW, TOMORROW)).toHaveLength(1)
    await expect(repo.plans.create(outfit.id, '16-11-2026')).rejects.toThrow(/Fecha inválida/)
    await expect(repo.plans.create('nope', TOMORROW)).rejects.toThrow(/Outfit no encontrado/)
    repo.close()
  })

  it('listBetween: rango inclusivo, por fecha, con los datos del outfit; wears.listBetween igual', async () => {
    const repo = await open()
    const { outfit, top, bottom, shoes } = await seed(repo)
    const other = await repo.outfits.create({ garment_ids: [top.id], occasion: 'gym', weather_snapshot: null, reasoning: 'otra', source: 'manual' })
    await repo.plans.create(other.id, '2026-12-02')
    await repo.plans.create(outfit.id, '2026-12-01')
    await repo.plans.create(outfit.id, '2026-12-03')
    await repo.plans.create(outfit.id, '2026-12-04')
    const list = await repo.plans.listBetween('2026-12-01', '2026-12-03')
    expect(list.map((p) => p.date)).toEqual(['2026-12-01', '2026-12-02', '2026-12-03'])
    expect(list[0]).toMatchObject({ outfitId: outfit.id, garmentIds: [top.id, bottom.id, shoes.id], outfitOccasion: 'casual', occasion: null })
    expect(list[1]).toMatchObject({ outfitId: other.id, outfitOccasion: 'gym' })
    expect((await repo.plans.listForOutfit(outfit.id)).map((p) => p.date)).toEqual(['2026-12-01', '2026-12-03', '2026-12-04'])

    for (const d of ['2026-11-30', '2026-12-01', '2026-12-31', '2027-01-01']) await repo.wears.create(outfit.id, d)
    expect((await repo.wears.listBetween('2026-12-01', '2026-12-31')).map((w) => w.date)).toEqual(['2026-12-01', '2026-12-31'])
    repo.close()
  })

  it('remove quita solo el plan', async () => {
    const repo = await open()
    const { outfit } = await seed(repo)
    const p = await repo.plans.create(outfit.id, TOMORROW)
    await repo.plans.remove(p.id)
    expect(await repo.plans.listBetween(TOMORROW, TOMORROW)).toEqual([])
    expect(await repo.outfits.get(outfit.id)).not.toBeNull()
    repo.close()
  })

  it('convertToWear: crea el uso y borra el plan en una transacción; un día futuro falla sin cambiar nada', async () => {
    const repo = await open()
    const { outfit } = await seed(repo)
    const past = await repo.plans.create(outfit.id, YESTERDAY)
    const wear = await repo.plans.convertToWear(past.id)
    expect(wear).toMatchObject({ outfit_id: outfit.id, date: YESTERDAY })
    expect(await repo.plans.listBetween(YESTERDAY, YESTERDAY)).toEqual([])
    expect((await repo.wears.listBetween(YESTERDAY, YESTERDAY)).map((w) => w.outfitId)).toEqual([outfit.id])

    // Si ya hay un uso de ese outfit ese día no se duplica.
    const again = await repo.plans.create(outfit.id, YESTERDAY)
    const same = await repo.plans.convertToWear(again.id)
    expect(same.id).toBe(wear.id)
    expect(await repo.wears.listBetween(YESTERDAY, YESTERDAY)).toHaveLength(1)

    const future = await repo.plans.create(outfit.id, TOMORROW)
    await expect(repo.plans.convertToWear(future.id)).rejects.toThrow(/futuro/)
    expect(await repo.plans.listBetween(TOMORROW, TOMORROW)).toHaveLength(1)
    expect(await repo.wears.listBetween(TOMORROW, TOMORROW)).toEqual([])
    await expect(repo.plans.convertToWear('nope')).rejects.toThrow(/Plan no encontrado/)
    repo.close()
  })

  it('un plan sobrevive a un respaldo exportado e importado', async () => {
    const storage = new IndexedDbStorage(NAME)
    const repo = await SqliteGarmentRepository.open(storage)
    const { outfit } = await seed(repo)
    await repo.plans.create(outfit.id, TOMORROW, 'office')
    const { file } = await createBackup(storage)
    repo.close()
    globalThis.indexedDB = new IDBFactory()
    const s2 = new IndexedDbStorage(NAME)
    await importBackup(file, s2)
    const r2 = await SqliteGarmentRepository.open(s2)
    expect((await r2.plans.listBetween(TOMORROW, TOMORROW)).map((p) => p.occasion)).toEqual(['office'])
    r2.close()
  })
})

describe('editar un outfit planeado (commitOutfitEdit)', () => {
  const edit = (repo: SqliteGarmentRepository, original: Awaited<ReturnType<typeof seed>>['outfit'], garmentIds: string[], extra: { planId?: string; wearDate?: string }) =>
    commitOutfitEdit(repo, {
      original,
      baseIds: original.garment_ids,
      next: { garmentIds, occasion: original.occasion, weather: null },
      categoryOf: () => 'top',
      ...extra,
    })

  it('sin historial se edita en su lugar y el plan sigue apuntando al mismo outfit', async () => {
    const repo = await open()
    const { outfit, top2, bottom, shoes } = await seed(repo)
    const plan = await repo.plans.create(outfit.id, TOMORROW)
    const res = await edit(repo, outfit, [top2.id, bottom.id, shoes.id], { planId: plan.id })
    expect(res.createdNew).toBe(false)
    const [after] = await repo.plans.listBetween(TOMORROW, TOMORROW)
    expect(after.outfitId).toBe(outfit.id)
    expect(after.garmentIds).toEqual([top2.id, bottom.id, shoes.id])
    repo.close()
  })

  it('con historial se crea una fila nueva y el plan se mueve a ella; el uso anterior se queda con la original', async () => {
    const repo = await open()
    const { outfit, top2, bottom, shoes } = await seed(repo)
    await repo.wears.create(outfit.id, YESTERDAY)
    const plan = await repo.plans.create(outfit.id, TOMORROW)
    const res = await edit(repo, outfit, [top2.id, bottom.id, shoes.id], { planId: plan.id })
    expect(res.createdNew).toBe(true)
    expect(res.outfit.id).not.toBe(outfit.id)
    const [after] = await repo.plans.listBetween(TOMORROW, TOMORROW)
    expect(after).toMatchObject({ id: plan.id, outfitId: res.outfit.id })
    expect((await repo.wears.listBetween(YESTERDAY, YESTERDAY))[0].outfitId).toBe(outfit.id)
    repo.close()
  })

  it('un outfit planeado también para otro día no se reescribe: solo se mueve el plan editado', async () => {
    const repo = await open()
    const { outfit, top2, bottom, shoes } = await seed(repo)
    const p1 = await repo.plans.create(outfit.id, TOMORROW)
    const p2 = await repo.plans.create(outfit.id, addDays(TOMORROW, 1))
    const res = await edit(repo, outfit, [top2.id, bottom.id, shoes.id], { planId: p1.id })
    expect(res.createdNew).toBe(true)
    const list = await repo.plans.listBetween(TOMORROW, addDays(TOMORROW, 1))
    expect(list.find((p) => p.id === p1.id)?.outfitId).toBe(res.outfit.id)
    expect(list.find((p) => p.id === p2.id)?.outfitId).toBe(outfit.id)
    expect((await repo.outfits.get(outfit.id))?.garment_ids).toEqual(outfit.garment_ids)
    repo.close()
  })

  it('editar un día ya usado mueve ese uso a la fila nueva', async () => {
    const repo = await open()
    const { outfit, top2, bottom, shoes } = await seed(repo)
    await repo.wears.create(outfit.id, YESTERDAY)
    const res = await edit(repo, outfit, [top2.id, bottom.id, shoes.id], { wearDate: YESTERDAY })
    expect(res.createdNew).toBe(true)
    const wears = await repo.wears.listBetween(YESTERDAY, YESTERDAY)
    expect(wears.map((w) => w.outfitId)).toEqual([res.outfit.id])
    repo.close()
  })

  it('setOutfit en un día donde el nuevo outfit ya está planeado no duplica', async () => {
    const repo = await open()
    const { outfit, top2 } = await seed(repo)
    const other = await repo.outfits.create({ garment_ids: [top2.id], occasion: 'gym', weather_snapshot: null, reasoning: '', source: 'manual' })
    const p1 = await repo.plans.create(outfit.id, TOMORROW)
    await repo.plans.create(other.id, TOMORROW)
    await repo.plans.setOutfit(p1.id, other.id)
    expect(await repo.plans.listBetween(TOMORROW, TOMORROW)).toHaveLength(1)
    repo.close()
  })
})
