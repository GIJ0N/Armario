// @vitest-environment node
import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/db/migrations'
import { SqliteGarmentRepository } from '../src/db/repository'
import { getSqliteStatic, runMigrations } from '../src/db/sqlite'
import { IndexedDbStorage } from '../src/db/storage'
import type { GarmentInput, NewPurchaseEvaluation } from '../src/db/types'
import { evaluatePurchase, toStoredEvaluation } from '../src/purchase'
import { wardrobe30 } from './fixtures/wardrobe30'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const open = () => SqliteGarmentRepository.open(new IndexedDbStorage('test-purchases'))
const candidateInput: GarmentInput = { category: 'bottom', subcategory: 'chinos', colors: ['azul marino'], formality: 3, warmth: 2, status: 'candidate' }

const evaluation = (garmentId: string, o: Partial<NewPurchaseEvaluation> = {}): NewPurchaseEvaluation => ({
  garmentId,
  verdict: 'with_complements',
  outfitCount: 3,
  gaps: ['Te faltan zapatos formales.'],
  complements: [
    { category: 'shoes', subcategory: 'zapato de vestir', colors: ['negro'], formality: 4, warmth: 2, fit: 'regular', label: 'Zapato de vestir negro, formalidad 4', unlocks: 4, source: 'rules' },
  ],
  details: { perOccasion: { office: 3 }, occasionCount: 1, partnerCount: 4, duplicateIds: [], examples: [{ occasion: 'office', garmentIds: ['a', 'b'] }], explanation: 'Explicación.', note: '', usedAi: false },
  ...o,
})

describe('PurchaseEvaluationRepository', () => {
  it('save / latestFor guarda gaps, complementos y resumen como JSON', async () => {
    const repo = await open()
    const g = await repo.create(candidateInput)
    expect(await repo.purchases.latestFor(g.id)).toBeNull()
    const saved = await repo.purchases.save(evaluation(g.id, { createdAt: '2026-11-01T10:00:00.000Z' }))
    expect(saved.createdAt).toBe('2026-11-01T10:00:00.000Z')
    const got = await repo.purchases.latestFor(g.id)
    expect(got).toEqual(saved)
    expect(got?.complements[0].unlocks).toBe(4)
    expect(got?.details.examples).toHaveLength(1)
    repo.close()
  })

  it('latestFor devuelve la evaluación más reciente y el historial se conserva', async () => {
    const repo = await open()
    const g = await repo.create(candidateInput)
    await repo.purchases.save(evaluation(g.id, { verdict: 'skip', outfitCount: 0, createdAt: '2026-11-01T10:00:00.000Z' }))
    await repo.purchases.save(evaluation(g.id, { verdict: 'buy', outfitCount: 9, createdAt: '2026-11-02T10:00:00.000Z' }))
    expect((await repo.purchases.latestFor(g.id))?.verdict).toBe('buy')
    expect(await repo.purchases.latestFor('otra')).toBeNull()
    repo.close()
  })

  it('rechaza veredictos inválidos y prendas inexistentes', async () => {
    const repo = await open()
    const g = await repo.create(candidateInput)
    await expect(repo.purchases.save(evaluation(g.id, { verdict: 'accessories_only' as never }))).rejects.toThrow()
    await expect(repo.purchases.save(evaluation('no-existe'))).rejects.toThrow(/no encontrada/)
    await expect(repo.purchases.save(evaluation(g.id, { outfitCount: -1 }))).rejects.toThrow()
    repo.close()
  })

  it('listCandidates: solo candidatas, la más reciente primero, con su última evaluación', async () => {
    const repo = await open()
    await repo.create({ ...candidateInput, status: 'active', subcategory: 'activa' })
    const c1 = await repo.create({ ...candidateInput, subcategory: 'c1' })
    const c2 = await repo.create({ ...candidateInput, subcategory: 'c2' })
    await repo.purchases.save(evaluation(c1.id, { verdict: 'buy' }))
    const list = await repo.purchases.listCandidates()
    expect(list.map((e) => e.garment.subcategory)).toEqual(['c2', 'c1'])
    expect(list[0].evaluation).toBeNull()
    expect(list[1].evaluation?.verdict).toBe('buy')
    expect(c2.status).toBe('candidate')
    repo.close()
  })

  it('«Lo compré» (setStatus active) la saca de la lista y la mete al armario', async () => {
    const repo = await open()
    const g = await repo.create(candidateInput)
    await repo.purchases.save(evaluation(g.id))
    await repo.setStatus(g.id, 'active')
    expect(await repo.purchases.listCandidates()).toEqual([])
    expect((await repo.list({ statuses: ['active'] })).map((x) => x.id)).toEqual([g.id])
    // La evaluación se conserva.
    expect(await repo.purchases.latestFor(g.id)).not.toBeNull()
    repo.close()
  })

  it('«Descartar» (delete) borra la prenda, su foto y sus evaluaciones (cascada)', async () => {
    const storage = new IndexedDbStorage('test-purchases')
    const repo = await SqliteGarmentRepository.open(storage)
    const photo = await repo.savePhoto(new Blob([new Uint8Array([1, 2, 3])]))
    const g = await repo.create({ ...candidateInput, photo_path: photo })
    await repo.purchases.save(evaluation(g.id))
    await repo.delete(g.id)
    expect(await repo.get(g.id)).toBeNull()
    expect(await repo.getPhoto(photo)).toBeNull()
    expect(await repo.purchases.latestFor(g.id)).toBeNull()
    expect(await repo.purchases.listCandidates()).toEqual([])
    repo.close()
  })

  it('sobrevive a reabrir la base y las candidatas no cuentan como prendas activas', async () => {
    const repo = await open()
    for (const g of wardrobe30.slice(0, 5)) await repo.create({ ...g, photo_path: null })
    const c = await repo.create(candidateInput)
    const report = await evaluatePurchase(c, await repo.list())
    await repo.purchases.save(toStoredEvaluation(c.id, report))
    repo.close()
    const again = await open()
    const [entry] = await again.purchases.listCandidates()
    expect(entry.garment.id).toBe(c.id)
    expect(entry.evaluation?.verdict).toBe(report.verdict)
    expect(entry.evaluation?.outfitCount).toBe(report.simulation.total)
    again.close()
  })
})

