import { useCallback, useSyncExternalStore } from 'react'

/** Ajustes en localStorage (no en SQLite) para que los respaldos nunca incluyan la API key. */
export type Theme = 'neutral' | 'warm'
export const THEMES: readonly Theme[] = ['neutral', 'warm']

export interface Settings {
  geminiApiKey: string
  geminiModel: string
  city: string
  /** Coordenadas de `geoCity` (caché de la geocodificación de Open-Meteo). */
  latitude: number | null
  longitude: number | null
  /** Ciudad para la que se calcularon latitude/longitude; si cambia `city`, se vuelve a buscar. */
  geoCity: string | null
  /** Evaluador de compras: outfits mínimos para «Cómprala». */
  buyMinOutfits: number
  /** Evaluador de compras: ocasiones mínimas (con al menos un outfit) para «Cómprala». */
  buyMinOccasions: number
  /** Apariencia: «Neutro» o «Cálido» (el modo oscuro es automático). */
  theme: Theme
}

export const SETTINGS_STORAGE_KEY = 'armario.settings'
export const DEFAULT_MODEL = 'gemini-2.5-flash'
/** Antiguo modelo por defecto (saturado); quien lo tiene guardado sin haberlo elegido pasa al nuevo. */
const LEGACY_DEFAULT_MODEL = 'gemini-3.8-flash'

export const DEFAULT_SETTINGS: Settings = {
  geminiApiKey: '',
  geminiModel: DEFAULT_MODEL,
  city: 'Monterrey',
  latitude: null,
  longitude: null,
  geoCity: null,
  buyMinOutfits: 5,
  buyMinOccasions: 2,
  theme: 'neutral',
}

function positiveInt(v: unknown, fallback: number, max: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? Math.min(v, max) : fallback
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
      typeof stored.geminiModel === 'string' && stored.geminiModel.trim() && stored.geminiModel !== LEGACY_DEFAULT_MODEL
        ? stored.geminiModel
        : DEFAULT_SETTINGS.geminiModel,
    city: typeof stored.city === 'string' && stored.city.trim() ? stored.city : DEFAULT_SETTINGS.city,
    latitude: typeof stored.latitude === 'number' ? stored.latitude : null,
    longitude: typeof stored.longitude === 'number' ? stored.longitude : null,
    geoCity: typeof stored.geoCity === 'string' ? stored.geoCity : null,
    buyMinOutfits: positiveInt(stored.buyMinOutfits, DEFAULT_SETTINGS.buyMinOutfits, 99),
    buyMinOccasions: positiveInt(stored.buyMinOccasions, DEFAULT_SETTINGS.buyMinOccasions, 6),
    theme: THEMES.includes(stored.theme as Theme) ? (stored.theme as Theme) : DEFAULT_SETTINGS.theme,
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
