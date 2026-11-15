import type { Weather } from '../engine/types'
import type { DailyForecastDay } from './openMeteo'

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

export const DAILY_CACHE_KEY = 'armario.weather.daily'

export interface DailyCacheEntry {
  days: DailyForecastDay[]
  /** ms desde epoch */
  fetchedAt: number
  city: string
}

export function readDailyCache(): DailyCacheEntry | null {
  try {
    const raw = localStorage.getItem(DAILY_CACHE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<DailyCacheEntry>
    if (
      typeof v.fetchedAt !== 'number' ||
      typeof v.city !== 'string' ||
      !Array.isArray(v.days) ||
      v.days.some(
        (d) =>
          typeof d?.date !== 'string' || typeof d.tempMaxC !== 'number' || typeof d.tempMinC !== 'number' || typeof d.precipProbability !== 'number',
      )
    ) {
      return null
    }
    return v as DailyCacheEntry
  } catch {
    return null
  }
}

export function writeDailyCache(entry: DailyCacheEntry): void {
  try {
    localStorage.setItem(DAILY_CACHE_KEY, JSON.stringify(entry))
  } catch {
    /* almacenamiento lleno o bloqueado: el pronóstico sigue funcionando sin caché */
  }
}

export function isDailyFresh(entry: DailyCacheEntry, now: number): boolean {
  return now - entry.fetchedAt >= 0 && now - entry.fetchedAt < WEATHER_CACHE_TTL_MS
}
