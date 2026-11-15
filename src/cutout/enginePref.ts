import type { EnginePreference } from './protocol'

const KEY = 'armario.cutoutEngine'

export function getEnginePreference(): EnginePreference {
  try {
    return localStorage.getItem(KEY) === 'wasm' ? 'wasm' : 'auto'
  } catch {
    return 'auto'
  }
}

export function setEnginePreference(pref: EnginePreference) {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* sin almacenamiento: se queda en automático */
  }
}

export function webGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as { gpu?: unknown }).gpu
}
