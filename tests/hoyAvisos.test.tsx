import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { ToastProvider } from '../src/components/ToastProvider'
import type { Category, Garment, Repository } from '../src/db'
import { fakeRepo } from './fixtures/fakeRepo'

const forecast = {
  current: { temperature_2m: 22, apparent_temperature: 22, precipitation: 0, weather_code: 1 },
  daily: { temperature_2m_max: [26], temperature_2m_min: [17], precipitation_probability_max: [5] },
}
const geo = { results: [{ name: 'Monterrey', latitude: 25.67, longitude: -100.31 }] }

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(new Response(JSON.stringify(String(input).includes('geocoding') ? geo : forecast))),
    ),
  )
})
afterEach(() => vi.unstubAllGlobals())

let n = 0
function mk(id: string, category: Category, subcategory: string, extra: Partial<Garment> = {}): Garment {
  n++
  return {
    id,
    photo_path: null,
    category,
    subcategory,
    colors: ['gris'],
    pattern: 'liso',
    material: 'algodón',
    fit: 'regular',
    formality: 3,
    warmth: 2,
    occasions: ['casual'],
    is_statement: false,
    status: 'active',
    notes: '',
    created_at: new Date(Date.UTC(2026, 0, n)).toISOString(),
    ...extra,
  }
}
const wardrobe = () => [
  mk('t1', 'top', 'Polo'),
  mk('t2', 'top', 'Camisa lino'),
  mk('t3', 'top', 'Playera lavada', { status: 'laundry' }),
  mk('b1', 'bottom', 'Chinos'),
  mk('s1', 'shoes', 'Mocasines'),
  mk('a1', 'accessory', 'Reloj'),
]

function renderApp(repo: Repository, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <RepositoryProvider repository={repo}>
          <App />
        </RepositoryProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
}

async function suggest() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sugerir outfits' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Sugerir outfits' }))
  return (await screen.findAllByTestId('outfit-card'))[0]
}
const chipList = (card: HTMLElement) => within(card).getByRole('list', { name: 'Prendas del outfit' })
const chip = (card: HTMLElement, name: string) => within(chipList(card)).getByRole('button', { name })
const hasChip = (card: HTMLElement, name: string) => !!within(chipList(card)).queryByRole('button', { name })
const topOf = (card: HTMLElement) => ['Polo', 'Camisa lino'].find((t) => hasChip(card, t))!

describe('Hoy: avisos al elegir de «Otras» y chip de ocasión', () => {
  it('elegir una prenda de «Otras» sigue permitido y avisa el motivo', async () => {
    const repo = fakeRepo(wardrobe())
    renderApp(repo)
    const card = await suggest()
    const topName = topOf(card)
    await userEvent.click(chip(card, topName))
    const sheet = await screen.findByRole('dialog', { name: `Cambiar ${topName}` })
    await userEvent.click(within(within(sheet).getByRole('list', { name: 'Otras prendas' })).getAllByTestId('alt-other')[0])
    expect(await screen.findByText('Ojo: en lavandería')).toBeInTheDocument()
    await waitFor(() => expect(hasChip(card, 'Playera lavada')).toBe(true))
  })

  it('elegir una válida no muestra el aviso «Ojo»', async () => {
    const repo = fakeRepo(wardrobe())
    renderApp(repo)
    const card = await suggest()
    await userEvent.click(chip(card, topOf(card)))
    const sheet = await screen.findByRole('dialog')
    await userEvent.click(within(within(sheet).getByRole('list', { name: 'Alternativas válidas' })).getAllByTestId('alt-valid')[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText(/^Ojo:/)).not.toBeInTheDocument()
  })

  it('al elegir una ocasión, su chip se centra en la fila (scrollIntoView)', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    renderApp(fakeRepo(wardrobe()))
    await userEvent.click(await screen.findByRole('button', { name: 'Oficina' }))
    await waitFor(() => expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ inline: 'center' })))
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })
})
