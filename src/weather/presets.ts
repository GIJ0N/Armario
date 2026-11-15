import type { Weather } from '../engine/types'

export const WEATHER_PRESET_KEYS = ['hot', 'warm', 'cool', 'cold', 'rain'] as const
export type WeatherPresetKey = (typeof WEATHER_PRESET_KEYS)[number]

export const WEATHER_PRESET_LABELS: Record<WeatherPresetKey, string> = {
  hot: 'Calor',
  warm: 'Templado',
  cool: 'Fresco',
  cold: 'Frío',
  rain: 'Lluvia',
}

/** Clima manual cuando no hay red ni caché. */
export const WEATHER_PRESETS: Record<WeatherPresetKey, Weather> = {
  hot: { tempC: 33, precipProbability: 0, isRaining: false, tempMinC: 27, tempMaxC: 36 },
  warm: { tempC: 22, precipProbability: 0, isRaining: false, tempMinC: 18, tempMaxC: 25 },
  cool: { tempC: 15, precipProbability: 0, isRaining: false, tempMinC: 11, tempMaxC: 18 },
  cold: { tempC: 8, precipProbability: 0, isRaining: false, tempMinC: 4, tempMaxC: 11 },
  rain: { tempC: 19, precipProbability: 90, isRaining: true, tempMinC: 16, tempMaxC: 21 },
}
