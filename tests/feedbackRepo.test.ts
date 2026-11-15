// @vitest-environment node
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/db/migrations'
import { SqliteGarmentRepository } from '../src/db/repository'
import { getSqliteStatic, runMigrations } from '../src/db/sqlite'
import { IndexedDbStorage } from '../src/db/storage'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const open = () => SqliteGarmentRepository.open(new IndexedDbStorage('test-feedback'))

async function outfit(repo: SqliteGarmentRepository, ids = ['a', 'b', 'c']) {
  return repo.outfits.create({ garment_ids: ids, occasion: 'casual', weather_snapshot: null, reasoning: 'r', source: 'rules' })
}

describe('FeedbackRepository', () => {
  it('rate hace upsert: una calificación por outfit', async () => {
    const repo = await open()
    const o = await outfit(repo)
    expect(await repo.feedback.get(o.id)).toBeNull()
    const first = await repo.feedback.rate(o.id, 'dislike', ['too_formal', 'fit'], ' muy serio ')
    expect(first).toMatchObject({ outfitId: o.id, rating: 'dislike', tags: ['too_formal', 'fit'], comment: 'muy serio', garmentIds: ['a', 'b', 'c'], occasion: 'casual' })
    const second = await repo.feedback.rate(o.id, 'like', ['comfortable'])
    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({ rating: 'like', tags: ['comfortable'], comment: '' })
    expect(await repo.feedback.listRecent(10)).toHaveLength(1)
    repo.close()
  })

  it('valida motivos por calificación y outfit existente', async () => {
    const repo = await open()
    const o = await outfit(repo)
    await expect(repo.feedback.rate(o.id, 'like', ['too_formal'])).rejects.toThrow()
    await expect(repo.feedback.rate(o.id, 'dislike', ['perfect_occasion'])).rejects.toThrow()
    await expect(repo.feedback.rate('nope', 'like', [])).rejects.toThrow()
    // «colors» es válido en ambos sentidos.
    await repo.feedback.rate(o.id, 'like', ['colors'])
    await repo.feedback.rate(o.id, 'dislike', ['colors'])
    repo.close()
  })

  it('listRecent, countSince y likedOutfits', async () => {
    const repo = await open()
    const base = Date.UTC(2026, 10, 1)
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const o = await outfit(repo, [`g${i}`])
      ids.push(o.id)
      await repo.feedback.rate(o.id, i % 2 ? 'like' : 'dislike', [], '', new Date(base + i * 1000))
    }
    expect((await repo.feedback.listRecent(3)).map((f) => f.outfitId)).toEqual([ids[4], ids[3], ids[2]])
    expect(await repo.feedback.countSince('')).toBe(5)
    expect(await repo.feedback.countSince(new Date(base + 2000).toISOString())).toBe(2)
    const liked = await repo.feedback.likedOutfits(10)
    expect(liked.map((f) => f.garmentIds)).toEqual([['g3'], ['g1']])
    expect(await repo.feedback.likedOutfits(1)).toHaveLength(1)
    repo.close()
  })

  it('sobrevive a cerrar y reabrir; borrar el outfit borra su calificación', async () => {
    const repo = await open()
    const o = await outfit(repo)
    await repo.feedback.rate(o.id, 'dislike', ['too_formal'])
    repo.close()
    const again = await open()
    expect((await again.feedback.get(o.id))?.tags).toEqual(['too_formal'])
    again.close()
  })
})

describe('TasteProfileRepository', () => {
  it('get, save (una sola fila) y reset', async () => {
    const repo = await open()
    expect(await repo.taste.get()).toBeNull()
    await repo.taste.save('Prefiere neutros.', new Date(Date.UTC(2026, 10, 1)))
    const saved = await repo.taste.save('Prefiere formalidad baja.', new Date(Date.UTC(2026, 10, 2)))
    expect(saved).toMatchObject({ summary: 'Prefiere formalidad baja.', resetAt: '' })
    expect(await repo.taste.get()).toEqual(saved)
    const reset = await repo.taste.reset(new Date(Date.UTC(2026, 10, 3)))
    expect(reset.summary).toBe('')
    expect(reset.resetAt).toBe(reset.updatedAt)
    // Guardar después conserva la marca de reinicio.
    expect((await repo.taste.save('Nuevo.')).resetAt).toBe(reset.resetAt)
    repo.close()
  })
})

describe('migración 0003', () => {
  it('conserva filas de feedback y taste_profile existentes', async () => {
    const sqlite3 = await getSqliteStatic()
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(db, MIGRATIONS.slice(0, 2))
    db.exec("INSERT INTO outfits (id, garment_ids, occasion, source, created_at) VALUES ('o1','[\"a\"]','casual','ai','2026-01-01T00:00:00Z')")
    db.exec("INSERT INTO feedback (id, outfit_id, rating, tags, comment) VALUES ('f1','o1','dislike','[\"too_formal\"]','x')")
    db.exec("INSERT INTO taste_profile (summary, updated_at) VALUES ('hola','2026-01-02')")
    expect(runMigrations(db)).toBe(true)
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(MIGRATIONS.length)
    expect(db.selectObjects('SELECT id, rating, tags, comment, created_at FROM feedback')).toEqual([
      { id: 'f1', rating: 'dislike', tags: '["too_formal"]', comment: 'x', created_at: '' },
    ])
    expect(db.selectObjects('SELECT summary, updated_at, reset_at FROM taste_profile')).toEqual([
      { summary: 'hola', updated_at: '2026-01-02', reset_at: '' },
    ])
    db.close()
  })

  it('al abrir una base v2 guarda un respaldo antes de migrar', async () => {
    const sqlite3 = await getSqliteStatic()
    const storage = new IndexedDbStorage('test-backup-v2')
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(db, MIGRATIONS.slice(0, 2))
    await storage.saveSnapshot(sqlite3.capi.sqlite3_js_db_export(db.pointer!))
    db.close()
    const repo = await SqliteGarmentRepository.open(storage)
    expect(await repo.feedback.listRecent(1)).toEqual([])
    repo.close()
  })
})
