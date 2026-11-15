import type { Garment, Occasion } from '../db/types'
import type { TastePreferences } from './taste'

/** Clima del día. `precipProbability` es un porcentaje 0-100. */
export interface Weather {
  tempC: number
  feelsLikeC?: number
  precipProbability: number
  isRaining: boolean
  tempMinC: number
  tempMaxC: number
}

export interface OutfitSuggestion {
  garmentIds: string[]
  reasoning: string
}

export type OutfitSource = 'ia' | 'reglas'

export interface SuggestedOutfit extends OutfitSuggestion {
  source: OutfitSource
}

export interface WearRecord {
  garmentIds: string[]
  /** YYYY-MM-DD */
  date: string
}

export interface RecentOutfit {
  garmentIds: string[]
  /** YYYY-MM-DD */
  date: string
}

export interface EngineContext {
  occasion: Occasion
  weather: Weather
  garments: Garment[]
  /** Usos reales (últimos ~60 días) para el puntaje de rotación. */
  wears: WearRecord[]
  /** Outfits USADOS (no solo sugeridos) en los últimos 14 días, más los ya mostrados en esta sesión. */
  recentOutfits: RecentOutfit[]
  /** YYYY-MM-DD (fecha local). */
  today: string
  /** Fase 5: preferencias deterministas calculadas de las calificaciones. */
  taste?: TastePreferences
  /** Fase 5: perfil de gusto en texto (solo para el prompt del estilista). */
  tasteSummary?: string
  /** Fase 5: outfits con «me gusta» (hasta 5) como ejemplos del prompt. */
  likedOutfits?: { garmentIds: string[]; reasoning: string }[]
  /** Fase 12: cada outfit sugerido debe incluir al menos una prenda favorita (se ignora si es imposible). */
  requireFavorite?: boolean
}

export type OutfitValidation = { ok: true } | { ok: false; errors: string[] }

export type OuterwearAdvice = 'none' | 'optional' | 'recommended' | 'required'