describe('migración 0004', () => {
  it('convierte accessories_only en with_complements y conserva todas las filas', async () => {
    const sqlite3 = await getSqliteStatic()
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(db, MIGRATIONS.slice(0, 3))
    db.exec("INSERT INTO garments (id, category, formality, warmth, created_at) VALUES ('g1','top',3,2,'x'),('g2','top',3,2,'x'),('g3','top',3,2,'x')")
    const insert = (id: string, verdict: string, n: number) =>
      db.exec({
        sql: "INSERT INTO purchase_evaluations (garment_id, verdict, outfit_count, gaps, suggested_additions, created_at) VALUES (?,?,?,'[\"g\"]','[]','2026-01-01')",
        bind: [id, verdict, n],
      })
    insert('g1', 'accessories_only', 2)
    insert('g2', 'buy', 9)
    insert('g3', 'skip', 0)
    expect(runMigrations(db)).toBe(true)
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(MIGRATIONS.length)
    expect(db.selectObjects('SELECT garment_id, verdict, outfit_count, gaps, details FROM purchase_evaluations ORDER BY garment_id')).toEqual([
      { garment_id: 'g1', verdict: 'with_complements', outfit_count: 2, gaps: '["g"]', details: '{}' },
      { garment_id: 'g2', verdict: 'buy', outfit_count: 9, gaps: '["g"]', details: '{}' },
      { garment_id: 'g3', verdict: 'skip', outfit_count: 0, gaps: '["g"]', details: '{}' },
    ])
    expect(() =>
      db.exec("INSERT INTO purchase_evaluations (garment_id, verdict, outfit_count, created_at) VALUES ('g1','accessories_only',1,'x')"),
    ).toThrow()
    // Las prendas no se tocan.
    expect(Number(db.selectValue('SELECT COUNT(*) FROM garments'))).toBe(3)
    db.close()
  })

  it('al abrir una base v3 guarda un respaldo previo a la migración y no pierde datos', async () => {
    const sqlite3 = await getSqliteStatic()
    const storage = new IndexedDbStorage('test-purchases')
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    runMigrations(db, MIGRATIONS.slice(0, 3))
    db.exec("INSERT INTO garments (id, category, formality, warmth, status, created_at) VALUES ('g1','top',3,2,'candidate','2026-01-01')")
    db.exec("INSERT INTO purchase_evaluations (garment_id, verdict, outfit_count, created_at) VALUES ('g1','accessories_only',2,'2026-01-02')")
    const bytes = sqlite3.capi.sqlite3_js_db_export(db.pointer!)
    db.close()
    await storage.saveSnapshot(bytes)

    const repo = await SqliteGarmentRepository.open(storage)
    expect((await repo.purchases.latestFor('g1'))?.verdict).toBe('with_complements')
    expect(await repo.get('g1')).not.toBeNull()
    repo.close()
    const idb = await openDB('test-purchases', 1)
    const backup = (await idb.get('snapshot', 'backup:pre-migration-v3')) as Uint8Array | undefined
    expect(backup?.byteLength).toBe(bytes.byteLength)
    idb.close()
  })
})
