import { checkOnFirstUse } from './crashGuard'
import { getEnginePreference, setEnginePreference } from './enginePref'
import { imageToModelInput, maskToCutoutBlob } from './imageOps'
import { downloadModel, isModelCached, prefetchRuntime } from './modelStore'
import type { WorkerRequest, WorkerResponse } from './protocol'
import { CutoutError, type BackgroundRemover, type DownloadProgress } from './types'

/** Lo mínimo que se usa de un Worker (así las pruebas inyectan uno falso). */
export interface WorkerLike {
  onmessage: ((e: { data: WorkerResponse }) => void) | null
  onerror: ((e: { message?: string }) => void) | null
  postMessage(msg: WorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

export interface RemoverDeps {
  createWorker(): WorkerLike
  isCached(): Promise<boolean>
  toInput(image: Blob): Promise<{ data: Float32Array; size: number }>
  toCutout(image: Blob, alpha: Uint8ClampedArray, size: number): Promise<Blob>
  getPreference: typeof getEnginePreference
  setPreference: typeof setEnginePreference
  pause(ms: number): Promise<void>
  /** Inferencias antes de reciclar el worker. */
  recycleEvery: number
}

/** El heap de WASM nunca se encoge: cada 2 inferencias (y tras cualquier fallo) se termina el worker. */
export const RECYCLE_EVERY = 2
/** Pausa tras reciclar para que el recolector de basura devuelva la memoria. */
export const RECYCLE_PAUSE_MS = 80

const defaultDeps: RemoverDeps = {
  createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
  isCached: isModelCached,
  toInput: (image) => imageToModelInput(image),
  toCutout: (image, alpha, size) => maskToCutoutBlob(image, alpha, size),
  getPreference: getEnginePreference,
  setPreference: setEnginePreference,
  pause: (ms) => new Promise((r) => setTimeout(r, ms)),
  recycleEvery: RECYCLE_EVERY,
}

class FallbackError extends CutoutError {
  readonly fallback = true
}
const isFallback = (e: unknown): e is FallbackError => e instanceof FallbackError

type ResultMsg = Extract<WorkerResponse, { type: 'result' }>

/** Implementación real: ONNX Runtime Web en un Web Worker (WASM de un hilo; WebGPU solo si se elige a mano). */
export class OnnxBackgroundRemover implements BackgroundRemover {
  lastEngine: 'webgpu' | 'wasm' | null = null
  /** Veces que se terminó el worker para liberar memoria (el siguiente uso lo recarga desde Cache Storage). */
  recycleCount = 0

  private deps: RemoverDeps
  private worker: WorkerLike | null = null
  private loading: Promise<void> | null = null
  private nextId = 1
  private inferences = 0
  private chain: Promise<unknown> = Promise.resolve()
  private pending = new Map<number, { resolve: (r: ResultMsg) => void; reject: (e: Error) => void }>()
  private onReady: { resolve: () => void; reject: (e: Error) => void } | null = null

  constructor(deps: Partial<RemoverDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps }
  }

  isDownloaded() {
    return this.deps.isCached()
  }

  async ready(onProgress?: (p: DownloadProgress) => void) {
    if (!(await this.deps.isCached())) {
      await downloadModel(onProgress)
      void prefetchRuntime(this.deps.getPreference())
    }
    await this.exclusive(() => this.withFallback(() => this.load()))
  }

  remove(image: Blob): Promise<Blob> {
    return this.exclusive(() => this.removeOnce(image))
  }

  /** Termina el worker (los pendientes fallan como cancelados). El siguiente uso lo vuelve a crear. */
  dispose() {
    this.terminate()
    const err = new CutoutError('cancelled', 'Se canceló el recorte.')
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    this.onReady?.reject(err)
    this.onReady = null
  }

  private exclusive<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job, job)
    this.chain = next.catch(() => undefined)
    return next
  }

  private async removeOnce(image: Blob): Promise<Blob> {
    for (let attempt = 0; ; attempt++) {
      let recycled = false
      try {
        await this.load()
        const { data, size } = await this.deps.toInput(image)
        const res = await this.send({ type: 'run', id: this.nextId++, data, size }, [data.buffer])
        this.lastEngine = res.engine
        if (++this.inferences >= this.deps.recycleEvery) {
          this.recycle()
          recycled = true
        }
        const blob = await this.deps.toCutout(image, res.alpha, res.size)
        if (recycled) await this.deps.pause(RECYCLE_PAUSE_MS)
        return blob
      } catch (e) {
        // Cualquier fallo o tiempo agotado: se descarta el worker (y su heap) antes de seguir.
        this.recycle()
        await this.deps.pause(RECYCLE_PAUSE_MS)
        if (isFallback(e) && attempt === 0) {
          this.deps.setPreference('wasm')
          continue
        }
        throw e
      }
    }
  }

  /** WebGPU elegido a mano falló al cargar: pasa a WASM y reintenta una vez con un worker nuevo. */
  private async withFallback(fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (e) {
      if (!isFallback(e)) throw e
      this.recycle()
      this.deps.setPreference('wasm')
      await fn()
    }
  }

  private recycle() {
    if (this.worker) this.recycleCount++
    this.terminate()
  }

  private terminate() {
    const w = this.worker
    this.worker = null
    this.loading = null
    this.inferences = 0
    if (w) {
      w.onmessage = null
      w.onerror = null
      w.terminate()
    }
  }

  private load(): Promise<void> {
    this.loading ??= this.start().catch((e) => {
      this.terminate()
      throw e
    })
    return this.loading
  }

  private async start() {
    if (!(await this.deps.isCached())) {
      throw new CutoutError('not-downloaded', 'El modelo de recorte no está descargado. Descárgalo en Ajustes.')
    }
    checkOnFirstUse()
    const worker = this.deps.createWorker()
    this.worker = worker
    worker.onmessage = (e) => this.handle(e.data)
    worker.onerror = (e) => this.fail(new CutoutError('failed', `No se pudo iniciar el recorte: ${e.message || 'error del worker'}`))
    await new Promise<void>((resolve, reject) => {
      this.onReady = { resolve, reject }
      worker.postMessage({ type: 'init', preference: this.deps.getPreference() })
    })
  }

  private handle(msg: WorkerResponse) {
    if (msg.type === 'ready') {
      this.lastEngine = msg.engine
      this.onReady?.resolve()
      this.onReady = null
    } else if (msg.type === 'result') {
      this.pending.get(msg.id)?.resolve(msg)
      this.pending.delete(msg.id)
    } else {
      const err = msg.fallback
        ? new FallbackError('failed', `WebGPU no funcionó: ${msg.message}`)
        : new CutoutError('failed', `Falló el recorte: ${msg.message}`)
      if (msg.id === undefined) {
        this.onReady?.reject(err)
        this.onReady = null
      } else {
        this.pending.get(msg.id)?.reject(err)
        this.pending.delete(msg.id)
      }
    }
  }

  private fail(err: Error) {
    this.onReady?.reject(err)
    this.onReady = null
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  private send(req: Extract<WorkerRequest, { type: 'run' }>, transfer: Transferable[]) {
    return new Promise<ResultMsg>((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject })
      this.worker!.postMessage(req, transfer)
    })
  }
}
