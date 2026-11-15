import type { CutoutEngine } from './types'

export type WorkerEngine = Exclude<CutoutEngine, 'bbox'>

/** 'auto' = WebGPU si el navegador lo ofrece y, si falla, WASM; 'wasm' = solo WASM de un hilo. */
export type EnginePreference = 'auto' | 'wasm'

export type WorkerRequest =
  | { type: 'init'; preference: EnginePreference }
  | { type: 'run'; id: number; data: Float32Array; size: number }

export type WorkerResponse =
  | { type: 'ready'; engine: WorkerEngine }
  | { type: 'result'; id: number; mask: Float32Array; size: number; engine: WorkerEngine }
  | { type: 'error'; id?: number; message: string }
