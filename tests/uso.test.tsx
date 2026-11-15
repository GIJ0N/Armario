import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import type { Garment } from '../src/db'
import UsoPage from '../src/pages/Uso'
import { addDays, localDateString } from '../src/lib/date'
import { fakeRepo } from './fixtures/fakeRepo'
import { wardrobe30 } from './fixtures/wardrobe30'

const today = localDateString()
const ago = (n: number) => addDays(today, -n)

function renderUso(repo = fakeRepo()) {
  render(
    <MemoryRouter>
      <RepositoryProvider repository={repo}>
        <UsoPage />
      </RepositoryProvider>
    </MemoryRouter>,
  )
  return repo
}

async function wear(repo: ReturnType<typeof fakeRepo>, ids: string[], date: string, occasion: 'office' | 'gym' = 'office', reasoning = 'Razón') {
  const o = await repo.outfits.create({ garment_ids: ids, occasion, weather_snapshot: null, reasoning, source: 'rules' })
  await repo.wears.create(o.id, date)
}

describe('pantalla Uso', () => {
  it('sin usos: 0% y estados vacíos en español', async () => {
    renderUso()
    expect(await screen.findByTestId('usage-percent')).toHaveTextContent('0%')
    expect(screen.getByTestId('usage-count')).toHaveTextContent('0 de 30 prendas activas')
    expect(screen.getByText(/Todavía no has usado ningún outfit/)).toBeInTheDocument()
    expect(screen.getByText(/aquí verás tus prendas favoritas/)).toBeInTheDocument()
    // Menos usadas: todas nunca usadas, la más antigua primero.
    const rows = within(screen.getByRole('list', { name: 'Menos usadas' })).getAllByRole('listitem')
    expect(rows).toHaveLength(10)
    expect(rows[0]).toHaveTextContent('playera')
    expect(rows[0]).toHaveTextContent('Nunca usada')
  })

  it('sin prendas activas muestra un aviso en lugar del porcentaje', async () => {
    renderUso(fakeRepo([]))
    expect(await screen.findByText(/Aún no tienes prendas activas/)).toBeInTheDocument()
    expect(screen.queryByTestId('usage-percent')).not.toBeInTheDocument()
  })

  it('calcula el %, ordena menos/más usadas y agrupa el historial por fecha', async () => {
    const repo = fakeRepo()
    const A = ['top-polo-marino', 'bot-chinos-beige', 'sho-mocasines']
    const B = ['top-oxford-azul', 'bot-chinos-beige', 'sho-mocasines']
    await wear(repo, A, ago(10), 'office', 'Razón vieja')
    await wear(repo, B, ago(1), 'office', 'Razón de ayer')
    await wear(repo, ['top-sudadera-gris', 'bot-joggers', 'sho-tenis-correr'], ago(1), 'gym', 'Razón gym')
    await wear(repo, A, today, 'office', 'Razón de hoy')
    renderUso(repo)

    // Usadas en 30 días: polo, chinos, mocasines, oxford azul, sudadera, joggers, tenis correr = 7 de 30.
    expect(await screen.findByTestId('usage-percent')).toHaveTextContent('23%')
    expect(screen.getByTestId('usage-count')).toHaveTextContent('7 de 30 prendas activas')

    const most = within(screen.getByRole('list', { name: 'Más usadas' })).getAllByRole('listitem')
    expect(most).toHaveLength(5)
    // chinos y mocasines: 3 usos cada uno (empate: el id menor primero); polo: 2.
    expect(most[0]).toHaveTextContent('chinos')
    expect(most[0]).toHaveTextContent('3 usos')
    expect(most[2]).toHaveTextContent('polo')
    expect(most[2]).toHaveTextContent('2 usos')

    const least = within(screen.getByRole('list', { name: 'Menos usadas' })).getAllByRole('listitem')
    expect(least[0]).toHaveTextContent('Nunca usada')
    expect(within(screen.getByRole('list', { name: 'Menos usadas' })).queryByText('Usada hoy')).not.toBeInTheDocument()

    const history = screen.getByTestId('history')
    const days = within(history).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(days[0]).toBe('Hoy')
    expect(days[1]).toBe('Ayer')
    expect(days).toHaveLength(3)
    const entries = within(history).getAllByTestId('history-entry')
    expect(entries).toHaveLength(4)
    expect(entries[0]).toHaveTextContent('Oficina')
    expect(entries[0]).toHaveTextContent('Razón de hoy')
    expect(history).toHaveTextContent('Gym')
  })

  it('"días sin usar" usa el último uso de cada prenda; las no activas no aparecen', async () => {
    const garments: Garment[] = wardrobe30.slice(0, 3).map((g, i) => ({ ...g, status: i === 2 ? 'laundry' : 'active' }))
    const repo = fakeRepo(garments)
    await wear(repo, [garments[0].id], ago(5))
    await wear(repo, [garments[1].id], ago(1))
    renderUso(repo)
    await screen.findByTestId('usage-percent')
    const least = within(screen.getByRole('list', { name: 'Menos usadas' })).getAllByRole('listitem')
    expect(least).toHaveLength(2)
    expect(least[0]).toHaveTextContent('5 días sin usar')
    expect(least[1]).toHaveTextContent('1 día sin usar')
  })
})
