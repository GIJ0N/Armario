import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMBOS, freezeToday, makeOutfit, renderApp, stubNetwork } from './fixtures/calendarHelpers'
import { fakeRepo } from './fixtures/fakeRepo'

beforeEach(() => {
  localStorage.clear()
  stubNetwork()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Uso: días con outfit registrado', () => {
  it('cuenta los días distintos del mes en curso hasta hoy (no los de otros meses ni los planes)', async () => {
    freezeToday() // miércoles 18 de noviembre de 2026
    const repo = fakeRepo()
    const a = await makeOutfit(repo, COMBOS.a)
    const b = await makeOutfit(repo, COMBOS.b)
    await repo.wears.create(a.id, '2026-11-02')
    await repo.wears.create(a.id, '2026-11-17')
    await repo.wears.create(b.id, '2026-11-17') // el mismo día cuenta una vez
    await repo.wears.create(b.id, '2026-11-18')
    await repo.wears.create(b.id, '2026-10-31') // mes anterior: no cuenta
    await repo.plans.create(a.id, '2026-11-20') // plan: no cuenta
    renderApp(repo, '/uso')
    expect(await screen.findByTestId('month-days')).toHaveTextContent('Días con outfit registrado este mes: 3 de 18')
  })

  it('el primer día del mes empieza en 0 de 1 aunque haya usos del mes anterior', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 11, 1, 9, 0, 0))
    const repo = fakeRepo()
    const a = await makeOutfit(repo, COMBOS.a)
    await repo.wears.create(a.id, '2026-11-30')
    renderApp(repo, '/uso')
    expect(await screen.findByTestId('month-days')).toHaveTextContent('Días con outfit registrado este mes: 0 de 1')
  })

  it('el historial enlaza con «Ver calendario»', async () => {
    freezeToday()
    const user = userEvent.setup()
    renderApp(fakeRepo(), '/uso')
    await screen.findByTestId('month-days')
    await user.click(screen.getByRole('link', { name: 'Ver calendario' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Calendario' })).toBeInTheDocument()
  })
})

describe('Yo', () => {
  it('tiene una fila «Calendario» antes de Uso', async () => {
    renderApp(fakeRepo(), '/yo')
    const list = await screen.findByRole('list')
    const links = within(list).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/calendario', '/uso', '/ajustes'])
  })
})
