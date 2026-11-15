// Lógica de la sesión de ONNX Runtime separada del worker para poder probarla con un `ort` simulado.
import { alphaCoverage, maskToAlpha } from './geometry'
import { MIN_MASK_COVERAGE } from './modelConfig'
import type { WorkerEngine } from './protocol'

export interface TensorLike {
  getData(): Promise<unknown>
  dispose?(): void
}

export interface SessionLike {
  inputNames: readonly string[]
  outputNames: readonly string[]
  run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>>
  release(): Promise<void>
}

export interface OrtLike {
  env: { wasm: { wasmPaths?: unknown; numThreads?: number; proxy?: boolean } }
  InferenceSession: { create(model: Uint8Array, options: Record<string, unknown>): Promise<SessionLike> }
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => TensorLike
}

export interface SessionDeps {
  readModel(): Promise<ArrayBuffer | null>
  loadOrt(engine: WorkerEngine): Promise<OrtLike>
  wasmUrl(engine: WorkerEngine): string
}

/** WebGPU (elegido a mano) falló o devolvió una máscara vacía: la sesión ya se liberó; hay que reintentar con WASM. */
export class EngineFallbackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineFallbackError'
  }
}

/**
 * Opciones de sesión pensadas para memoria mínima (iOS mata la página por encima de su límite):
 * - 'basic' evita las optimizaciones de diseño/transposición que duplican los pesos en memoria;
 * - sin arena de CPU ni patrón de memoria: ORT no retiene bloques grandes entre inferencias;
 * - ejecución secuencial: un solo operador a la vez, menos tensores intermedios vivos.
 */
export const SESSION_OPTIONS = {
  graphOptimizationLevel: 'basic',
  enableCpuMemArena: false,
  enableMemPattern: false,
  executionMode: 'sequential',
} as const

interface Loaded {
  ort: OrtLike
  session: SessionLike
  engine: WorkerEngine
}

/** Mantiene como máximo UNA sesión: siempre libera la anterior antes de crear otra. */
export class SessionManager {
  private modelBytes: Uint8Array | null = null
  private loaded: Loaded | null = null
  /** Sesiones creadas en la vida de este manager (para pruebas). */
  created = 0

  private deps: SessionDeps

  constructor(deps: SessionDeps) {
    this.deps = deps
  }

  get engine(): WorkerEngine | null {
    return this.loaded?.engine ?? null
  }

  async init(engine: WorkerEngine): Promise<WorkerEngine> {
    if (this.loaded?.engine === engine) return engine
    await this.release()
    try {
      this.loaded = await this.create(engine)
    } catch (e) {
      await this.release()
      if (engine === 'webgpu') throw new EngineFallbackError(e instanceof Error ? e.message : String(e))
      throw e
    }
    return engine
  }

  async run(engine: WorkerEngine, data: Float32Array, size: number): Promise<{ alpha: Uint8ClampedArray; engine: WorkerEngine }> {
    await this.init(engine)
    const l = this.loaded!
    const input: TensorLike = new l.ort.Tensor('float32', data, [1, 3, size, size])
    let outputs: Record<string, TensorLike> | null = null
    try {
      outputs = await l.session.run({ [l.session.inputNames[0]]: input })
      const out = outputs[l.session.outputNames[0]]
      // A bytes cuanto antes: el Float32 de 1024² (4 MB) no sale de aquí.
      const alpha = maskToAlpha((await out.getData()) as ArrayLike<number>)
      if (l.engine === 'webgpu' && alphaCoverage(alpha) < MIN_MASK_COVERAGE) {
        throw new EngineFallbackError('WebGPU devolvió una máscara vacía.')
      }
      return { alpha, engine: l.engine }
    } catch (e) {
      if (l.engine === 'webgpu') {
        await this.release()
        throw e instanceof EngineFallbackError ? e : new EngineFallbackError(e instanceof Error ? e.message : String(e))
      }
      throw e
    } finally {
      input.dispose?.()
      for (const t of Object.values(outputs ?? {})) t.dispose?.()
    }
  }

  async release() {
    const l = this.loaded
    this.loaded = null
    if (l) {
      try {
        await l.session.release()
      } catch {
        /* ya liberada */
      }
    }
  }

  private async create(engine: WorkerEngine): Promise<Loaded> {
    if (!this.modelBytes) {
      const buf = await this.deps.readModel()
      if (!buf) throw new Error('El modelo no está descargado.')
      this.modelBytes = new Uint8Array(buf)
    }
    const ort = await this.deps.loadOrt(engine)
    ort.env.wasm.wasmPaths = { wasm: this.deps.wasmUrl(engine) }
    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false
    let session: SessionLike
    try {
      session = await ort.InferenceSession.create(this.modelBytes, { executionProviders: [engine], ...SESSION_OPTIONS })
    } finally {
      // ORT ya copió los pesos a su heap: soltar los 44 MB de JS para no tenerlos dos veces.
      this.modelBytes = null
    }
    this.created++
    return { ort, session, engine }
  }
}
