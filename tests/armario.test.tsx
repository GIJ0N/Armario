import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import {
  garmentInputSchema,
  type Garment,
  type GarmentFilter,
  type GarmentInput,
} from '../src/db'
import type { GarmentRepository } from '../src/db'
import App from '../src/App'

function createFakeRepo(): GarmentRepository & { items: Garment[] } {
  const items: Garment[] = []
  let n = 0
  const byFilter = (f: GarmentFilter = {}) =>
    items.filter(
      (g) => (!f.category || g.category === f.category) && (!f.statuses || f.statuses.includes(g.status)),
    )
  return {
    items,
    list: async (f) => byFilter(f),
    get: async (id) => items.find((g) => g.id === id) ?? null,
    create: async (input: GarmentInput) => {
      const g = { ...garmentInputSchema.parse(input), id: `g${++n}`, created_at: new Date().toISOString() }
      items.push(g)
      return g
    },
    update: async (id, input) => {
      const i = items.findIndex((g) => g.id === id)
      items[i] = { ...items[i], ...garmentInputSchema.parse(input) }
      return items[i]
    },
    setStatus: async (id, status) => {
      const g = items.find((x) => x.id === id)!
      g.status = status
      return g
    },
    delete: async (id) => {
      items.splice(items.findIndex((g) => g.id === id), 1)
    },
    savePhoto: async () => 'photo:1',
    getPhoto: async () => null,
    deletePhoto: async () => {},
    close: () => {},
  }
}

let repo: ReturnType<typeof createFakeRepo>

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RepositoryProvider repository={repo}>
        <App />
      </RepositoryProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  repo = createFakeRepo()
})

describe('Agregar y Armario', () => {
  it('exige los campos obligatorios', async () => {
    renderApp('/agregar')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Elige una categoría')
    expect(repo.items).toHaveLength(0)
  })

  it('guarda una prenda y la lista en Armario', async () => {
    renderApp('/agregar')
    await userEvent.selectOptions(screen.getByLabelText('Categoría *'), 'top')
    await userEvent.type(screen.getByLabelText('Subcategoría'), 'Camisa')
    await userEvent.selectOptions(screen.getByLabelText('Formalidad *'), '4')
    await userEvent.selectOptions(screen.getByLabelText('Abrigo *'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Armario' })).toBeInTheDocument()
    expect(repo.items).toHaveLength(1)
    expect(repo.items[0]).toMatchObject({ category: 'top', subcategory: 'Camisa', formality: 4, warmth: 2 })
    expect(await screen.findByText('Camisa')).toBeInTheDocument()
    expect(screen.getByTestId('count')).toHaveTextContent('1 prenda')
  })

  it('oculta candidatas por defecto, filtra y alterna lavandería', async () => {
    await repo.create({ category: 'top', subcategory: 'Playera', formality: 1, warmth: 1 })
    await repo.create({ category: 'shoes', subcategory: 'Botas', formality: 2, warmth: 3 })
    await repo.create({ category: 'top', subcategory: 'Saco', formality: 5, warmth: 4, status: 'candidate' })
    renderApp('/armario')

    expect(await screen.findByText('Playera')).toBeInTheDocument()
    expect(screen.queryByText('Saco')).not.toBeInTheDocument()
    expect(screen.getByTestId('count')).toHaveTextContent('2 prendas')

    await userEvent.selectOptions(screen.getByLabelText('Categoría'), 'shoes')
    await waitFor(() => expect(screen.queryByText('Playera')).not.toBeInTheDocument())
    await userEvent.selectOptions(screen.getByLabelText('Categoría'), '')

    const card = (await screen.findByText('Playera')).closest('li')!
    await userEvent.click(within(card).getByRole('button', { name: 'A lavandería' }))
    expect(await within(card).findByRole('button', { name: 'Marcar activa' })).toBeInTheDocument()
    expect(repo.items[0].status).toBe('laundry')

    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'candidate')
    expect(await screen.findByText('Saco')).toBeInTheDocument()
  })

  it('edita y elimina con diálogo de confirmación propio', async () => {
    const g = await repo.create({ category: 'bottom', subcategory: 'Jeans', formality: 2, warmth: 3 })
    renderApp(`/armario/${g.id}`)

    const sub = await screen.findByLabelText('Subcategoría')
    await userEvent.clear(sub)
    await userEvent.type(sub, 'Pantalón')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await screen.findByRole('heading', { level: 1, name: 'Armario' })
    expect(repo.items[0].subcategory).toBe('Pantalón')

    await userEvent.click(await screen.findByRole('link', { name: /Editar Pantalón/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar prenda' }))
    const dialog = screen.getByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }))
    await screen.findByRole('heading', { level: 1, name: 'Armario' })
    expect(repo.items).toHaveLength(0)
  })
})
