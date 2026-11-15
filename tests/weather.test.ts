import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../src/settings'
import {
  CityNotFoundError,
  fetchForecast,
  forecastUrl,
  geocodeCity,
  isRainCode,
  loadWeather,
  WEATHER_CACHE_KEY,
  WEATHER_CACHE_TTL_MS,
  WEATHER_PRESETS,
  WEATHER_PRESET_KEYS,
  WeatherError,
} from '../src/weather'

const geo = { results: [{ name: 'Monterrey', latitude: 25.67, longitude: -100.31 }] }
const forecast = {
  current: { temperature_2m: 29.4, apparent_temperature: 33.1, precipitation: 0, weather_code: 3 },
  daily: { temperature_2m_max: [34.2], temperature_2m_min: [24.1], precipitation_probability_max: [20] },
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

function mockFetch(handlers: { geo?: unknown; forecast?: unknown; fail?: boolean } = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    if (handlers.fail) return Promise.reject(new TypeError('offline'))
    const url = String(input)
    if (url.startsWith('https://geocoding-api.open-meteo.com/')) return json(handlers.geo ?? geo)
    if (url.startsWith('https://api.open-meteo.com/')) return json(handlers.forecast ?? forecast)
    return Promise.reject(new Error(`URL inesperada ${url}`))
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over })
const NOW = 1_800_000_000_000

beforeEach(() => localStorage.clear())

describe('Open-Meteo', () => {
  it('geocodifica con la URL esperada', async () => {
    const f = mockFetch()
    expect(await geocodeCity('San Pedro Garza García', f)).toMatchObject({ latitude: 25.67, longitude: -100.31 })
    expect(vi.mocked(f).mock.calls[0][0]).toBe(
      'https://geocoding-api.open-meteo.com/v1/search?name=San%20Pedro%20Garza%20Garc%C3%ADa&count=1&language=es',
    )
  })

  it('ciudad inexistente', async () => {
    await expect(geocodeCity('Zzz', mockFetch({ geo: {} }))).rejects.toBeInstanceOf(CityNotFoundError)
  })

  it('pide el pronóstico y lo mapea a Weather', async () => {
    const f = mockFetch()
    const w = await fetchForecast(25.67, -100.31, f)
    expect(vi.mocked(f).mock.calls[0][0]).toBe(forecastUrl(25.67, -100.31))
    expect(forecastUrl(1, 2)).toContain('current=temperature_2m,apparent_temperature,precipitation,weather_code')
    expect(forecastUrl(1, 2)).toContain('daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max')
    expect(forecastUrl(1, 2)).toContain('timezone=auto&forecast_days=1')
    expect(w).toEqual({ tempC: 29.4, feelsLikeC: 33.1, precipProbability: 20, isRaining: false, tempMinC: 24.1, tempMaxC: 34.2 })
  })

  it('detecta lluvia por precipitación o por código', async () => {
    const wet = (current: object) => ({ ...forecast, current: { ...forecast.current, ...current } })
    expect((await fetchForecast(1, 1, mockFetch({ forecast: wet({ precipitation: 0.4 }) }))).isRaining).toBe(true)
    expect((await fetchForecast(1, 1, mockFetch({ forecast: wet({ weather_code: 63 }) }))).isRaining).toBe(true)
    expect(isRainCode(95)).toBe(true)
    expect(isRainCode(45)).toBe(false)
    expect(isRainCode(null)).toBe(false)
  })

  it('tolera campos opcionales ausentes', async () => {
    const f = mockFetch({
      forecast: { current: { temperature_2m: 20 }, daily: { temperature_2m_max: [25], temperature_2m_min: [15] } },
    })
    expect(await fetchForecast(1, 1, f)).toEqual({ tempC: 20, precipProbability: 0, isRaining: false, tempMinC: 15, tempMaxC: 25 })
  })

  it('errores HTTP, de red y de formato son WeatherError', async () => {
    const http = vi.fn(() => json({}, 500)) as unknown as typeof fetch
    await expect(fetchForecast(1, 1, http)).rejects.toBeInstanceOf(WeatherError)
    await expect(fetchForecast(1, 1, mockFetch({ fail: true }))).rejects.toBeInstanceOf(WeatherError)
    await expect(fetchForecast(1, 1, mockFetch({ forecast: { nope: true } }))).rejects.toBeInstanceOf(WeatherError)
  })
})

