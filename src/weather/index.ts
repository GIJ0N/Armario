import type { Weather } from '../engine/types'
import { WEATHER_PRESETS } from './presets'
import { loadSettings, saveSettings, type Settings } from '../settings'
import { isDailyFresh, isFresh, readDailyCache, readWeatherCache, writeDailyCache, writeWeatherCache } from './cache'
import { fetchDailyForecast, fetchForecast, geocodeCity, weatherFromDaily, type DailyForecastDay } from './openMeteo'

export * from './openMeteo'
export * from './presets'
export { DAILY_CACHE_KEY, WEATHER_CACHE_KEY, WEATHER_CACHE_TTL_MS } from './cache'

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

export interface DailyForecastResult {
  days: DailyForecastDay[]
  fetchedAt: number
  ageMs: number
  /** 'red' = consulta nueva; 'cache' = guardado de hace menos de 1 h; 'antiguo' = vencido, usado sin conexión. */
  origin: 'red' | 'cache' | 'antiguo'
  city: string
}

/**
 * Pronóstico de hasta 7 días para el calendario: misma caché de 1 h y misma lógica sin conexión que `loadWeather`
 * (caché → Open-Meteo → caché vencida). Devuelve null si no hay nada; entonces se usa un clima templado.
 */
export async function loadDailyForecast(opts: LoadWeatherOptions = {}): Promise<DailyForecastResult | null> {
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const now = opts.now ?? Date.now()
  const settings = opts.settings ?? loadSettings()
  const save = opts.saveSettings ?? saveSettings
  const city = settings.city.trim()

  const cached = readDailyCache()
  const sameCity = cached && cached.city === city ? cached : null
  const from = (e: NonNullable<typeof sameCity>, origin: DailyForecastResult['origin']): DailyForecastResult => ({
    days: e.days,
    fetchedAt: e.fetchedAt,
    ageMs: now - e.fetchedAt,
    origin,
    city,
  })
  if (sameCity && !opts.force && isDailyFresh(sameCity, now)) return from(sameCity, 'cache')

  try {
    let { latitude, longitude } = settings
    if (latitude == null || longitude == null || settings.geoCity !== city) {
      const hit = await geocodeCity(city, fetchImpl)
      latitude = hit.latitude
      longitude = hit.longitude
      save({ latitude, longitude, geoCity: city })
    }
    const days = await fetchDailyForecast(latitude, longitude, fetchImpl)
    writeDailyCache({ days, fetchedAt: now, city })
    return { days, fetchedAt: now, ageMs: 0, origin: 'red', city }
  } catch {
    return sameCity ? from(sameCity, 'antiguo') : null
  }
}

export type DateWeather =
  | { source: 'forecast'; weather: Weather; day: DailyForecastDay }
  | { source: 'neutral'; weather: Weather }

/** Texto de la UI cuando no hay pronóstico para la fecha. */
export const NEUTRAL_WEATHER_NOTE = 'sin pronóstico: clima templado'

/**
 * Clima para planear un día: el pronóstico de esa fecha si está dentro del rango (hasta 7 días); si no (fuera de
 * rango, sin conexión o fecha pasada), el clima «templado» neutro.
 */
export function weatherForDate(forecast: DailyForecastResult | null, date: string): DateWeather {
  const day = forecast?.days.find((d) => d.date === date)
  if (day) return { source: 'forecast', weather: weatherFromDaily(day), day }
  return { source: 'neutral', weather: WEATHER_PRESETS.warm }
}
