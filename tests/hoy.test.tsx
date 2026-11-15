import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiProviderContextProvider } from '../src/ai/AiProviderContext'
import { MockAiProvider } from '../src/ai/mock'
import App from '../src/App'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import type { Repository } from '../src/db'
import { suggestOutfits } from '../src/engine'
import { localDateString } from '../src/lib/date'
import { fakeRepo } from './fixtures/fakeRepo'
import { MILD, TODAY, wardrobe30 } from './fixtures/wardrobe30'

const forecast = {
  current: { temperature_2m: 22, apparent_temperature: 22, precipitation: 0, weather_code: 1 },
  daily: { temperature_2m_max: [26], temperature_2m_min: [17], precipitation_probability_max: [15] },
}
const geo = { results: [{ name: 'Monterrey', latitude: 25.67, longitude: -100.31 }] }

function stubNetwork(online = true) {
  const f = vi.fn((input: RequestInfo | URL) => {
    if (!online) return Promise.reject(new TypeError('offline'))
    const body = String(input).includes('geocoding') ? geo : forecast
    return Promise.resolve(new Response(JSON.stringify(body)))
  })
  vi.stubGlobal('fetch', f)
  return f
}

function renderHoy(repo: Repository, ai?: MockAiProvider) {
  const app = (
    <RepositoryProvider repository={repo}>
      <App />
    </RepositoryProvider>
  )
  return render(
    <MemoryRouter initialEntries={['/']}>
      {ai ? <AiProviderContextProvider provider={ai}>{app}</AiProviderContextProvider> : app}
    </MemoryRouter>,
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('pantalla Hoy', () => {
  it('muestra el clima y las ocasiones en español', async () => {
    stubNetwork()
    renderHoy(fakeRepo())
    const card = await screen.findByTestId('weather-card')
    await waitFor(() => expect(card).toHaveTextContent('22°'))
    expect(card).toHaveTextContent('Mín 17° · Máx 26°')
    expect(card).toHaveTextContent('Lluvia 15%')
    for (const label of ['Trabajo en planta', 'Oficina', 'Gym', 'Casual', 'Cita', 'Evento formal']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('sin IA sugiere 3 outfits con la insignia "reglas" y los guarda', async () => {
    stubNetwork()
    const repo = fakeRepo()
    renderHoy(repo)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sugerir outfits' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Oficina' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sugerir outfits' }))
    const cards = await screen.findAllByTestId('outfit-card')
    expect(cards).toHaveLength(3)
    for (const c of cards) {
      expect(within(c).getByTestId('source-badge')).toHaveTextContent('reglas')
      expect(within(c).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3)
    }
    expect(repo.saved).toHaveLength(3)
    expect(repo.saved.every((o) => o.source === 'rules' && o.occasion === 'office' && o.weather_snapshot?.tempC === 22)).toBe(true)
  })

  it('"Otras opciones" muestra combinaciones distintas', async () => {
    stubNetwork()
    renderHoy(fakeRepo())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sugerir outfits' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Sugerir outfits' }))
    const names = async () =>
      (await screen.findAllByTestId('outfit-card')).map((c) => c.querySelector('.outfit-reasoning')!.textContent)
    const first = await names()
    await userEvent.click(screen.getByRole('button', { name: 'Otras opciones' }))
    await waitFor(async () => expect(await names()).not.toEqual(first))
    const second = await names()
    for (const r of second) expect(first).not.toContain(r)
  })

  it('con IA usa su respuesta y muestra la insignia "IA"', async () => {
    stubNetwork()
    const base = await suggestOutfits({
      occasion: 'casual', weather: { ...MILD, tempC: 22, tempMinC: 17, tempMaxC: 26, precipProbability: 15 },
      garments: wardrobe30, wears: [], recentOutfits: [], today: TODAY,
    })
    const json = { outfits: base.outfits.map((o) => ({ garment_ids: o.garmentIds, reasoning: `Razón IA ${o.garmentIds[0]}` })) }
    const repo = fakeRepo()
    renderHoy(repo, new MockAiProvider({ json }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sugerir outfits' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Sugerir outfits' }))
    const cards = await screen.findAllByTestId('outfit-card')
    expect(within(cards[0]).getByTestId('source-badge')).toHaveTextContent('IA')
    expect(cards[0]).toHaveTextContent('Razón IA')
    expect(repo.saved.every((o) => o.source === 'ai')).toBe(true)
  })

  it('"Me lo pongo" registra el uso de hoy, muestra "Puesto hoy ✓" y "Deshacer" lo revierte', async () => {
    stubNetwork()
    const repo = fakeRepo()
    renderHoy(repo)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sugerir outfits' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Sugerir outfits' }))
    const cards = await screen.findAllByTestId('outfit-card')
    expect(within(cards[0]).queryByText('Puesto hoy ✓')).not.toBeInTheDocument()
    await userEvent.click(within(cards[0]).getByRole('button', { name: 'Me lo pongo' }))
    expect(await within(cards[0]).findByText('Puesto hoy ✓')).toBeInTheDocument()
    expect(repo.savedWears).toHaveLength(1)
    expect(repo.savedWears[0]).toMatchObject({ outfit_id: repo.saved[0].id, date: localDateString() })
    // Las otras tarjetas siguen ofreciendo "Me lo pongo".
    expect(within(cards[1]).getByRole('button', { name: 'Me lo pongo' })).toBeInTheDocument()
    await userEvent.click(within(cards[0]).getByRole('button', { name: 'Deshacer' }))
    expect(await within(cards[0]).findByRole('button', { name: 'Me lo pongo' })).toBeInTheDocument()
    expect(repo.savedWears).toHaveLength(0)
  })

  it('el motor recibe solo lo USADO: lo meramente sugerido no cuenta como reciente', async () => {
    stubNetwork()
    const repo = fakeRepo()
    renderHoy(repo)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sugerir outfits' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Sugerir outfits' }))
    const reasons = async () =>
      (await screen.findAllByTestId('outfit-card')).map((c) => c.querySelector('.outfit-reasoning')!.textContent)
    const first = await reasons()
    // Se pidió de nuevo sin "Otras opciones": al no haberse usado nada, salen las mismas sugerencias.
    await userEvent.click(screen.getByRole('button', { name: 'Sugerir outfits' }))
    await waitFor(() => expect(repo.saved).toHaveLength(6))
    expect(await reasons()).toEqual(first)
    // Una vez usado, ese outfit no vuelve a salir.
    const used = repo.saved[3]
    await userEvent.click(within((await screen.findAllByTestId('outfit-card'))[0]).getByRole('button', { name: 'Me lo pongo' }))
    await waitFor(() => expect(repo.savedWears).toHaveLength(1))
    await userEvent.click(screen.getByRole('button', { name: 'Sugerir outfits' }))
    await waitFor(() => expect(repo.saved).toHaveLength(9))
    const usedKey = [...used.garment_ids].filter((id) => !id.startsWith('acc-')).sort().join()
    for (const o of repo.saved.slice(6)) {
      expect(o.garment_ids.filter((id) => !id.startsWith('acc-')).sort().join()).not.toBe(usedKey)
    }
  })

  it('sin red ni caché ofrece climas manuales', async () => {
    stubNetwork(false)
    renderHoy(fakeRepo())
    expect(await screen.findByText(/No se pudo obtener el clima/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sugerir outfits' })).toBeDisabled()
    for (const label of ['Calor', 'Templado', 'Fresco', 'Frío', 'Lluvia']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    await userEvent.click(screen.getByRole('button', { name: 'Frío' }))
    expect(screen.getByTestId('weather-card')).toHaveTextContent('Clima manual: Frío')
    await userEvent.click(screen.getByRole('button', { name: 'Sugerir outfits' }))
    const cards = await screen.findAllByTestId('outfit-card')
    expect(cards).toHaveLength(3)
  })

  it('explica qué falta cuando no se puede armar ningún outfit', async () => {
    stubNetwork()
    renderHoy(fakeRepo([]))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sugerir outfits' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Oficina' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sugerir outfits' }))
    expect(await screen.findByText('No tienes calzado apto para oficina.')).toBeInTheDocument()
    expect(screen.queryByTestId('outfit-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Otras opciones' })).not.toBeInTheDocument()
  })
})
