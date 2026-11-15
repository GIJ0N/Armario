import type { EnginePreference } from './protocol'

const KEY = 'armario.cutoutEngine'

/** WASM por defecto en todas partes. Los valores antiguos ('auto') migran a 'wasm'; WebGPU solo si se eligió a mano. */
export function getEnginePreference(): EnginePreference {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'webgpu') return 'webgpu'
    if (stored !== null && stored !== 'wasm') localStorage.setItem(KEY, 'wasm')
    return 'wasm'
  } catch {
    return 'wasm'
  }
}

export function setEnginePreference(pref: EnginePreference) {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* sin almacenamiento: se queda en WASM */
  }
}

export function webGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as { gpu?: unknown }).gpu
}
