import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../src/settings'
import {
  DAILY_CACHE_KEY,
  dailyForecastUrl,
  fetchDailyForecast,
  loadDailyForecast,
  NEUTRAL_WEATHER_NOTE,
  weatherForDate,
  weatherFromDaily,
  WEATHER_CACHE_TTL_MS,
  WEATHER_PRESETS,
  WeatherError,
} from '../src/weather'

const geo = { results: [{ name: 'Monterrey', latitude: 25.67, longitude: -100.31 }] }
const daily = {
  daily: {
    time: ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'],
    temperature_2m_max: [28, 30, 26, 18.5, 22, 31, 33],
    temperature_2m_min: [16, 17, 15, 9, 12, 18, 20],
    precipitation_probability_max: [0, 10, 60, 80, null, 5, 0],
  },
}
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

function mockFetch(opts: { fail?: boolean; body?: unknown } = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    if (opts.fail) return Promise.reject(new TypeError('offline'))
    const url = String(input)
    if (url.startsWith('https://geocoding-api.open-meteo.com/')) return json(geo)
    if (url.startsWith('https://api.open-meteo.com/')) return json(opts.body ?? daily)
    return Promise.reject(new Error(`URL inesperada ${url}`))
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over })
const NOW = 1_800_000_000_000

beforeEach(() => localStorage.clear())

describe('pronóstico diario (Open-Meteo)', () => {
  it('pide 7 días con la URL esperada y mapea máximas, mínimas y lluvia', async () => {
    const f = mockFetch()
    const days = await fetchDailyForecast(25.67, -100.31, f)
    expect(vi.mocked(f).mock.calls[0][0]).toBe(dailyForecastUrl(25.67, -100.31))
    expect(dailyForecastUrl(1, 2)).toContain('daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max')
    expect(dailyForecastUrl(1, 2)).toContain('timezone=auto&forecast_days=7')
    expect(days).toHaveLength(7)
    expect(days[0]).toEqual({ date: '2026-11-15', tempMaxC: 28, tempMinC: 16, precipProbability: 0 })
    expect(days[4].precipProbability).toBe(0) // null -> 0
    expect(days[3]).toEqual({ date: '2026-11-18', tempMaxC: 18.5, tempMinC: 9, precipProbability: 80 })
  })

  it('omite días sin temperaturas y rechaza respuestas inesperadas', async () => {
    const partial = { daily: { time: ['2026-11-15', '2026-11-16'], temperature_2m_max: [28, null], temperature_2m_min: [16, null] } }
    expect(await fetchDailyForecast(1, 2, mockFetch({ body: partial }))).toHaveLength(1)
    await expect(fetchDailyForecast(1, 2, mockFetch({ body: { daily: { time: [] } } }))).rejects.toBeInstanceOf(WeatherError)
    await expect(fetchDailyForecast(1, 2, mockFetch({ body: { nada: 1 } }))).rejects.toBeInstanceOf(WeatherError)
    await expect(
      fetchDailyForecast(1, 2, vi.fn(() => json({}, 500)) as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 500/)
  })

  it('weatherFromDaily pesa la máxima y copia la probabilidad de lluvia', () => {
    const w = weatherFromDaily({ date: '2026-11-16', tempMaxC: 30, tempMinC: 17, precipProbability: 10 })
    expect(w).toMatchObject({ tempMinC: 17, tempMaxC: 30, precipProbability: 10, isRaining: false })
    expect(w.tempC).toBeGreaterThan(17)
    expect(w.tempC).toBeLessThan(30)
    expect(w.tempC).toBeCloseTo(25.5, 1)
  })

  it('loadDailyForecast: red → caché de 1 h → red de nuevo al vencer', async () => {
    const f = mockFetch()
    const saved: Partial<Settings>[] = []
    const opts = { fetchImpl: f, settings: settings(), saveSettings: (p: Partial<Settings>) => saved.push(p) }
    const first = await loadDailyForecast({ ...opts, now: NOW })
    expect(first).toMatchObject({ origin: 'red', ageMs: 0, city: 'Monterrey' })
    expect(first?.days).toHaveLength(7)
    expect(saved[0]).toMatchObject({ latitude: 25.67, longitude: -100.31, geoCity: 'Monterrey' })
    expect(JSON.parse(localStorage.getItem(DAILY_CACHE_KEY)!)).toMatchObject({ city: 'Monterrey', fetchedAt: NOW })
    const callsAfterFirst = vi.mocked(f).mock.calls.length

    const cached = await loadDailyForecast({ ...opts, now: NOW + 59 * 60_000 })
    expect(cached?.origin).toBe('cache')
    expect(vi.mocked(f).mock.calls.length).toBe(callsAfterFirst)

    const expired = await loadDailyForecast({ ...opts, now: NOW + WEATHER_CACHE_TTL_MS + 1 })
    expect(expired?.origin).toBe('red')
    expect(vi.mocked(f).mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it('sin conexión: usa la caché vencida (antiguo); sin caché devuelve null', async () => {
    const ok = settings({ latitude: 25.67, longitude: -100.31, geoCity: 'Monterrey' })
    await loadDailyForecast({ fetchImpl: mockFetch(), settings: ok, now: NOW })
    const old = await loadDailyForecast({ fetchImpl: mockFetch({ fail: true }), settings: ok, now: NOW + 3 * WEATHER_CACHE_TTL_MS })
    expect(old).toMatchObject({ origin: 'antiguo', ageMs: 3 * WEATHER_CACHE_TTL_MS })
    expect(old?.days).toHaveLength(7)
    localStorage.clear()
    expect(await loadDailyForecast({ fetchImpl: mockFetch({ fail: true }), settings: ok, now: NOW })).toBeNull()
  })

  it('una caché de otra ciudad no se usa y una caché corrupta se ignora', async () => {
    await loadDailyForecast({ fetchImpl: mockFetch(), settings: settings(), now: NOW })
    const other = settings({ city: 'Guadalajara' })
    expect(await loadDailyForecast({ fetchImpl: mockFetch({ fail: true }), settings: other, now: NOW + 1 })).toBeNull()
    localStorage.setItem(DAILY_CACHE_KEY, '{"days":[{"date":1}],"fetchedAt":1,"city":"Monterrey"}')
    expect(await loadDailyForecast({ fetchImpl: mockFetch({ fail: true }), settings: settings(), now: NOW })).toBeNull()
    localStorage.setItem(DAILY_CACHE_KEY, 'no es json')
    expect(await loadDailyForecast({ fetchImpl: mockFetch({ fail: true }), settings: settings(), now: NOW })).toBeNull()
  })

  it('weatherForDate: pronóstico dentro del rango; clima templado neutro fuera de rango, sin red o en el pasado', async () => {
    const forecast = await loadDailyForecast({ fetchImpl: mockFetch(), settings: settings(), now: NOW })
    const inRange = weatherForDate(forecast, '2026-11-18')
    expect(inRange.source).toBe('forecast')
    expect(inRange.weather).toMatchObject({ tempMinC: 9, tempMaxC: 18.5, precipProbability: 80 })
    for (const date of ['2026-11-22', '2026-12-25', '2026-11-14']) {
      const w = weatherForDate(forecast, date)
      expect(w.source).toBe('neutral')
      expect(w.weather).toEqual(WEATHER_PRESETS.warm)
    }
    expect(weatherForDate(null, '2026-11-18')).toEqual({ source: 'neutral', weather: WEATHER_PRESETS.warm })
    expect(NEUTRAL_WEATHER_NOTE).toBe('sin pronóstico: clima templado')
  })
})
