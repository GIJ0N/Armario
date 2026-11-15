import type { BBox } from '../ai/provider'
import type { CutoutKind, Garment, Repository } from '../db'
import { checkOnFirstUse, hasCrashed, isSkipped, withInFlight } from './crashGuard'
import { notifyCutoutChanged } from './events'
import { cropToBBoxBlob } from './imageOps'
import { CUTOUT_TIMEOUT_MS } from './modelConfig'
import { CutoutError, type BackgroundRemover, type CutoutEngine } from './types'

export interface CutoutResult {
  blob: Blob
  kind: CutoutKind
  engine: CutoutEngine
}

export interface CutoutAttempt {
  result: CutoutResult | null
  /** El modelo estaba descargado y se intentó, pero falló (o venció el tiempo). */
  maskError: Error | null
  /** El modelo no estaba descargado: no se intentó. */
  maskSkipped: boolean
}

export interface CutoutOptions {
  remover: BackgroundRemover
  /** Cuadro normalizado de la IA para el plan B. */
  bbox?: BBox
  timeoutMs?: number
  /** Prenda en curso: se anota en la marca de «recorte en curso» y, si está en la lista de omitidas, no se usa el modelo. */
  garmentId?: string
  /** No usar el modelo (solo plan B). */
  skipModel?: boolean
  /** Para pruebas: reemplaza el recorte rectangular (que necesita canvas). */
  cropBBox?: (original: Blob, bbox: BBox) => Promise<Blob>
}

async function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout()
      reject(new CutoutError('timeout', 'El recorte tardó demasiado.'))
    }, ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Orden de preferencia: (1) máscara con el modelo, solo si ya está descargado; (2) recorte rectangular con el
 * cuadro de la IA; (3) nada (la interfaz usa la foto original). Nunca descarga el modelo ni lanza por fallos del modelo.
 */
export async function generateCutout(original: Blob, opts: CutoutOptions): Promise<CutoutAttempt> {
  const { remover, bbox, timeoutMs = CUTOUT_TIMEOUT_MS, cropBBox = cropToBBoxBlob, garmentId, skipModel } = opts
  checkOnFirstUse()
  const modelAllowed = !skipModel && !isSkipped(garmentId)
  let maskError: Error | null = null
  let maskSkipped = true
  if (modelAllowed && (await remover.isDownloaded().catch(() => false))) {
    maskSkipped = false
    try {
      const blob = await withInFlight(garmentId, () => withTimeout(remover.remove(original), timeoutMs, () => remover.dispose?.()))
      return { result: { blob, kind: 'mask', engine: remover.lastEngine ?? 'wasm' }, maskError: null, maskSkipped }
    } catch (e) {
      maskError = e instanceof Error ? e : new Error(String(e))
    }
  }
  if (bbox) {
    try {
      const blob = await cropBBox(original, bbox)
      return { result: { blob, kind: 'bbox', engine: 'bbox' }, maskError, maskSkipped }
    } catch {
      /* sin recorte */
    }
  }
  return { result: null, maskError, maskSkipped }
}

// El modelo es pesado: todos los recortes (en segundo plano, por lote o «Rehacer») se hacen de uno en uno.
let chain: Promise<unknown> = Promise.resolve()
export function runExclusive<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job, job)
  chain = next.catch(() => undefined)
  return next
}

export interface CutoutForGarment extends CutoutAttempt {
  garment: Garment
}

/** Genera y guarda el recorte de una prenda a partir de su foto original. Sin foto o sin recorte posible no cambia nada. */
export async function createCutoutFor(
  repo: Repository,
  garment: Garment,
  opts: CutoutOptions,
): Promise<CutoutForGarment> {
  if (!garment.photo_path) return { garment, result: null, maskError: null, maskSkipped: true }
  const photo = await repo.getPhoto(garment.photo_path)
  if (!photo) return { garment, result: null, maskError: null, maskSkipped: true }
  const attempt = await generateCutout(photo, { garmentId: garment.id, ...opts })
  if (!attempt.result) return { garment, ...attempt }
  const updated = await repo.setCutout(garment.id, attempt.result.blob, attempt.result.kind)
  notifyCutoutChanged(garment.id)
  return { garment: updated, ...attempt }
}

/**
 * Después de guardar una prenda: recorte en segundo plano, sin bloquear. Máscara solo si el modelo ya está
 * descargado; si no, recorte con el cuadro de la IA; si tampoco hay, no hace nada. Los errores se ignoran.
 * Tras un cierre por memoria sin confirmar en Ajustes no usa el modelo (solo plan B); las prendas omitidas tampoco.
 */
export function queueCutout(repo: Repository, remover: BackgroundRemover, garment: Garment, bbox?: BBox): Promise<void> {
  return runExclusive(() => {
    checkOnFirstUse()
    return createCutoutFor(repo, garment, { remover, bbox, skipModel: hasCrashed() })
  })
    .then(() => undefined)
    .catch(() => undefined)
}
