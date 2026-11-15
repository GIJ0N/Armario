import type { CutoutEngine } from './types'

export type WorkerEngine = Exclude<CutoutEngine, 'bbox'>

/**
 * 'wasm' = WASM de un hilo (por defecto, el más estable en iPhone). 'webgpu' = opcional y experimental: solo si
 * se elige a mano en Ajustes; si falla o devuelve una máscara vacía se vuelve a 'wasm' con un worker nuevo.
 */
export type EnginePreference = 'wasm' | 'webgpu'

export type WorkerRequest =
  | { type: 'init'; preference: EnginePreference }
  | { type: 'run'; id: number; data: Float32Array; size: number }

export type WorkerResponse =
  | { type: 'ready'; engine: WorkerEngine }
  // `alpha` ya va en 0–255 (1 byte por píxel): el worker no manda el Float32 de la salida del modelo.
  | { type: 'result'; id: number; alpha: Uint8ClampedArray; size: number; engine: WorkerEngine }
  // `fallback`: WebGPU (elegido a mano) falló o devolvió una máscara vacía; el worker ya liberó la sesión.
  | { type: 'error'; id?: number; message: string; fallback?: boolean }
