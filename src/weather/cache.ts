import type { Weather } from '../engine/types'

export const WEATHER_CACHE_KEY = 'armario.weather'
export const WEATHER_CACHE_TTL_MS = 60 * 60 * 1000

export interface WeatherCacheEntry {
  weather: Weather
  /** ms desde epoch */
  fetchedAt: number
  city: string
}

export function readWeatherCache(): WeatherCacheEntry | null {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<WeatherCacheEntry>
    if (
      typeof v.fetchedAt !== 'number' ||
      typeof v.city !== 'string' ||
      typeof v.weather?.tempC !== 'number' ||
      typeof v.weather.tempMinC !== 'number' ||
      typeof v.weather.tempMaxC !== 'number'
    ) {
      return null
    }
    return v as WeatherCacheEntry
  } catch {
    return null
  }
}

export function writeWeatherCache(entry: WeatherCacheEntry): void {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(entry))
  } catch {
    /* almacenamiento lleno o bloqueado: el clima sigue funcionando sin caché */
  }
}

export function isFresh(entry: WeatherCacheEntry, now: number): boolean {
  return now - entry.fetchedAt >= 0 && now - entry.fetchedAt < WEATHER_CACHE_TTL_MS
}
