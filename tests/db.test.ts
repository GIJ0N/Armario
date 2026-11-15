// @vitest-environment node
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteGarmentRepository } from '../src/db/repository'
import { IndexedDbStorage } from '../src/db/storage'
import { getSqliteStatic, runMigrations } from '../src/db/sqlite'
import { MIGRATIONS } from '../src/db/migrations'
import { openDB } from 'idb'
import { garmentInputSchema, type GarmentInput } from '../src/db/types'

const base: GarmentInput = { category: 'top', formality: 3, warmth: 2 }

async function open() {
  return SqliteGarmentRepository.open(new IndexedDbStorage('test-armario'))
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('migraciones', () => {
  it('crea las ocho tablas y fija user_version', async () => {
    const sqlite3 = await getSqliteStatic()
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    expect(runMigrations(db)).toBe(true)
    const tables = db
      .selectValues("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map(String)
    expect(tables).toEqual(
      ['feedback', 'garments', 'outfit_swaps', 'outfits', 'planned_outfits', 'purchase_evaluations', 'taste_profile', 'wears'].sort(),
    )
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(8)
    expect(runMigrations(db)).toBe(false)
    db.close()
  })

  it('las restricciones CHECK rechazan valores inválidos', async () => {
    const sqlite3 = await getSqliteStatic()
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(db)
    const insert = (cat: string, formality: number) =>
      db.exec({
        sql: "INSERT INTO garments (id, category, formality, warmth, created_at) VALUES ('x', ?, ?, 3, 'now')",
        bind: [cat, formality],
      })
    expect(() => insert('hat', 3)).toThrow()
    expect(() => insert('top', 6)).toThrow()
    expect(() => insert('top', 0)).toThrow()
    expect(() => insert('top', 5)).not.toThrow()
    db.close()
  })
})

describe('esquema de prenda', () => {
  it('exige categoría, formalidad y abrigo y aplica valores por defecto', () => {
    expect(garmentInputSchema.safeParse({}).success).toBe(false)
    expect(garmentInputSchema.safeParse({ ...base, formality: 6 }).success).toBe(false)
    const ok = garmentInputSchema.parse(base)
    expect(ok.status).toBe('active')
    expect(ok.fit).toBe('regular')
    expect(ok.colors).toEqual([])
  })
})

describe('repositorio', () => {
  it('CRUD de ida y vuelta', async () => {
    const repo = await open()
    const g = await repo.create({
      ...base,
      subcategory: 'Camisa',
      colors: ['azul', 'blanco'],
      occasions: ['office'],
      is_statement: true,
    })
    const got = await repo.get(g.id)
    expect(got).toMatchObject({ subcategory: 'Camisa', colors: ['azul', 'blanco'], occasions: ['office'], is_statement: true })
    await repo.update(g.id, { ...got!, subcategory: 'Polo', is_statement: false })
    expect((await repo.get(g.id))?.subcategory).toBe('Polo')
    expect((await repo.setStatus(g.id, 'laundry')).status).toBe('laundry')
    expect(await repo.list({ statuses: ['active'] })).toHaveLength(0)
    expect(await repo.list({ statuses: ['laundry'], category: 'top' })).toHaveLength(1)
    await repo.delete(g.id)
    expect(await repo.get(g.id)).toBeNull()
    repo.close()
  })

  it('guarda y borra fotos junto con la prenda', async () => {
    const repo = await open()
    const key = await repo.savePhoto(new Blob(['abc'], { type: 'image/jpeg' }))
    expect(key).toMatch(/^photo:/)
    const g = await repo.create({ ...base, photo_path: key })
    expect(await repo.getPhoto(key)).not.toBeNull()
    await repo.delete(g.id)
    expect(await repo.getPhoto(key)).toBeNull()
    repo.close()
  })

  it('persistencia: 10 prendas sobreviven a cerrar y reabrir desde IndexedDB', async () => {
    const repo = await open()
    for (let i = 0; i < 10; i++) {
      await repo.create({ ...base, subcategory: `Prenda ${i}`, formality: (i % 5) + 1 })
    }
    repo.close()

    const reopened = await open()
    const list = await reopened.list()
    expect(list).toHaveLength(10)
    expect(list.map((g) => g.subcategory).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `Prenda ${i}`).sort(),
    )
    reopened.close()
  })
})

describe('migración 0002 y OutfitRepository', () => {
  it('conserva outfits y wears existentes y acepta source "rules"', async () => {
    const { MIGRATIONS } = await import('../src/db/migrations')
    const sqlite3 = await getSqliteStatic()
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(db, [MIGRATIONS[0]])
    db.exec("INSERT INTO outfits (id, garment_ids, occasion, source, created_at) VALUES ('o1','[\"a\"]','casual','ai','2026-01-01T00:00:00Z')")
    db.exec("INSERT INTO wears (id, outfit_id, date) VALUES ('w1','o1','2026-01-02')")
    expect(() =>
      db.exec("INSERT INTO outfits (id, occasion, source, created_at) VALUES ('o2','casual','rules','now')"),
    ).toThrow()
    expect(runMigrations(db)).toBe(true)
    expect(db.selectValue('SELECT count(*) FROM outfits')).toBe(1)
    expect(db.selectValue('SELECT count(*) FROM wears')).toBe(1)
    expect(() =>
      db.exec("INSERT INTO outfits (id, occasion, source, created_at) VALUES ('o2','casual','rules','now')"),
    ).not.toThrow()
    expect(() =>
      db.exec("INSERT INTO outfits (id, occasion, source, created_at) VALUES ('o3','casual','otro','now')"),
    ).toThrow()
    db.close()
  })

  it('crea outfits y lista los recientes', async () => {
    const repo = await open()
    const weather = { tempC: 22, precipProbability: 10, isRaining: false, tempMinC: 18, tempMaxC: 26 }
    const o = await repo.outfits.create({
      garment_ids: ['a', 'b', 'c'],
      occasion: 'office',
      weather_snapshot: weather,
      reasoning: 'Camisa con chinos.',
      source: 'rules',
    })
    expect(o.id).toBeTruthy()
    const now = new Date()
    const recent = await repo.outfits.listRecent(14, now)
    expect(recent).toHaveLength(1)
    expect(recent[0]).toMatchObject({ garment_ids: ['a', 'b', 'c'], occasion: 'office', source: 'rules', weather_snapshot: weather })
    // Fuera de la ventana de días.
    expect(await repo.outfits.listRecent(14, new Date(now.getTime() + 20 * 86_400_000))).toEqual([])
    const noWeather = await repo.outfits.create({ garment_ids: ['x'], occasion: 'gym', weather_snapshot: null, reasoning: '', source: 'ai' })
    expect(noWeather.weather_snapshot).toBeNull()
    expect((await repo.outfits.listRecent(14))[0].id).toBe(noWeather.id)
    repo.close()
  })
})

describe('respaldo antes de migrar', () => {
  it('guarda una copia de la base vieja antes de aplicar migraciones pendientes', async () => {
    const sqlite3 = await getSqliteStatic()
    const old = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(old, MIGRATIONS.slice(0, 1))
    const oldBytes = sqlite3.capi.sqlite3_js_db_export(old.pointer!)
    old.close()

    const storage = new IndexedDbStorage('test-armario')
    await storage.saveSnapshot(oldBytes)
    const repo = await SqliteGarmentRepository.open(storage)
    await repo.list()

    const idb = await openDB('test-armario', 1)
    const backup = (await idb.get('snapshot', 'backup:pre-migration-v1')) as Uint8Array | undefined
    expect(backup?.byteLength).toBe(oldBytes.byteLength)
    idb.close()
  })
})

describe('WearRepository', () => {
  const weather = null
  const mkOutfit = (repo: SqliteGarmentRepository, ids: string[], occasion: 'office' | 'gym' = 'office') =>
    repo.outfits.create({ garment_ids: ids, occasion, weather_snapshot: weather, reasoning: `Razón ${ids.join('+')}`, source: 'rules' })
  const NOW = new Date(2026, 10, 14, 12, 0, 0) // 14 nov 2026, hora local

  it('registra usos, es idempotente y valida outfit y fecha', async () => {
    const repo = await open()
    const o = await mkOutfit(repo, ['a', 'b'])
    const w1 = await repo.wears.create(o.id, '2026-11-14')
    const w2 = await repo.wears.create(o.id, '2026-11-14')
    expect(w2.id).toBe(w1.id)
    expect(await repo.wears.listHistory()).toHaveLength(1)
    await expect(repo.wears.create('no-existe', '2026-11-14')).rejects.toThrow(/Outfit no encontrado/)
    await expect(repo.wears.create(o.id, '14/11/2026')).rejects.toThrow(/Fecha inválida/)
    repo.close()
  })

  it('listSince une outfits y filtra por ventana de días; deshacer borra solo ese uso', async () => {
    const repo = await open()
    const o1 = await mkOutfit(repo, ['a', 'b', 'c'])
    const o2 = await mkOutfit(repo, ['d', 'e'], 'gym')
    await repo.wears.create(o1.id, '2026-11-14')
    await repo.wears.create(o2.id, '2026-11-10')
    await repo.wears.create(o1.id, '2026-09-01')
    const since14 = await repo.wears.listSince(14, NOW)
    expect(since14.map((w) => [w.outfitId, w.garmentIds, w.date])).toEqual([
      [o1.id, ['a', 'b', 'c'], '2026-11-14'],
      [o2.id, ['d', 'e'], '2026-11-10'],
    ])
    expect(since14[1]).toMatchObject({ occasion: 'gym', reasoning: 'Razón d+e' })
    expect((await repo.wears.listSince(3, NOW)).map((w) => w.date)).toEqual(['2026-11-14'])
    expect((await repo.wears.listSince(80, NOW)).map((w) => w.date)).toEqual(['2026-11-14', '2026-11-10', '2026-09-01'])
    expect((await repo.wears.listHistory(2)).map((w) => w.date)).toEqual(['2026-11-14', '2026-11-10'])

    await repo.wears.deleteForOutfitOnDate(o1.id, '2026-11-14')
    expect((await repo.wears.listHistory()).map((w) => w.date)).toEqual(['2026-11-10', '2026-09-01'])
    await repo.wears.deleteForOutfitOnDate(o1.id, '2026-11-14') // sin efecto
    expect(await repo.wears.listHistory()).toHaveLength(2)
    repo.close()
  })

  it('stats: usos totales, último uso y % del armario activo usado en 30 días', async () => {
    const repo = await open()
    const [a, b, c, d, retired] = await Promise.all(
      ['top', 'bottom', 'shoes', 'accessory', 'top'].map((category, i) =>
        repo.create({ ...base, category: category as 'top', subcategory: `p${i}`, status: i === 4 ? 'retired' : 'active' }),
      ),
    )
    const o1 = await mkOutfit(repo, [a.id, b.id, c.id])
    const o2 = await mkOutfit(repo, [a.id, retired.id, 'prenda-borrada'])
    await repo.wears.create(o1.id, '2026-11-13')
    await repo.wears.create(o1.id, '2026-11-01')
    await repo.wears.create(o2.id, '2026-10-20') // 25 días: dentro
    await repo.wears.create(o2.id, '2026-10-10') // 35 días: fuera de 30
    const s = await repo.wears.stats(NOW)
    const stat = (id: string) => s.garments.find((x) => x.garmentId === id)!
    expect(stat(a.id)).toEqual({ garmentId: a.id, total: 4, lastWorn: '2026-11-13' })
    expect(stat(b.id)).toEqual({ garmentId: b.id, total: 2, lastWorn: '2026-11-13' })
    expect(stat(d.id)).toEqual({ garmentId: d.id, total: 0, lastWorn: null })
    expect(stat(retired.id)).toEqual({ garmentId: retired.id, total: 2, lastWorn: '2026-10-20' })
    expect(s.garments).toHaveLength(5) // la prenda borrada no aparece
    // Activas: a, b, c, d (la retirada no cuenta). Usadas en 30 días: a, b, c.
    expect(s.activeCount).toBe(4)
    expect(s.usedLast30).toBe(3)
    expect(s.usedPercent).toBe(75)
    // Ventana móvil: el 8 de dic el uso del 13 de nov (25 días) sigue dentro; en enero ya nada.
    const later = await repo.wears.stats(new Date(2026, 11, 8, 12))
    expect(later.usedLast30).toBe(3)
    const muchLater = await repo.wears.stats(new Date(2027, 0, 20, 12))
    expect(muchLater.usedLast30).toBe(0)
    expect(muchLater.usedPercent).toBe(0)
    repo.close()
  })

  it('stats sin prendas activas no divide entre cero', async () => {
    const repo = await open()
    expect(await repo.wears.stats(NOW)).toEqual({ garments: [], activeCount: 0, usedLast30: 0, usedPercent: 0 })
    repo.close()
  })

  it('los usos sobreviven a cerrar y reabrir', async () => {
    const repo = await open()
    const o = await mkOutfit(repo, ['a'])
    await repo.wears.create(o.id, '2026-11-14')
    repo.close()
    const reopened = await open()
    expect(await reopened.wears.listHistory()).toHaveLength(1)
    reopened.close()
  })
})
