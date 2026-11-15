import { useCallback, useSyncExternalStore } from 'react'

/** Ajustes en localStorage (no en SQLite) para que los respaldos nunca incluyan la API key. */
export interface Settings {
  geminiApiKey: string
  geminiModel: string
  city: string
  /** Se llenan en la fase 3 (clima); null por ahora. */
  latitude: number | null
  longitude: number | null
}

export const SETTINGS_STORAGE_KEY = 'armario.settings'
export const DEFAULT_MODEL = 'gemini-3.8-flash'

export const DEFAULT_SETTINGS: Settings = {
  geminiApiKey: '',
  geminiModel: DEFAULT_MODEL,
  city: 'Monterrey',
  latitude: null,
  longitude: null,
}

const listeners = new Set<() => void>()
let cacheRaw: string | null | undefined
let cacheValue: Settings = DEFAULT_SETTINGS

export function loadSettings(): Settings {
  let raw: string | null
  try {
    raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
  } catch {
    return DEFAULT_SETTINGS
  }
  if (raw === cacheRaw) return cacheValue
  cacheRaw = raw
  let stored: Partial<Settings>
  try {
    stored = raw ? (JSON.parse(raw) as Partial<Settings>) : {}
  } catch {
    stored = {}
  }
  cacheValue = {
    geminiApiKey: typeof stored.geminiApiKey === 'string' ? stored.geminiApiKey : DEFAULT_SETTINGS.geminiApiKey,
    geminiModel:
      typeof stored.geminiModel === 'string' && stored.geminiModel.trim()
        ? stored.geminiModel
        : DEFAULT_SETTINGS.geminiModel,
    city: typeof stored.city === 'string' && stored.city.trim() ? stored.city : DEFAULT_SETTINGS.city,
    latitude: typeof stored.latitude === 'number' ? stored.latitude : null,
    longitude: typeof stored.longitude === 'number' ? stored.longitude : null,
  }
  return cacheValue
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
  return loadSettings()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribe, loadSettings, () => DEFAULT_SETTINGS)
  const update = useCallback((patch: Partial<Settings>) => {
    saveSettings(patch)
  }, [])
  return [settings, update]
}
