import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { normalizeGarmentAdjust, normalizeLayout, parseCanvasLayout, parseGarmentAdjust, type GarmentAdjust, type OutfitLayout } from '../canvas/adjust'
import { addDays, localDateString } from '../lib/date'
import { getSqliteStatic, openSqlite, saveSnapshot } from './sqlite'
import type { Storage } from './storage'
import { computeWearStats, type WearStats } from './wearStats'
import {
  garmentInputSchema,
  TAGS_BY_RATING,
  type FeedbackEntry,
  type CutoutKind,
  type Garment,
  type GarmentFilter,
  type CandidateEntry,
  type EvaluationDetails,
  type GarmentInput,
  type NewPurchaseEvaluation,
  type PurchaseEvaluation,
  type NewOutfitSwap,
  type Occasion,
  type Outfit,
  type OutfitInput,
  type OutfitSwap,
  type SavedOutfit,
  type Rating,
  type TasteProfile,
} from './types'

/** Interfaz de acceso a prendas y fotos; la UI solo depende de esto. */
export interface GarmentRepository {
  list(filter?: GarmentFilter): Promise<Garment[]>
  get(id: string): Promise<Garment | null>
  create(input: GarmentInput): Promise<Garment>
  update(id: string, input: GarmentInput): Promise<Garment>
  /** Cambia solo el estado (p. ej. lavandería). */
  setStatus(id: string, status: Garment['status']): Promise<Garment>
  /** Marca o desmarca la prenda como favorita (fase 12). */
  setFavorite(id: string, favorite: boolean): Promise<Garment>
  delete(id: string): Promise<void>
  savePhoto(blob: Blob): Promise<string>
  getPhoto(key: string): Promise<Blob | null>
  deletePhoto(key: string): Promise<void>
  /** Guarda (o reemplaza) el recorte de la prenda; borra el blob del recorte anterior. */
  setCutout(id: string, blob: Blob, kind: CutoutKind): Promise<Garment>
  /** Quita el recorte (columnas y blob); la foto original no se toca. */
  clearCutout(id: string): Promise<Garment>
  /** Fase 13a: guarda (o quita con null) el ajuste de tamaño/posición de la prenda en el maniquí; valores acotados y normalizados. */
  setCanvasAdjust(id: string, adj: GarmentAdjust | null): Promise<Garment>
  close(): void
}

/** Outfits sugeridos (fase 3); «me lo pongo» y feedback se agregan en las fases 4 y 5. */
export interface OutfitRepository {
  create(input: OutfitInput): Promise<Outfit>
  /** Outfits creados en los últimos `days` días, del más reciente al más antiguo. */
  listRecent(days: number, now?: Date): Promise<Outfit[]>
  get(id: string): Promise<Outfit | null>
  /** Cambia las prendas (y opcionalmente la razón y la ocasión) de un outfit en su lugar; el origen pasa a 'manual'. */
  updateItems(id: string, patch: { garmentIds: string[]; reasoning?: string; occasion?: Occasion }): Promise<Outfit>
  /** ¿El outfit tiene una calificación o algún uso? Si es así no debe reescribirse (ver `commitOutfitEdit`). */
  hasHistory(id: string): Promise<boolean>
  /** Guarda el outfit en «Armario › Outfits» (nombre opcional). Idempotente: vuelve a guardar el nombre. */
  save(id: string, name?: string): Promise<Outfit>
  /** Quita el outfit de los guardados; la fila se conserva (historial). */
  unsave(id: string): Promise<Outfit>
  /** Outfits guardados, el más reciente primero, con su último uso. */
  listSaved(): Promise<SavedOutfit[]>
  /** Fase 13a: guarda (o quita con null) los ajustes manuales del lienzo de este outfit. */
  setCanvasLayout(id: string, layout: OutfitLayout | null): Promise<Outfit>
}

/** Señales de cambios manuales (fase 12): alimentan una pequeña corrección del gusto. */
export interface SwapRepository {
  record(swaps: NewOutfitSwap[]): Promise<void>
  /** Más recientes primero. */
  list(limit: number): Promise<OutfitSwap[]>
}

