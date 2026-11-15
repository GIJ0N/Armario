// @vitest-environment node
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteGarmentRepository } from '../src/db/repository'
import { IndexedDbStorage } from '../src/db/storage'
import { getSqliteStatic, runMigrations } from '../src/db/sqlite'
import { garmentInputSchema, type GarmentInput } from '../src/db/types'

const base: GarmentInput = { category: 'top', formality: 3, warmth: 2 }

async function open() {
  return SqliteGarmentRepository.open(new IndexedDbStorage('test-armario'))
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('migraciones', () => {
  it('crea las seis tablas y fija user_version', async () => {
    const sqlite3 = await getSqliteStatic()
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    expect(runMigrations(db)).toBe(true)
    const tables = db
      .selectValues("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map(String)
    expect(tables).toEqual(
      ['feedback', 'garments', 'outfits', 'purchase_evaluations', 'taste_profile', 'wears'].sort(),
    )
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(1)
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
