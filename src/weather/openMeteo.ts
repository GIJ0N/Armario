import { z } from 'zod'
import type { Weather } from '../engine/types'

export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

export class WeatherError extends Error {
  constructor(message = 'No se pudo obtener el clima.') {
    super(message)
    this.name = 'WeatherError'
  }
}

export class CityNotFoundError extends WeatherError {
  constructor(city: string) {
    super(`No se encontró la ciudad «${city}». Revísala en Ajustes.`)
    this.name = 'CityNotFoundError'
  }
}

type FetchLike = typeof fetch

const geocodingSchema = z.object({
  results: z
    .array(z.object({ name: z.string(), latitude: z.number(), longitude: z.number() }))
    .optional(),
})

const forecastSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    apparent_temperature: z.number().nullish(),
    precipitation: z.number().nullish(),
    weather_code: z.number().nullish(),
  }),
  daily: z.object({
    temperature_2m_max: z.array(z.number()).min(1),
    temperature_2m_min: z.array(z.number()).min(1),
    precipitation_probability_max: z.array(z.number().nullable()).optional(),
  }),
})

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetchImpl(url)
  } catch {
    throw new WeatherError('No se pudo conectar para obtener el clima.')
  }
  if (!res.ok) throw new WeatherError(`El servicio del clima respondió con error (HTTP ${res.status}).`)
  try {
    return await res.json()
  } catch {
    throw new WeatherError('El servicio del clima devolvió una respuesta ilegible.')
  }
}

export async function geocodeCity(
  city: string,
  fetchImpl: FetchLike,
): Promise<{ latitude: number; longitude: number; name: string }> {
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(city.trim())}&count=1&language=es`
  const parsed = geocodingSchema.safeParse(await getJson(fetchImpl, url))
  if (!parsed.success) throw new WeatherError('Respuesta inesperada al buscar la ciudad.')
  const hit = parsed.data.results?.[0]
  if (!hit) throw new CityNotFoundError(city)
  return hit
}

/** Códigos WMO de llovizna, lluvia, chubascos y tormenta. */
export function isRainCode(code: number | null | undefined): boolean {
  if (code == null) return false
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)
}

export function forecastUrl(latitude: number, longitude: number): string {
  return (
    `${FORECAST_URL}?latitude=${latitude}&longitude=${longitude}` +
    '&current=temperature_2m,apparent_temperature,precipitation,weather_code' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=auto&forecast_days=1'
  )
}

export async function fetchForecast(latitude: number, longitude: number, fetchImpl: FetchLike): Promise<Weather> {
  const parsed = forecastSchema.safeParse(await getJson(fetchImpl, forecastUrl(latitude, longitude)))
  if (!parsed.success) throw new WeatherError('Respuesta inesperada del servicio del clima.')
  const { current, daily } = parsed.data
  return {
    tempC: current.temperature_2m,
    ...(current.apparent_temperature != null ? { feelsLikeC: current.apparent_temperature } : {}),
    precipProbability: daily.precipitation_probability_max?.[0] ?? 0,
    isRaining: (current.precipitation ?? 0) > 0 || isRainCode(current.weather_code),
    tempMinC: daily.temperature_2m_min[0],
    tempMaxC: daily.temperature_2m_max[0],
  }
}