export interface Wear {
  id: string
  outfit_id: string
  /** YYYY-MM-DD (fecha local) */
  date: string
}

/** Un uso registrado, con los datos del outfit (unión wears + outfits). */
export interface WearEntry {
  wearId: string
  outfitId: string
  garmentIds: string[]
  /** YYYY-MM-DD */
  date: string
  occasion: Occasion
  reasoning: string
}

/** «Me lo pongo»: usos de outfits por fecha (fase 4). */
export interface WearRepository {
  /** Registra que el outfit se usó en `date`. Idempotente: no duplica (outfit, fecha). */
  create(outfitId: string, date: string): Promise<Wear>
  /** Usos con fecha desde hace `days` días (inclusive) hasta hoy y después, del más reciente al más antiguo. */
  listSince(days: number, now?: Date): Promise<WearEntry[]>
  /** Historial completo, del más reciente al más antiguo (máx. `limit`). */
  listHistory(limit?: number): Promise<WearEntry[]>
  /** Deshace «Me lo pongo». */
  deleteForOutfitOnDate(outfitId: string, date: string): Promise<void>
  /** Usos por prenda y % del armario activo usado en los últimos 30 días. */
  stats(now?: Date): Promise<WearStats>
}

/** Calificaciones de outfits (fase 5): una por outfit. */
export interface FeedbackRepository {
  /** Crea o reemplaza la calificación del outfit. Los motivos deben corresponder a la calificación. */
  rate(outfitId: string, rating: Rating, tags: string[], comment?: string, now?: Date): Promise<FeedbackEntry>
  get(outfitId: string): Promise<FeedbackEntry | null>
  /** Más recientes primero. */
  listRecent(limit: number): Promise<FeedbackEntry[]>
  /** Calificaciones hechas después de `since` (ISO; '' = todas). */
  countSince(since: string): Promise<number>
  /** Outfits con «me gusta», más recientes primero. */
  likedOutfits(limit: number): Promise<FeedbackEntry[]>
}

/** Perfil de gusto en texto (una sola fila). */
export interface TasteProfileRepository {
  get(): Promise<TasteProfile | null>
  save(summary: string, now?: Date): Promise<TasteProfile>
  /** «Reiniciar gusto»: borra el texto y marca la fecha; las calificaciones se conservan. */
  reset(now?: Date): Promise<TasteProfile>
}

/** Evaluaciones de compra de prendas candidatas (fase 7). */
export interface PurchaseEvaluationRepository {
  /** Guarda una evaluación (el historial se conserva; `latestFor` devuelve la más reciente). */
  save(evaluation: NewPurchaseEvaluation): Promise<PurchaseEvaluation>
  latestFor(garmentId: string): Promise<PurchaseEvaluation | null>
  /** Prendas con estado «candidata» (lista de deseos), la más reciente primero, con su última evaluación. */
  listCandidates(): Promise<CandidateEntry[]>
}

/** Todo lo que la UI necesita del almacenamiento. */
export interface Repository extends GarmentRepository {
  readonly outfits: OutfitRepository
  readonly wears: WearRepository
  readonly feedback: FeedbackRepository
  readonly taste: TasteProfileRepository
  readonly purchases: PurchaseEvaluationRepository
  readonly swaps: SwapRepository
}

type Row = Record<string, unknown>

function rowToGarment(row: Row): Garment {
  return {
    id: row.id as string,
    photo_path: (row.photo_path as string | null) ?? null,
    category: row.category as Garment['category'],
    subcategory: row.subcategory as string,
    colors: JSON.parse(row.colors as string),
    pattern: row.pattern as string,
    material: row.material as string,
    fit: row.fit as Garment['fit'],
    formality: row.formality as number,
    warmth: row.warmth as number,
    occasions: JSON.parse(row.occasions as string),
    is_statement: row.is_statement === 1,
    status: row.status as Garment['status'],
    notes: row.notes as string,
    created_at: row.created_at as string,
    cutout_path: (row.cutout_path as string | null) ?? null,
    cutout_kind: (row.cutout_kind as CutoutKind | null) ?? null,
    favorite: row.favorite === 1,
    canvas_adjust: parseGarmentAdjust(row.canvas_adjust),
  }
}

