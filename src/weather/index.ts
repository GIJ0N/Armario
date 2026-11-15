import type { Weather } from '../engine/types'
import { loadSettings, saveSettings, type Settings } from '../settings'
import { isFresh, readWeatherCache, writeWeatherCache } from './cache'
import { fetchForecast, geocodeCity } from './openMeteo'

export * from './openMeteo'
export * from './presets'
export { WEATHER_CACHE_KEY, WEATHER_CACHE_TTL_MS } from './cache'

export interface WeatherResult {
  weather: Weather
  /** ms desde epoch de la consulta original. */
  fetchedAt: number
  /** Milisegundos transcurridos entre la consulta original y esta lectura. */
  ageMs: number
  /** 'red' = consulta nueva; 'cache' = guardado de hace menos de 1 h; 'antiguo' = guardado vencido usado sin conexión. */
  origin: 'red' | 'cache' | 'antiguo'
  city: string
}

export interface LoadWeatherOptions {
  fetchImpl?: typeof fetch
  now?: number
  settings?: Settings
  saveSettings?: (patch: Partial<Settings>) => void
  /** Ignora la caché fresca. */
  force?: boolean
}

/**
 * Clima de hoy: caché de 1 h → Open-Meteo (con la ciudad geocodificada y guardada en Ajustes) → caché vencida.
 * Devuelve null si no hay nada; entonces la UI ofrece un clima manual.
 */
export async function loadWeather(opts: LoadWeatherOptions = {}): Promise<WeatherResult | null> {
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const now = opts.now ?? Date.now()
  const settings = opts.settings ?? loadSettings()
  const save = opts.saveSettings ?? saveSettings
  const city = settings.city.trim()

  const cached = readWeatherCache()
  const sameCity = cached && cached.city === city ? cached : null
  if (sameCity && !opts.force && isFresh(sameCity, now)) {
    return { weather: sameCity.weather, fetchedAt: sameCity.fetchedAt, ageMs: now - sameCity.fetchedAt, origin: 'cache', city }
  }

  try {
    let { latitude, longitude } = settings
    if (latitude == null || longitude == null || settings.geoCity !== city) {
      const hit = await geocodeCity(city, fetchImpl)
      latitude = hit.latitude
      longitude = hit.longitude
      save({ latitude, longitude, geoCity: city })
    }
    const weather = await fetchForecast(latitude, longitude, fetchImpl)
    writeWeatherCache({ weather, fetchedAt: now, city })
    return { weather, fetchedAt: now, ageMs: 0, origin: 'red', city }
  } catch {
    if (sameCity) return { weather: sameCity.weather, fetchedAt: sameCity.fetchedAt, ageMs: now - sameCity.fetchedAt, origin: 'antiguo', city }
    return null
  }
}