describe('loadWeather', () => {
  it('consulta, guarda coordenadas en ajustes y cachea', async () => {
    const f = mockFetch()
    const save = vi.fn()
    const r = await loadWeather({ fetchImpl: f, now: NOW, settings: settings(), saveSettings: save })
    expect(r).toMatchObject({ origin: 'red', city: 'Monterrey', weather: { tempC: 29.4 } })
    expect(save).toHaveBeenCalledWith({ latitude: 25.67, longitude: -100.31, geoCity: 'Monterrey' })
    expect(f).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(WEATHER_CACHE_KEY)).toContain('29.4')
  })

  it('no vuelve a geocodificar si ya hay coordenadas de la misma ciudad', async () => {
    const f = mockFetch()
    await loadWeather({ fetchImpl: f, now: NOW, settings: settings({ latitude: 1, longitude: 2, geoCity: 'Monterrey' }) })
    expect(f).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(f).mock.calls[0][0])).toContain('latitude=1&longitude=2')
  })

  it('vuelve a geocodificar si cambió la ciudad', async () => {
    const f = mockFetch()
    await loadWeather({ fetchImpl: f, now: NOW, settings: settings({ city: 'Saltillo', latitude: 1, longitude: 2, geoCity: 'Monterrey' }), saveSettings: vi.fn() })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('usa la caché durante 1 h sin llamar a la red', async () => {
    await loadWeather({ fetchImpl: mockFetch(), now: NOW, settings: settings(), saveSettings: vi.fn() })
    const f = mockFetch()
    const r = await loadWeather({ fetchImpl: f, now: NOW + WEATHER_CACHE_TTL_MS - 1, settings: settings() })
    expect(r?.origin).toBe('cache')
    expect(f).not.toHaveBeenCalled()
  })

  it('pasada 1 h consulta de nuevo; `force` también', async () => {
    await loadWeather({ fetchImpl: mockFetch(), now: NOW, settings: settings({ latitude: 1, longitude: 2, geoCity: 'Monterrey' }) })
    const f = mockFetch()
    expect((await loadWeather({ fetchImpl: f, now: NOW + WEATHER_CACHE_TTL_MS, settings: settings({ latitude: 1, longitude: 2, geoCity: 'Monterrey' }) }))?.origin).toBe('red')
    const g = mockFetch()
    await loadWeather({ fetchImpl: g, now: NOW + 1, force: true, settings: settings({ latitude: 1, longitude: 2, geoCity: 'Monterrey' }) })
    expect(g).toHaveBeenCalled()
  })

  it('sin conexión usa la caché vencida; sin caché devuelve null', async () => {
    const offline = mockFetch({ fail: true })
    expect(await loadWeather({ fetchImpl: offline, now: NOW, settings: settings() })).toBeNull()
    await loadWeather({ fetchImpl: mockFetch(), now: NOW, settings: settings({ latitude: 1, longitude: 2, geoCity: 'Monterrey' }) })
    const r = await loadWeather({ fetchImpl: offline, now: NOW + 5 * WEATHER_CACHE_TTL_MS, settings: settings({ latitude: 1, longitude: 2, geoCity: 'Monterrey' }) })
    expect(r?.origin).toBe('antiguo')
    expect(r?.weather.tempC).toBe(29.4)
  })

  it('ignora una caché de otra ciudad', async () => {
    await loadWeather({ fetchImpl: mockFetch(), now: NOW, settings: settings({ latitude: 1, longitude: 2, geoCity: 'Monterrey' }) })
    expect(await loadWeather({ fetchImpl: mockFetch({ fail: true }), now: NOW + 1, settings: settings({ city: 'Saltillo' }) })).toBeNull()
  })

  it('caché corrupta se ignora', async () => {
    localStorage.setItem(WEATHER_CACHE_KEY, '{no json')
    expect(await loadWeather({ fetchImpl: mockFetch({ fail: true }), now: NOW, settings: settings() })).toBeNull()
  })
})

describe('presets manuales', () => {
  it('hay cinco y la lluvia está marcada', () => {
    expect(WEATHER_PRESET_KEYS).toHaveLength(5)
    expect(WEATHER_PRESETS.rain.isRaining).toBe(true)
    expect(WEATHER_PRESETS.hot.tempC).toBeGreaterThan(WEATHER_PRESETS.cold.tempC)
  })
})