function rowToOutfit(row: Row): Outfit {
  return {
    id: row.id as string,
    garment_ids: JSON.parse(row.garment_ids as string),
    occasion: row.occasion as Outfit['occasion'],
    weather_snapshot: row.weather_snapshot ? JSON.parse(row.weather_snapshot as string) : null,
    reasoning: row.reasoning as string,
    source: row.source as Outfit['source'],
    created_at: row.created_at as string,
    saved_at: (row.saved_at as string | null) ?? null,
    name: (row.name as string | null) ?? null,
    canvas_layout: parseCanvasLayout(row.canvas_layout),
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function rowToWearEntry(row: Row): WearEntry {
  return {
    wearId: row.wid as string,
    outfitId: row.outfit_id as string,
    garmentIds: JSON.parse(row.garment_ids as string),
    date: row.date as string,
    occasion: row.occasion as Occasion,
    reasoning: row.reasoning as string,
  }
}

function rowToFeedback(row: Row): FeedbackEntry {
  return {
    id: row.id as string,
    outfitId: row.outfit_id as string,
    rating: row.rating as Rating,
    tags: JSON.parse(row.tags as string),
    comment: row.comment as string,
    createdAt: row.created_at as string,
    garmentIds: JSON.parse(row.garment_ids as string),
    occasion: row.occasion as Occasion,
    reasoning: row.reasoning as string,
  }
}

const EMPTY_DETAILS: EvaluationDetails = {
  perOccasion: {},
  occasionCount: 0,
  partnerCount: 0,
  duplicateIds: [],
  examples: [],
  explanation: '',
  note: '',
  usedAi: false,
}

function rowToEvaluation(row: Row): PurchaseEvaluation {
  let details: Partial<EvaluationDetails> = {}
  try {
    details = JSON.parse((row.details as string) || '{}')
  } catch {
    /* se usa el resumen vacío */
  }
  return {
    garmentId: row.garment_id as string,
    verdict: row.verdict as PurchaseEvaluation['verdict'],
    outfitCount: row.outfit_count as number,
    gaps: JSON.parse(row.gaps as string),
    complements: JSON.parse(row.suggested_additions as string),
    details: { ...EMPTY_DETAILS, ...details },
    createdAt: row.created_at as string,
  }
}

const FEEDBACK_SELECT = `SELECT f.id, f.outfit_id, f.rating, f.tags, f.comment, f.created_at,
  o.garment_ids, o.occasion, o.reasoning FROM feedback f JOIN outfits o ON o.id = f.outfit_id`

const WEAR_SELECT = `SELECT w.id AS wid, w.outfit_id, w.date, o.garment_ids, o.occasion, o.reasoning
  FROM wears w JOIN outfits o ON o.id = w.outfit_id`

export class SqliteGarmentRepository implements Repository {
  readonly outfits: OutfitRepository = {
    create: (input) => this.createOutfit(input),
    listRecent: (days, now) => this.listRecentOutfits(days, now),
    get: async (id) => this.selectOutfit(id),
    updateItems: (id, patch) => this.updateOutfitItems(id, patch),
    hasHistory: async (id) =>
      this.db.selectValue('SELECT 1 FROM wears WHERE outfit_id = ? LIMIT 1', [id]) !== undefined ||
      this.db.selectValue('SELECT 1 FROM feedback WHERE outfit_id = ? LIMIT 1', [id]) !== undefined,
    setCanvasLayout: (id, layout) => this.setOutfitCanvasLayout(id, layout),
    save: (id, name) => this.setOutfitSaved(id, true, name),
    unsave: (id) => this.setOutfitSaved(id, false),
    listSaved: async () =>
      this.db
        .selectObjects(
          `SELECT o.*, (SELECT MAX(w.date) FROM wears w WHERE w.outfit_id = o.id) AS last_worn
           FROM outfits o WHERE o.saved_at IS NOT NULL ORDER BY o.saved_at DESC, o.rowid DESC`,
        )
        .map((row) => ({ outfit: rowToOutfit(row), lastWorn: (row.last_worn as string | null) ?? null })),
  }

  readonly swaps: SwapRepository = {
    record: (swaps) => this.recordSwaps(swaps),
    list: async (limit) =>
      this.db
        .selectObjects('SELECT * FROM outfit_swaps ORDER BY created_at DESC, rowid DESC LIMIT ?', [limit])
        .map(
          (row): OutfitSwap => ({
            id: row.id as string,
            outfitId: (row.outfit_id as string | null) ?? null,
            fromGarmentId: (row.from_garment_id as string | null) ?? null,
            toGarmentId: (row.to_garment_id as string | null) ?? null,
            createdAt: row.created_at as string,
          }),
        ),
  }

  readonly wears: WearRepository = {
    create: (outfitId, date) => this.createWear(outfitId, date),
    listSince: async (days, now = new Date()) =>
      this.db
        .selectObjects(`${WEAR_SELECT} WHERE w.date >= ? ORDER BY w.date DESC, w.rowid DESC`, [
          addDays(localDateString(now), -days),
        ])
        .map(rowToWearEntry),
    listHistory: async (limit = 200) =>
      this.db
        .selectObjects(`${WEAR_SELECT} ORDER BY w.date DESC, w.rowid DESC LIMIT ?`, [limit])
        .map(rowToWearEntry),
    deleteForOutfitOnDate: async (outfitId, date) => {
      await this.write(() => {
        this.db.exec({ sql: 'DELETE FROM wears WHERE outfit_id = ? AND date = ?', bind: [outfitId, date] })
      })
    },
    stats: async (now = new Date()) => {
      const garments = this.db.selectObjects('SELECT id, status FROM garments') as {
        id: string
        status: Garment['status']
      }[]
      const wears = this.db.selectObjects(`${WEAR_SELECT}`).map(rowToWearEntry)
      return computeWearStats(garments, wears, localDateString(now))
    },
  }

  readonly feedback: FeedbackRepository = {
    rate: (outfitId, rating, tags, comment, now) => this.rate(outfitId, rating, tags, comment, now),
    get: async (outfitId) => {
      const rows = this.db.selectObjects(`${FEEDBACK_SELECT} WHERE f.outfit_id = ?`, [outfitId])
      return rows.length ? rowToFeedback(rows[0]) : null
    },
    listRecent: async (limit) =>
      this.db
        .selectObjects(`${FEEDBACK_SELECT} ORDER BY f.created_at DESC, f.rowid DESC LIMIT ?`, [limit])
        .map(rowToFeedback),
    countSince: async (since) =>
      Number(this.db.selectValue('SELECT COUNT(*) FROM feedback WHERE created_at > ?', [since]) ?? 0),
    likedOutfits: async (limit) =>
      this.db
        .selectObjects(`${FEEDBACK_SELECT} WHERE f.rating = 'like' ORDER BY f.created_at DESC, f.rowid DESC LIMIT ?`, [
          limit,
        ])
        .map(rowToFeedback),
  }

  readonly taste: TasteProfileRepository = {
    get: async () => this.readTaste(),
    save: (summary, now = new Date()) => this.writeTaste(summary, now, false),
    reset: (now = new Date()) => this.writeTaste('', now, true),
  }

  readonly purchases: PurchaseEvaluationRepository = {
    save: (evaluation) => this.saveEvaluation(evaluation),
    latestFor: async (garmentId) => this.latestEvaluation(garmentId),
    listCandidates: async () =>
      this.db
        .selectObjects("SELECT * FROM garments WHERE status = 'candidate' ORDER BY created_at DESC, rowid DESC")
        .map((row) => {
          const garment = rowToGarment(row)
          return { garment, evaluation: this.latestEvaluation(garment.id) }
        }),
  }

  private queue: Promise<unknown> = Promise.resolve()

  private sqlite3: Sqlite3Static
  private db: Database
  private storage: Storage

  private constructor(sqlite3: Sqlite3Static, db: Database, storage: Storage) {
    this.sqlite3 = sqlite3
    this.db = db
    this.storage = storage
  }

  static async open(storage: Storage): Promise<SqliteGarmentRepository> {
    const sqlite3 = await getSqliteStatic()
    const db = await openSqlite(storage)
    return new SqliteGarmentRepository(sqlite3, db, storage)
  }

  /** Ejecuta una escritura en transacción y espera a que la instantánea quede en IndexedDB. */
  private write<T>(fn: () => T): Promise<T> {
    const run = async () => {
      const result = this.db.transaction(fn)
      await saveSnapshot(this.sqlite3, this.db, this.storage)
      return result
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  private select(id: string): Garment | null {
    const rows = this.db.selectObjects('SELECT * FROM garments WHERE id = ?', [id])
    return rows.length ? rowToGarment(rows[0]) : null
  }

  async list(filter: GarmentFilter = {}) {
    const where: string[] = []
    const bind: string[] = []
    if (filter.category) {
      where.push('category = ?')
      bind.push(filter.category)
    }
    if (filter.statuses) {
      if (filter.statuses.length === 0) return []
      where.push(`status IN (${filter.statuses.map(() => '?').join(',')})`)
      bind.push(...filter.statuses)
    }
    const sql = `SELECT * FROM garments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, rowid DESC`
    return this.db.selectObjects(sql, bind).map(rowToGarment)
  }

  async get(id: string) {
    return this.select(id)
  }

  async create(input: GarmentInput) {
    const data = garmentInputSchema.parse(input)
    const id = crypto.randomUUID()
    const created_at = new Date().toISOString()
    await this.write(() => {
      this.db.exec({
        sql: `INSERT INTO garments (id, photo_path, category, subcategory, colors, pattern, material, fit,
          formality, warmth, occasions, is_statement, status, notes, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        bind: [
          id,
          data.photo_path,
          data.category,
          data.subcategory,
          JSON.stringify(data.colors),
          data.pattern,
          data.material,
          data.fit,
          data.formality,
          data.warmth,
          JSON.stringify(data.occasions),
          data.is_statement ? 1 : 0,
          data.status,
          data.notes,
          created_at,
        ],
      })
      if (data.favorite) this.db.exec({ sql: 'UPDATE garments SET favorite=1 WHERE id=?', bind: [id] })
    })
    return { ...data, id, created_at, cutout_path: null, cutout_kind: null, favorite: !!data.favorite, canvas_adjust: null }
  }

  async update(id: string, input: GarmentInput) {
    const data = garmentInputSchema.parse(input)
    const before = this.select(id)
    if (!before) throw new Error('Prenda no encontrada')
    const favorite = data.favorite ?? before.favorite
    await this.write(() => {
      this.db.exec({
        sql: `UPDATE garments SET photo_path=?, category=?, subcategory=?, colors=?, pattern=?, material=?,
          fit=?, formality=?, warmth=?, occasions=?, is_statement=?, status=?, notes=?, favorite=? WHERE id=?`,
        bind: [
          data.photo_path,
          data.category,
          data.subcategory,
          JSON.stringify(data.colors),
          data.pattern,
          data.material,
          data.fit,
          data.formality,
          data.warmth,
          JSON.stringify(data.occasions),
          data.is_statement ? 1 : 0,
          data.status,
          data.notes,
          favorite ? 1 : 0,
          id,
        ],
      })
      // El recorte pertenece a la foto anterior: si la foto cambió, se descarta.
      if (before.photo_path !== data.photo_path && before.cutout_path) {
        this.db.exec({ sql: 'UPDATE garments SET cutout_path=NULL, cutout_kind=NULL WHERE id=?', bind: [id] })
      }
    })
    if (before.photo_path && before.photo_path !== data.photo_path) {
      await this.storage.deletePhoto(before.photo_path)
    }
    const photoChanged = before.photo_path !== data.photo_path
    if (photoChanged && before.cutout_path) await this.storage.deletePhoto(before.cutout_path)
    return {
      ...data,
      favorite,
      id,
      created_at: before.created_at,
      cutout_path: photoChanged ? null : (before.cutout_path ?? null),
      cutout_kind: photoChanged ? null : (before.cutout_kind ?? null),
      canvas_adjust: before.canvas_adjust ?? null,
    }
  }

  async setStatus(id: string, status: Garment['status']) {
    const before = this.select(id)
    if (!before) throw new Error('Prenda no encontrada')
    return this.update(id, { ...before, status })
  }

  async setFavorite(id: string, favorite: boolean) {
    const before = this.select(id)
    if (!before) throw new Error('Prenda no encontrada')
    await this.write(() => {
      this.db.exec({ sql: 'UPDATE garments SET favorite=? WHERE id=?', bind: [favorite ? 1 : 0, id] })
    })
    return { ...before, favorite }
  }

  async setCanvasAdjust(id: string, adj: GarmentAdjust | null) {
    const before = this.select(id)
    if (!before) throw new Error('Prenda no encontrada')
    const clean = normalizeGarmentAdjust(adj)
    await this.write(() => {
      this.db.exec({ sql: 'UPDATE garments SET canvas_adjust=? WHERE id=?', bind: [clean ? JSON.stringify(clean) : null, id] })
    })
    return { ...before, canvas_adjust: clean }
  }

  async delete(id: string) {
    const before = this.select(id)
    if (!before) return
    await this.write(() => {
      this.db.exec({ sql: 'DELETE FROM garments WHERE id = ?', bind: [id] })
    })
    if (before.photo_path) await this.storage.deletePhoto(before.photo_path)
    if (before.cutout_path) await this.storage.deletePhoto(before.cutout_path)
  }

  async setCutout(id: string, blob: Blob, kind: CutoutKind) {
    const before = this.select(id)
    if (!before) throw new Error('Prenda no encontrada')
    if (!before.photo_path) throw new Error('La prenda no tiene foto')
    const key = `cutout:${crypto.randomUUID()}`
    await this.storage.putPhoto(key, blob)
    try {
      await this.write(() => {
        this.db.exec({ sql: 'UPDATE garments SET cutout_path=?, cutout_kind=? WHERE id=?', bind: [key, kind, id] })
      })
    } catch (e) {
      await this.storage.deletePhoto(key)
      throw e
    }
    if (before.cutout_path) await this.storage.deletePhoto(before.cutout_path)
    return { ...before, cutout_path: key, cutout_kind: kind }
  }

  async clearCutout(id: string) {
    const before = this.select(id)
    if (!before) throw new Error('Prenda no encontrada')
    if (!before.cutout_path) return before
    await this.write(() => {
      this.db.exec({ sql: 'UPDATE garments SET cutout_path=NULL, cutout_kind=NULL WHERE id=?', bind: [id] })
    })
    await this.storage.deletePhoto(before.cutout_path)
    return { ...before, cutout_path: null, cutout_kind: null }
  }

  async createOutfit(input: OutfitInput): Promise<Outfit> {
    const id = crypto.randomUUID()
    const created_at = new Date().toISOString()
    await this.write(() => {
      this.db.exec({
        sql: `INSERT INTO outfits (id, garment_ids, occasion, weather_snapshot, reasoning, source, created_at)
          VALUES (?,?,?,?,?,?,?)`,
        bind: [
          id,
          JSON.stringify(input.garment_ids),
          input.occasion,
          input.weather_snapshot ? JSON.stringify(input.weather_snapshot) : null,
          input.reasoning,
          input.source,
          created_at,
        ],
      })
    })
    return { ...input, id, created_at }
  }

  async listRecentOutfits(days: number, now: Date = new Date()): Promise<Outfit[]> {
    const since = new Date(now.getTime() - days * 86_400_000).toISOString()
    return this.db
      .selectObjects('SELECT * FROM outfits WHERE created_at >= ? ORDER BY created_at DESC, rowid DESC', [since])
      .map(rowToOutfit)
  }

  private selectOutfit(id: string): Outfit | null {
    const rows = this.db.selectObjects('SELECT * FROM outfits WHERE id = ?', [id])
    return rows.length ? rowToOutfit(rows[0]) : null
  }

  private async updateOutfitItems(
    id: string,
    patch: { garmentIds: string[]; reasoning?: string; occasion?: Occasion },
  ): Promise<Outfit> {
    await this.write(() => {
      if (this.db.selectValue('SELECT 1 FROM outfits WHERE id = ?', [id]) === undefined) {
        throw new Error('Outfit no encontrado')
      }
      const sets = ["garment_ids=?", "source='manual'"]
      const bind: (string | null)[] = [JSON.stringify(patch.garmentIds)]
      if (patch.reasoning !== undefined) {
        sets.push('reasoning=?')
        bind.push(patch.reasoning)
      }
      if (patch.occasion !== undefined) {
        sets.push('occasion=?')
        bind.push(patch.occasion)
      }
      this.db.exec({ sql: `UPDATE outfits SET ${sets.join(', ')} WHERE id=?`, bind: [...bind, id] })
    })
    return this.selectOutfit(id)!
  }

  private async setOutfitCanvasLayout(id: string, layout: OutfitLayout | null): Promise<Outfit> {
    const clean = normalizeLayout(layout)
    await this.write(() => {
      if (this.db.selectValue('SELECT 1 FROM outfits WHERE id = ?', [id]) === undefined) {
        throw new Error('Outfit no encontrado')
      }
      this.db.exec({ sql: 'UPDATE outfits SET canvas_layout=? WHERE id=?', bind: [clean ? JSON.stringify(clean) : null, id] })
    })
    return this.selectOutfit(id)!
  }

  private async setOutfitSaved(id: string, saved: boolean, name?: string): Promise<Outfit> {
    await this.write(() => {
      if (this.db.selectValue('SELECT 1 FROM outfits WHERE id = ?', [id]) === undefined) {
        throw new Error('Outfit no encontrado')
      }
      if (saved) {
        const clean = name?.trim().slice(0, 60) || null
        this.db.exec({
          sql: 'UPDATE outfits SET saved_at = COALESCE(saved_at, ?), name = ? WHERE id = ?',
          bind: [new Date().toISOString(), clean, id],
        })
      } else {
        this.db.exec({ sql: 'UPDATE outfits SET saved_at = NULL, name = NULL WHERE id = ?', bind: [id] })
      }
    })
    return this.selectOutfit(id)!
  }

  private async recordSwaps(swaps: NewOutfitSwap[]): Promise<void> {
    if (swaps.length === 0) return
    await this.write(() => {
      for (const s of swaps) {
        this.db.exec({
          sql: 'INSERT INTO outfit_swaps (id, outfit_id, from_garment_id, to_garment_id, created_at) VALUES (?,?,?,?,?)',
          bind: [crypto.randomUUID(), s.outfitId, s.fromGarmentId, s.toGarmentId, s.createdAt ?? new Date().toISOString()],
        })
      }
    })
  }

  private async createWear(outfitId: string, date: string): Promise<Wear> {
    if (!DATE_RE.test(date)) throw new Error('Fecha inválida (se espera AAAA-MM-DD)')
    return this.write(() => {
      if (this.db.selectValue('SELECT 1 FROM outfits WHERE id = ?', [outfitId]) === undefined) {
        throw new Error('Outfit no encontrado')
      }
      const existing = this.db.selectObjects('SELECT id FROM wears WHERE outfit_id = ? AND date = ?', [outfitId, date])
      if (existing.length) return { id: existing[0].id as string, outfit_id: outfitId, date }
      const id = crypto.randomUUID()
      this.db.exec({ sql: 'INSERT INTO wears (id, outfit_id, date) VALUES (?,?,?)', bind: [id, outfitId, date] })
      return { id, outfit_id: outfitId, date }
    })
  }

  private async rate(
    outfitId: string,
    rating: Rating,
    tags: string[],
    comment = '',
    now: Date = new Date(),
  ): Promise<FeedbackEntry> {
    const allowed = TAGS_BY_RATING[rating]
    const clean = [...new Set(tags)]
    const bad = clean.find((t) => !allowed.includes(t))
    if (bad) throw new Error(`Motivo no válido para esta calificación: ${bad}`)
    if (rating !== 'like' && rating !== 'dislike') throw new Error('Calificación no válida')
    await this.write(() => {
      if (this.db.selectValue('SELECT 1 FROM outfits WHERE id = ?', [outfitId]) === undefined) {
        throw new Error('Outfit no encontrado')
      }
      const existing = this.db.selectValue('SELECT id FROM feedback WHERE outfit_id = ?', [outfitId])
      const created_at = now.toISOString()
      if (existing !== undefined) {
        this.db.exec({
          sql: 'UPDATE feedback SET rating=?, tags=?, comment=?, created_at=? WHERE outfit_id=?',
          bind: [rating, JSON.stringify(clean), comment.trim(), created_at, outfitId],
        })
      } else {
        this.db.exec({
          sql: 'INSERT INTO feedback (id, outfit_id, rating, tags, comment, created_at) VALUES (?,?,?,?,?,?)',
          bind: [crypto.randomUUID(), outfitId, rating, JSON.stringify(clean), comment.trim(), created_at],
        })
      }
    })
    return (await this.feedback.get(outfitId))!
  }

  private latestEvaluation(garmentId: string): PurchaseEvaluation | null {
    const rows = this.db.selectObjects(
      'SELECT * FROM purchase_evaluations WHERE garment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      [garmentId],
    )
    return rows.length ? rowToEvaluation(rows[0]) : null
  }

  private async saveEvaluation(input: NewPurchaseEvaluation): Promise<PurchaseEvaluation> {
    const saved: PurchaseEvaluation = { ...input, createdAt: input.createdAt ?? new Date().toISOString() }
    await this.write(() => {
      if (this.db.selectValue('SELECT 1 FROM garments WHERE id = ?', [saved.garmentId]) === undefined) {
        throw new Error('Prenda no encontrada')
      }
      this.db.exec({
        sql: `INSERT INTO purchase_evaluations (garment_id, verdict, outfit_count, gaps, suggested_additions, details, created_at)
          VALUES (?,?,?,?,?,?,?)`,
        bind: [
          saved.garmentId,
          saved.verdict,
          saved.outfitCount,
          JSON.stringify(saved.gaps),
          JSON.stringify(saved.complements),
          JSON.stringify(saved.details),
          saved.createdAt,
        ],
      })
    })
    return saved
  }

  private readTaste(): TasteProfile | null {
    const rows = this.db.selectObjects('SELECT summary, updated_at, reset_at FROM taste_profile LIMIT 1')
    if (!rows.length) return null
    return {
      summary: rows[0].summary as string,
      updatedAt: rows[0].updated_at as string,
      resetAt: rows[0].reset_at as string,
    }
  }

  private async writeTaste(summary: string, now: Date, reset: boolean): Promise<TasteProfile> {
    const previous = this.readTaste()
    const profile: TasteProfile = {
      summary,
      updatedAt: now.toISOString(),
      resetAt: reset ? now.toISOString() : (previous?.resetAt ?? ''),
    }
    await this.write(() => {
      this.db.exec('DELETE FROM taste_profile')
      this.db.exec({
        sql: 'INSERT INTO taste_profile (summary, updated_at, reset_at) VALUES (?,?,?)',
        bind: [profile.summary, profile.updatedAt, profile.resetAt],
      })
    })
    return profile
  }

  async savePhoto(blob: Blob) {
    const key = `photo:${crypto.randomUUID()}`
    await this.storage.putPhoto(key, blob)
    return key
  }

  getPhoto(key: string) {
    return this.storage.getPhoto(key)
  }

  deletePhoto(key: string) {
    return this.storage.deletePhoto(key)
  }

  close() {
    this.db.close()
    this.storage.close()
  }
}
