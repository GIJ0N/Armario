import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { ToastProvider } from '../src/components/ToastProvider'
import type { Category, Garment, Repository } from '../src/db'
import { localDateString } from '../src/lib/date'
import { loadSettings } from '../src/settings'
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

describe('Hoy: editar un outfit', () => {
  it('tocar una prenda abre «Cambiar …» con válidas primero y «Otras» con motivo; elegir cambia el lienzo y guarda', async () => {
    const repo = fakeRepo(wardrobe())
    renderApp(repo)
    const card = await suggest()
    const topName = topOf(card)
    const otherTop = topName === 'Polo' ? 'Camisa lino' : 'Polo'
    await userEvent.click(chip(card, topName))

    const sheet = await screen.findByRole('dialog', { name: `Cambiar ${topName}` })
    const valid = within(within(sheet).getByRole('list', { name: 'Alternativas válidas' })).getAllByTestId('alt-valid')
    expect(valid).toHaveLength(1)
    expect(valid[0]).toHaveTextContent(otherTop)
    const others = within(within(sheet).getByRole('list', { name: 'Otras prendas' })).getAllByTestId('alt-other')
    expect(others).toHaveLength(1)
    expect(others[0]).toHaveTextContent('Playera lavada')
    expect(within(others[0]).getByTestId('alt-reason')).toHaveTextContent('en lavandería')
    // Un top no se puede quitar.
    expect(within(sheet).queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument()

    const id = repo.saved[0].id
    await userEvent.click(valid[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(chip(card, otherTop)).toBeInTheDocument())
    expect(within(card).getByTestId('source-badge')).toHaveTextContent('manual')
    // Sin calificación ni uso: se actualizó en su lugar.
    const row = repo.saved.find((o) => o.id === id)!
    expect(row.source).toBe('manual')
    expect(row.garment_ids).toContain(otherTop === 'Polo' ? 't1' : 't2')
    expect((await repo.swaps.list(10)).map((s) => [s.fromGarmentId, s.toGarmentId])).toEqual([
      topName === 'Polo' ? ['t1', 't2'] : ['t2', 't1'],
    ])
  })

  it('con el outfit ya usado, el cambio crea una fila nueva y el uso de hoy pasa a ella', async () => {
    const repo = fakeRepo(wardrobe())
    renderApp(repo)
    const card = await suggest()
    await userEvent.click(within(card).getByRole('button', { name: 'Me lo pongo' }))
    await within(card).findByText('Puesto hoy')
    const before = repo.saved.length
    const originalId = repo.saved[0].id
    const topName = topOf(card)
    await userEvent.click(chip(card, topName))
    const sheet = await screen.findByRole('dialog')
    await userEvent.click(within(within(sheet).getByRole('list', { name: 'Alternativas válidas' })).getAllByTestId('alt-valid')[0])
    await waitFor(() => expect(repo.saved.length).toBe(before + 1))
    const created = repo.saved[repo.saved.length - 1]
    expect(created.source).toBe('manual')
    expect(repo.saved.find((o) => o.id === originalId)!.source).not.toBe('manual')
    await waitFor(() => expect(repo.savedWears.map((w) => w.outfit_id)).toEqual([created.id]))
    expect(await screen.findAllByText('Puesto hoy')).toHaveLength(1)
  })

  it('«Quitar» existe para un accesorio y «Añadir pieza» ofrece capa o accesorio', async () => {
    const repo = fakeRepo(wardrobe())
    renderApp(repo)
    const card = await suggest()
    const add = async () => {
      await userEvent.click(within(card).getByRole('button', { name: /Añadir pieza/ }))
      const addSheet = await screen.findByRole('dialog', { name: 'Añadir pieza' })
      expect(within(addSheet).getByRole('button', { name: /Capa exterior/ })).toBeInTheDocument()
      await userEvent.click(within(addSheet).getByRole('button', { name: /Accesorio/ }))
      const pick = await screen.findByRole('dialog', { name: 'Añadir accesorio' })
      await userEvent.click(within(pick).getByTestId('alt-valid'))
      await waitFor(() => expect(hasChip(card, 'Reloj')).toBe(true))
    }
    const remove = async () => {
      await userEvent.click(chip(card, 'Reloj'))
      const sheet = await screen.findByRole('dialog', { name: 'Cambiar Reloj' })
      await userEvent.click(within(sheet).getByRole('button', { name: 'Quitar' }))
      await waitFor(() => expect(hasChip(card, 'Reloj')).toBe(false))
    }
    // El compositor por reglas puede haber puesto ya el reloj.
    if (!hasChip(card, 'Reloj')) await add()
    await remove()
    expect(repo.saved[0].garment_ids).not.toContain('a1')
    await add()
    expect(repo.saved[0].garment_ids).toContain('a1')
    expect(repo.saved[0].source).toBe('manual')
  })

  it('«Barajar» cambia por una alternativa válida', async () => {
    const repo = fakeRepo(wardrobe())
    renderApp(repo)
    const card = await suggest()
    const topName = topOf(card)
    await userEvent.click(chip(card, topName))
    const sheet = await screen.findByRole('dialog')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Barajar' }))
    const other = topName === 'Polo' ? 'Camisa lino' : 'Polo'
    await waitFor(() => expect(chip(card, other)).toBeInTheDocument())
    expect(hasChip(card, 'Playera lavada')).toBe(false)
  })
})

describe('Hoy: guardar un outfit y lavandería', () => {
  it('«Guardar outfit» pide nombre opcional, queda guardado y se puede quitar', async () => {
    const repo = fakeRepo(wardrobe())
    renderApp(repo)
    const card = await suggest()
    await userEvent.click(within(card).getByRole('button', { name: 'Guardar outfit' }))
    const sheet = await screen.findByRole('dialog', { name: 'Guardar outfit' })
    await userEvent.type(within(sheet).getByLabelText('Nombre (opcional)'), 'Sábado tranquilo')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(repo.saved[0].saved_at).toBeTruthy())
    expect(repo.saved[0].name).toBe('Sábado tranquilo')
    const bookmark = await within(card).findByRole('button', { name: 'Quitar de guardados' })
    await userEvent.click(bookmark)
    await waitFor(() => expect(repo.saved[0].saved_at).toBeNull())
  })

  it('tras «Me lo pongo»: «Mandar a lavandería» con la prenda de arriba marcada', async () => {
    const repo = fakeRepo(wardrobe())
    renderApp(repo)
    const card = await suggest()
    expect(within(card).queryByRole('button', { name: 'Mandar a lavandería' })).not.toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Me lo pongo' }))
    await userEvent.click(await within(card).findByRole('button', { name: 'Mandar a lavandería' }))
    const sheet = await screen.findByRole('dialog', { name: 'Mandar a lavandería' })
    const boxes = within(sheet).getAllByRole('checkbox')
    expect(boxes.length).toBeGreaterThanOrEqual(3)
    const checked = boxes.filter((b) => (b as HTMLInputElement).checked)
    expect(checked).toHaveLength(1)
    expect(checked[0].closest('label')).toHaveTextContent(/Polo|Camisa lino/)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Mandar a lavandería' }))
    await waitFor(() => expect(repo.garments.filter((g) => g.status === 'laundry').map((g) => g.id)).toContain(
      checked[0].closest('label')!.textContent!.startsWith('Polo') ? 't1' : 't2',
    ))
    expect(repo.garments.filter((g) => g.status === 'laundry')).toHaveLength(2)
  })
})

describe('Hoy: «Con una favorita»', () => {
  it('el interruptor se guarda en los ajustes y cada outfit sugerido incluye una favorita', async () => {
    const garments = wardrobe().map((g) => (g.id === 't2' ? { ...g, favorite: true } : g))
    renderApp(fakeRepo(garments))
    const toggle = await screen.findByRole('button', { name: 'Con una favorita' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(loadSettings().requireFavorite).toBe(true)
    const card = await suggest()
    expect(chip(card, 'Camisa lino')).toBeInTheDocument()
  })

  it('imposible: avisa y sigue sugiriendo', async () => {
    renderApp(fakeRepo(wardrobe()))
    await userEvent.click(await screen.findByRole('button', { name: 'Con una favorita' }))
    await suggest()
    expect(await screen.findByText(/se ignoró «Con una favorita»/)).toBeInTheDocument()
  })
})

describe('Armario: favoritas, outfits guardados y lavandería', () => {
  it('corazón en la tarjeta y filtro «Favoritas»', async () => {
    const repo = fakeRepo(wardrobe())
    renderApp(repo, '/armario')
    const card = (await screen.findByText('Polo')).closest('li')!
    await userEvent.click(within(card).getByRole('button', { name: 'Marcar Polo como favorita' }))
    await waitFor(() => expect(repo.garments.find((g) => g.id === 't1')!.favorite).toBe(true))
    expect(await within(card).findByRole('button', { name: 'Quitar Polo de favoritas' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('count')).toHaveTextContent('6 prendas')
    await userEvent.click(screen.getByRole('button', { name: 'Favoritas' }))
    expect(screen.getByTestId('count')).toHaveTextContent('1 prenda')
    expect(screen.queryByText('Camisa lino')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Favoritas' }))
    expect(screen.getByTestId('count')).toHaveTextContent('6 prendas')
  })

  it('una prenda en lavandería muestra la insignia y «Ya está limpia» la reactiva', async () => {
    const repo = fakeRepo(wardrobe())
    renderApp(repo, '/armario')
    const card = (await screen.findByText('Playera lavada')).closest('li')!
    expect(within(card).getByText('Lavandería')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Ya está limpia' }))
    await waitFor(() => expect(repo.garments.find((g) => g.id === 't3')!.status).toBe('active'))
  })

  it('el corazón del detalle de la prenda cambia la favorita', async () => {
    const repo = fakeRepo(wardrobe())
    renderApp(repo, '/armario/t1')
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar como favorita' }))
    await waitFor(() => expect(repo.garments.find((g) => g.id === 't1')!.favorite).toBe(true))
    expect(await screen.findByRole('button', { name: 'Quitar de favoritas' })).toBeInTheDocument()
  })

  async function saved(repo: ReturnType<typeof fakeRepo>, ids: string[], name: string) {
    const o = await repo.outfits.create({ garment_ids: ids, occasion: 'casual', weather_snapshot: null, reasoning: 'r', source: 'rules' })
    await repo.outfits.save(o.id, name)
    return o
  }

  it('segmento «Outfits»: lista los guardados con nombre y último uso; Usar hoy, Quitar de guardados', async () => {
    const repo = fakeRepo(wardrobe())
    const a = await saved(repo, ['t1', 'b1', 's1'], 'Sábado')
    await saved(repo, ['t2', 'b1', 's1', 'a1'], 'Cena')
    await repo.wears.create(a.id, '2026-11-10')
    renderApp(repo, '/armario')
    await userEvent.click(await screen.findByRole('tab', { name: 'Outfits' }))
    const cards = await screen.findAllByTestId('saved-outfit')
    expect(cards).toHaveLength(2)
    expect(cards.map((c) => within(c).getByTestId('saved-name').textContent).sort()).toEqual(['Cena', 'Sábado'])
    const sabado = cards.find((c) => within(c).getByTestId('saved-name').textContent === 'Sábado')!
    expect(within(sabado).getByTestId('saved-last-worn')).toHaveTextContent('Último uso: 10 nov')
    const cena = cards.find((c) => within(c).getByTestId('saved-name').textContent === 'Cena')!
    expect(within(cena).getByTestId('saved-last-worn')).toHaveTextContent('Aún sin usar')
    expect(cena.querySelector('.outfit-canvas[data-size="small"]')).toBeInTheDocument()

    // Usar hoy: siempre permitido, aunque se haya usado hace poco.
    await userEvent.click(within(sabado).getByRole('button', { name: 'Usar hoy' }))
    await waitFor(() => expect(repo.savedWears.some((w) => w.outfit_id === a.id && w.date === localDateString())).toBe(true))
    expect(await screen.findByRole('button', { name: 'Mandar a lavandería' })).toBeInTheDocument()

    await userEvent.click(within(await screen.findByText('Cena').then((e) => e.closest('li')!)).getByRole('button', { name: 'Quitar de guardados' }))
    await waitFor(() => expect(screen.getAllByTestId('saved-outfit')).toHaveLength(1))
    expect((await repo.outfits.listSaved()).map((s) => s.outfit.name)).toEqual(['Sábado'])
  })

  it('el aviso de «Usar hoy» ofrece mandar a lavandería', async () => {
    const repo = fakeRepo(wardrobe())
    await saved(repo, ['t1', 'b1', 's1'], 'Sábado')
    renderApp(repo, '/armario')
    await userEvent.click(await screen.findByRole('tab', { name: 'Outfits' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Usar hoy' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mandar a lavandería' }))
    const sheet = await screen.findByRole('dialog', { name: 'Mandar a lavandería' })
    expect(within(sheet).getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked)).toHaveLength(1)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Mandar a lavandería' }))
    await waitFor(() => expect(repo.garments.find((g) => g.id === 't1')!.status).toBe('laundry'))
  })

  it('«Editar» un guardado con uso crea una fila nueva y conserva el nombre', async () => {
    const repo = fakeRepo(wardrobe())
    const a = await saved(repo, ['t1', 'b1', 's1'], 'Sábado')
    await repo.wears.create(a.id, '2026-11-10')
    renderApp(repo, '/armario')
    await userEvent.click(await screen.findByRole('tab', { name: 'Outfits' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    const sheet = await screen.findByRole('dialog', { name: 'Editar outfit' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cambiar Polo' }))
    const pick = await screen.findByRole('dialog', { name: 'Cambiar Polo' })
    await userEvent.click(within(pick).getByText('Camisa lino'))
    await userEvent.click(await screen.findByRole('button', { name: 'Guardar cambios' }))
    await waitFor(async () => {
      const list = await repo.outfits.listSaved()
      expect(list).toHaveLength(1)
      expect(list[0].outfit.id).not.toBe(a.id)
      expect(list[0].outfit.garment_ids).toContain('t2')
      expect(list[0].outfit.name).toBe('Sábado')
    })
    expect(repo.saved.find((o) => o.id === a.id)!.garment_ids).toEqual(['t1', 'b1', 's1'])
  })

  it('«Crear outfit»: exige arriba, abajo y calzado, elige piezas, guarda como manual y aparece en Outfits', async () => {
    const repo = fakeRepo(wardrobe())
    renderApp(repo, '/armario')
    await userEvent.click(await screen.findByRole('button', { name: 'Crear outfit' }))
    const sheet = await screen.findByRole('dialog', { name: 'Crear outfit' })
    const save = within(sheet).getByRole('button', { name: 'Guardar outfit' })
    expect(save).toBeDisabled()

    for (const [slot, pickName] of [['superior', 'Polo'], ['inferior', 'Chinos'], ['calzado', 'Mocasines']] as const) {
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: `Elegir ${slot}` }))
      const pick = await screen.findByRole('dialog', { name: `Elegir ${slot}` })
      await userEvent.click(within(pick).getByText(pickName))
    }
    const editor = await screen.findByRole('dialog', { name: 'Crear outfit' })
    expect(within(editor).getByRole('button', { name: 'Guardar outfit' })).toBeEnabled()
    await userEvent.type(within(editor).getByLabelText('Nombre (opcional)'), 'Mi primero')
    await userEvent.click(within(editor).getByRole('button', { name: 'Guardar outfit' }))

    expect(await screen.findByTestId('saved-name')).toHaveTextContent('Mi primero')
    expect(repo.saved).toHaveLength(1)
    expect(repo.saved[0]).toMatchObject({ source: 'manual', garment_ids: ['t1', 'b1', 's1'], name: 'Mi primero' })
    expect(repo.saved[0].saved_at).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Usar hoy' })).toBeInTheDocument()
  })
})
