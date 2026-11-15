import { getEnginePreference } from './enginePref'
import { imageToModelInput, maskToCutoutBlob } from './imageOps'
import { downloadModel, isModelCached, prefetchRuntime } from './modelStore'
import type { WorkerRequest, WorkerResponse } from './protocol'
import { CutoutError, type BackgroundRemover, type DownloadProgress } from './types'

/** Implementación real: ONNX Runtime Web en un Web Worker (WebGPU si hay; si no, WASM de un hilo). */
export class OnnxBackgroundRemover implements BackgroundRemover {
  lastEngine: 'webgpu' | 'wasm' | null = null

  private worker: Worker | null = null
  private loading: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (r: Extract<WorkerResponse, { type: 'result' }>) => void; reject: (e: Error) => void }>()
  private onReady: { resolve: () => void; reject: (e: Error) => void } | null = null

  isDownloaded() {
    return isModelCached()
  }

  async ready(onProgress?: (p: DownloadProgress) => void) {
    if (!(await isModelCached())) {
      await downloadModel(onProgress)
      void prefetchRuntime(getEnginePreference())
    }
    await this.load()
  }

  async remove(image: Blob) {
    await this.load()
    const { data, size } = await imageToModelInput(image)
    const res = await this.send({ type: 'run', id: this.nextId++, data, size }, [data.buffer])
    this.lastEngine = res.engine
    return maskToCutoutBlob(image, res.mask, res.size)
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.loading = null
    const err = new CutoutError('cancelled', 'Se canceló el recorte.')
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    this.onReady?.reject(err)
    this.onReady = null
  }

  private load(): Promise<void> {
    this.loading ??= this.start().catch((e) => {
      this.dispose()
      throw e
    })
    return this.loading
  }

  private async start() {
    if (!(await isModelCached())) {
      throw new CutoutError('not-downloaded', 'El modelo de recorte no está descargado. Descárgalo en Ajustes.')
    }
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data)
    worker.onerror = (e) => this.fail(new CutoutError('failed', `No se pudo iniciar el recorte: ${e.message || 'error del worker'}`))
    await new Promise<void>((resolve, reject) => {
      this.onReady = { resolve, reject }
      const init: WorkerRequest = { type: 'init', preference: getEnginePreference() }
      worker.postMessage(init)
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
      const err = new CutoutError('failed', `Falló el recorte: ${msg.message}`)
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
    return new Promise<Extract<WorkerResponse, { type: 'result' }>>((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject })
      this.worker!.postMessage(req, transfer)
    })
  }
}
