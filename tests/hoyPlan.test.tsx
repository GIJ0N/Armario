import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { suggestOutfits } from '../src/engine'
import { addDays, localDateString } from '../src/lib/date'
import { COMBOS, makeOutfit, renderApp, stubNetwork } from './fixtures/calendarHelpers'
import { fakeRepo } from './fixtures/fakeRepo'
import { MILD, wardrobe30 } from './fixtures/wardrobe30'

beforeEach(() => {
  localStorage.clear()
  stubNetwork()
})
afterEach(() => vi.unstubAllGlobals())

const today = () => localDateString()

describe('Hoy: planeado para hoy', () => {
  it('muestra la tarjeta compacta arriba de «Sugerir outfits» con «Me lo pongo» y «Cambiar»', async () => {
    const repo = fakeRepo()
    const o = await makeOutfit(repo, COMBOS.b, { saved: 'Look de oficina', occasion: 'office' })
    await repo.plans.create(o.id, today(), 'office')
    renderApp(repo, '/')
    const card = await screen.findByTestId('planned-today')
    expect(within(card).getByRole('heading', { name: 'Planeado para hoy' })).toBeInTheDocument()
    expect(card).toHaveTextContent('Look de oficina')
    expect(card.querySelector('.mannequin')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Me lo pongo' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Cambiar' })).toBeInTheDocument()
    const suggest = screen.getByRole('button', { name: 'Sugerir outfits' })
    expect(card.compareDocumentPosition(suggest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('sin plan para hoy no hay tarjeta; un plan de otro día tampoco cuenta', async () => {
    const repo = fakeRepo()
    const o = await makeOutfit(repo, COMBOS.b)
    await repo.plans.create(o.id, addDays(today(), 1))
    renderApp(repo, '/')
    await screen.findByRole('button', { name: 'Sugerir outfits' })
    await waitFor(() => expect(screen.getByTestId('weather-card')).toHaveTextContent('22°'))
    expect(screen.queryByTestId('planned-today')).not.toBeInTheDocument()
  })

  it('«Me lo pongo» convierte el plan en uso de hoy; «Deshacer» lo vuelve a planear', async () => {
    const user = userEvent.setup()
    const repo = fakeRepo()
    const o = await makeOutfit(repo, COMBOS.b, { saved: 'Look de oficina' })
    await repo.plans.create(o.id, today(), 'office')
    renderApp(repo, '/')
    const card = await screen.findByTestId('planned-today')
    await user.click(within(card).getByRole('button', { name: 'Me lo pongo' }))
    expect(await within(card).findByTestId('planned-worn')).toHaveTextContent('Puesto hoy')
    expect(repo.planRows).toHaveLength(0)
    expect(repo.savedWears).toMatchObject([{ outfit_id: o.id, date: today() }])
    expect(await screen.findByText('Outfit marcado como usado')).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Deshacer' }))
    expect(await within(card).findByRole('button', { name: 'Me lo pongo' })).toBeInTheDocument()
    expect(repo.savedWears).toHaveLength(0)
    expect(repo.planRows).toMatchObject([{ outfitId: o.id, date: today(), occasion: 'office' }])
  })

  it('«Cambiar» abre el editor; con historia crea una fila nueva y el plan pasa a ella', async () => {
    const user = userEvent.setup()
    const repo = fakeRepo()
    const o = await makeOutfit(repo, COMBOS.b, { saved: 'Look de oficina', occasion: 'office' })
    await repo.wears.create(o.id, addDays(today(), -3))
    await repo.plans.create(o.id, today(), 'office')
    renderApp(repo, '/')
    const card = await screen.findByTestId('planned-today')
    await user.click(within(card).getByRole('button', { name: 'Cambiar' }))
    const editor = await screen.findByRole('dialog', { name: 'Cambiar outfit' })
    await user.click(within(editor).getByRole('button', { name: 'Cambiar camisa oxford' }))
    const picker = await screen.findByRole('dialog', { name: 'Cambiar camisa oxford' })
    await user.click(within(picker).getAllByTestId('alt-valid')[0])
    await user.click(await within(await screen.findByRole('dialog', { name: 'Cambiar outfit' })).findByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Outfit actualizado')).toBeInTheDocument()
    expect(repo.planRows).toHaveLength(1)
    expect(repo.planRows[0].outfitId).not.toBe(o.id)
    expect(repo.saved.find((x) => x.id === repo.planRows[0].outfitId)?.garment_ids).not.toContain('top-oxford-azul')
    expect(repo.savedWears[0].outfit_id).toBe(o.id)
    await waitFor(() => expect(screen.getByTestId('planned-today')).toBeInTheDocument())
  })

  it('el encabezado tiene un botón de calendario que abre /calendario', async () => {
    const user = userEvent.setup()
    renderApp(fakeRepo(), '/')
    await user.click(await screen.findByRole('link', { name: 'Calendario' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Calendario' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Hoy' })).toHaveClass('active')
  })
})

describe('Hoy: el motor ve lo planeado', () => {
  it('las sugerencias de hoy no repiten una combinación planeada para mañana', async () => {
    const user = userEvent.setup()
    // Lo que Hoy sugeriría primero (casual, 22°, sin historial).
    const base = await suggestOutfits({ occasion: 'casual', weather: MILD, garments: wardrobe30, wears: [], recentOutfits: [], today: today() })
    const core = (ids: string[]) => ids.filter((id) => !id.startsWith('acc-')).sort().join('|')
    const repo = fakeRepo()
    for (const o of base.outfits) {
      const planned = await makeOutfit(repo, o.garmentIds)
      await repo.plans.create(planned.id, addDays(today(), 1))
    }
    renderApp(repo, '/')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sugerir outfits' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Sugerir outfits' }))
    const cards = await screen.findAllByTestId('outfit-card')
    const shown = cards.map((c) => core([...c.querySelectorAll<HTMLElement>('.canvas-garment')].map((b) => b.getAttribute('data-garment-id')!)))
    for (const o of base.outfits) expect(shown).not.toContain(core(o.garmentIds))
  })
})
