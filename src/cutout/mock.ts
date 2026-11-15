import { CutoutError, type BackgroundRemover, type DownloadProgress } from './types'

export interface MockRemoverOptions {
  /** ¿Ya está descargado el modelo? Por defecto true. */
  downloaded?: boolean
  engine?: 'webgpu' | 'wasm'
  delayMs?: number
  /** Si se define, remove falla con este error. */
  error?: Error
  /** Falla solo estas llamadas a remove (1 = la primera). */
  failCalls?: number[]
}

/** Quitafondos determinista para pruebas: nunca carga el modelo real ni toca la red. */
export class MockBackgroundRemover implements BackgroundRemover {
  readonly removeCalls: Blob[] = []
  readyCalls = 0
  disposeCalls = 0
  lastEngine: 'webgpu' | 'wasm' | null = null
  recycleCount = 0
  options: MockRemoverOptions
  private downloaded: boolean

  constructor(options: MockRemoverOptions = {}) {
    this.options = options
    this.downloaded = options.downloaded ?? true
  }

  async isDownloaded() {
    return this.downloaded
  }

  async ready(onProgress?: (p: DownloadProgress) => void) {
    this.readyCalls++
    if (!this.downloaded) {
      onProgress?.({ loaded: 20, total: 40, fraction: 0.5 })
      await this.wait()
      onProgress?.({ loaded: 40, total: 40, fraction: 1 })
      this.downloaded = true
    }
  }

  async remove(image: Blob) {
    this.removeCalls.push(image)
    if (!this.downloaded) throw new CutoutError('not-downloaded', 'El modelo de recorte no está descargado.')
    await this.wait()
    const n = this.removeCalls.length
    if (this.options.error || this.options.failCalls?.includes(n)) {
      throw this.options.error ?? new CutoutError('failed', 'Falló el recorte simulado.')
    }
    this.lastEngine = this.options.engine ?? 'wasm'
    return new Blob([`cutout-${n}`], { type: 'image/png' })
  }

  dispose() {
    this.disposeCalls++
  }

  private async wait() {
    if (this.options.delayMs) await new Promise((r) => setTimeout(r, this.options.delayMs))
  }
}
