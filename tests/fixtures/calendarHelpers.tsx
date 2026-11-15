import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AiProviderContextProvider } from '../../src/ai/AiProviderContext'
import type { MockAiProvider } from '../../src/ai/mock'
import type { AiProvider } from '../../src/ai/provider'
import App from '../../src/App'
import { RepositoryProvider } from '../../src/components/RepositoryContext'
import type { Outfit, Repository } from '../../src/db'
import { addDays } from '../../src/lib/date'

/** «Hoy» fijo de las pruebas del calendario: miércoles 18 de noviembre de 2026 (hora local). */
export const TODAY = '2026-11-18'

/** Fija solo `Date` (los temporizadores siguen reales para que userEvent y los toasts funcionen). */
export function freezeToday() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 18, 12, 0, 0))
}

const geo = { results: [{ name: 'Monterrey', latitude: 25.67, longitude: -100.31 }] }

/** Pronóstico de 7 días a partir de TODAY (hoy + 6): temperaturas suaves, lluvia el sábado 21. */
export function dailyBody(from = TODAY) {
  const time = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  return {
    daily: {
      time,
      temperature_2m_max: [27, 28, 26, 30, 31, 29, 28],
      temperature_2m_min: [17, 18, 16, 19, 20, 18, 17],
      precipitation_probability_max: [5, 10, 20, 60, 5, 0, 0],
    },
  }
}

const currentBody = {
  current: { temperature_2m: 22, apparent_temperature: 22, precipitation: 0, weather_code: 1 },
  daily: { temperature_2m_max: [26], temperature_2m_min: [17], precipitation_probability_max: [15] },
}

/** Red simulada: geocodificación, clima de hoy y pronóstico de 7 días. Con `online = false` todo falla. */
export function stubNetwork(online = true) {
  const f = vi.fn((input: RequestInfo | URL) => {
    if (!online) return Promise.reject(new TypeError('offline'))
    const url = String(input)
    const body = url.includes('geocoding') ? geo : url.includes('forecast_days=7') ? dailyBody() : currentBody
    return Promise.resolve(new Response(JSON.stringify(body)))
  })
  vi.stubGlobal('fetch', f)
  return f
}

export function renderApp(repo: Repository, path: string, ai?: AiProvider | MockAiProvider) {
  const app = (
    <RepositoryProvider repository={repo}>
      <App />
    </RepositoryProvider>
  )
  return render(
    <MemoryRouter initialEntries={[path]}>{ai ? <AiProviderContextProvider provider={ai}>{app}</AiProviderContextProvider> : app}</MemoryRouter>,
  )
}

type Maker = Pick<Repository, 'outfits' | 'wears' | 'plans'>

/** Crea un outfit con prendas del armario de prueba. */
export async function makeOutfit(
  repo: Maker,
  garmentIds: string[],
  extra: Partial<Pick<Outfit, 'occasion' | 'reasoning'>> & { saved?: string | true } = {},
): Promise<Outfit> {
  const o = await repo.outfits.create({
    garment_ids: garmentIds,
    occasion: extra.occasion ?? 'casual',
    weather_snapshot: null,
    reasoning: extra.reasoning ?? 'Razón de prueba.',
    source: 'rules',
  })
  if (extra.saved) await repo.outfits.save(o.id, extra.saved === true ? undefined : extra.saved)
  return o
}

/** Tres combinaciones válidas y distintas del armario de 30 prendas (casual, clima templado). */
export const COMBOS = {
  a: ['top-playera-blanca', 'bot-jeans-azul', 'sho-tenis-blancos'],
  b: ['top-oxford-azul', 'bot-chinos-beige', 'sho-mocasines'],
  c: ['top-polo-marino', 'bot-jeans-negros', 'sho-mocasines'],
}
