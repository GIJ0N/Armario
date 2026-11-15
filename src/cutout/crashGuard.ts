import { setEnginePreference } from './enginePref'

/**
 * Protección contra cierres por falta de memoria (iOS mata la página sin avisar). Antes de cada recorte con el
 * modelo se anota una marca en localStorage y se borra al terminar. Si al abrir la app la marca sigue ahí, el
 * recorte anterior fue interrumpido por el sistema: se fuerza WASM, la prenda en curso pasa a la lista de omitidas
 * (nunca se reintenta sola) y Ajustes muestra un aviso.
 */
export const IN_FLIGHT_KEY = 'armario.cutoutInFlight'
export const CRASHED_KEY = 'armario.cutoutCrashed'
export const SKIP_KEY = 'armario.cutoutSkip'

// Recortes en curso en ESTA sesión: su marca no es de un cierre anterior.
let activeNow = 0
let checkedThisSession = false

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* sin almacenamiento */
  }
}

export function getSkipList(): string[] {
  try {
    const parsed: unknown = JSON.parse(read(SKIP_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function addSkip(id: string) {
  const list = getSkipList()
  if (!list.includes(id)) write(SKIP_KEY, JSON.stringify([...list, id]))
}

export function isSkipped(id: string | undefined): boolean {
  return !!id && getSkipList().includes(id)
}

export function clearSkipList() {
  write(SKIP_KEY, null)
}

export function hasCrashed(): boolean {
  return read(CRASHED_KEY) !== null
}

export function acknowledgeCrash() {
  write(CRASHED_KEY, null)
}

export function markInFlight(garmentId?: string) {
  activeNow++
  write(IN_FLIGHT_KEY, JSON.stringify({ garmentId, startedAt: Date.now() }))
}

export function clearInFlight() {
  activeNow = Math.max(0, activeNow - 1)
  if (activeNow === 0) write(IN_FLIGHT_KEY, null)
}

/** Ejecuta `work` con la marca puesta; la quita siempre al terminar (éxito o error). */
export async function withInFlight<T>(garmentId: string | undefined, work: () => Promise<T>): Promise<T> {
  markInFlight(garmentId)
  try {
    return await work()
  } finally {
    clearInFlight()
  }
}

/** Si hay una marca de una sesión anterior, procesa el cierre. Devuelve true si detectó uno. */
export function checkPreviousCrash(): boolean {
  checkedThisSession = true
  if (activeNow > 0) return false
  const raw = read(IN_FLIGHT_KEY)
  if (raw === null) return false
  write(IN_FLIGHT_KEY, null)
  write(CRASHED_KEY, String(Date.now()))
  setEnginePreference('wasm')
  try {
    const parsed = JSON.parse(raw) as { garmentId?: unknown }
    if (typeof parsed.garmentId === 'string') addSkip(parsed.garmentId)
  } catch {
    /* marca ilegible: igual cuenta como cierre */
  }
  return true
}

/** Primer uso del quitafondos en la sesión: revisa una sola vez. */
export function checkOnFirstUse() {
  if (!checkedThisSession) checkPreviousCrash()
}

/** Solo para pruebas. */
export function resetCrashGuardForTests() {
  activeNow = 0
  checkedThisSession = false
}
