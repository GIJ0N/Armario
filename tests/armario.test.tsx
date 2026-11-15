import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiProviderContextProvider } from '../src/ai/AiProviderContext'
import { AiNetworkError } from '../src/ai/errors'
import { MockAiProvider } from '../src/ai/mock'
import type { AiProvider } from '../src/ai/provider'
import { saveSettings } from '../src/settings'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import {
  garmentInputSchema,
  type Garment,
  type GarmentFilter,
  type GarmentInput,
  type Outfit,
} from '../src/db'
import type { Repository } from '../src/db'
import App from '../src/App'

// jsdom no decodifica imágenes: simulamos el redimensionado.
vi.mock('../src/lib/image', () => ({
  resizeImage: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
}))

function createFakeRepo(): Repository & { items: Garment[] } {
  const items: Garment[] = []
  const outfitRows: Outfit[] = []
  let n = 0
  const byFilter = (f: GarmentFilter = {}) =>
    items.filter(
      (g) => (!f.category || g.category === f.category) && (!f.statuses || f.statuses.includes(g.status)),
    )
  return {
    items,
    outfits: {
      create: async (input) => {
        const o = { ...input, id: `o${outfitRows.length + 1}`, created_at: new Date().toISOString() }
        outfitRows.push(o)
        return o
      },
      listRecent: async () => [...outfitRows].reverse(),
    },
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

function renderApp(path: string, ai?: AiProvider) {
  const app = (
    <RepositoryProvider repository={repo}>
      <App />
    </RepositoryProvider>
  )
  return render(
    <MemoryRouter initialEntries={[path]}>
      {ai ? <AiProviderContextProvider provider={ai}>{app}</AiProviderContextProvider> : app}
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
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

describe('Agregar con IA', () => {
  const photo = new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' })

  async function pickPhoto() {
    await userEvent.upload(screen.getByTestId('gallery-input'), photo)
    await screen.findByAltText('Vista previa de la foto')
  }

  it('rellena el formulario con la sugerencia y permite guardar', async () => {
    const ai = new MockAiProvider({ delayMs: 20 })
    renderApp('/agregar', ai)
    await pickPhoto()
    expect(await screen.findByText('Analizando la prenda…')).toBeInTheDocument()
    expect(await screen.findByTestId('ai-suggested')).toHaveTextContent('Sugeridos por IA')
    expect(screen.getByLabelText('Categoría *')).toHaveValue('top')
    expect(screen.getByLabelText('Subcategoría')).toHaveValue('camisa')
    expect(screen.getByLabelText('Formalidad *')).toHaveValue('4')
    expect(screen.getByLabelText('Oficina')).toBeChecked()
    expect(ai.tagCalls).toHaveLength(1)

    await userEvent.clear(screen.getByLabelText('Subcategoría'))
    await userEvent.type(screen.getByLabelText('Subcategoría'), 'Camisa Oxford')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))
    await screen.findByRole('heading', { level: 1, name: 'Armario' })
    expect(repo.items[0]).toMatchObject({ subcategory: 'Camisa Oxford', formality: 4, photo_path: 'photo:1' })
  })

  it('"Volver a analizar" llama de nuevo a la IA', async () => {
    const ai = new MockAiProvider()
    renderApp('/agregar', ai)
    await pickPhoto()
    await screen.findByTestId('ai-suggested')
    await userEvent.click(screen.getByRole('button', { name: 'Volver a analizar' }))
    await waitFor(() => expect(ai.tagCalls).toHaveLength(2))
  })

  it('ante un error muestra el mensaje y deja usable el formulario manual con la foto', async () => {
    const ai = new MockAiProvider({ error: new AiNetworkError() })
    renderApp('/agregar', ai)
    await pickPhoto()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con la IA')
    expect(screen.getByAltText('Vista previa de la foto')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Categoría *'), 'shoes')
    await userEvent.selectOptions(screen.getByLabelText('Formalidad *'), '2')
    await userEvent.selectOptions(screen.getByLabelText('Abrigo *'), '3')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))
    await screen.findByRole('heading', { level: 1, name: 'Armario' })
    expect(repo.items[0]).toMatchObject({ category: 'shoes', photo_path: 'photo:1' })
  })

  it('sin API key muestra el aviso a Ajustes y no llama a la IA', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderApp('/agregar')
    await pickPhoto()
    expect(within(screen.getByText(/agrega tu API key/)).getByRole('link', { name: 'Ajustes' })).toHaveAttribute('href', '/ajustes')
    expect(screen.getByText(/agrega tu API key/)).toBeInTheDocument()
    expect(screen.queryByText('Analizando la prenda…')).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    await userEvent.selectOptions(screen.getByLabelText('Categoría *'), 'top')
    expect(screen.getByLabelText('Subcategoría')).toBeEnabled()
    fetchSpy.mockRestore()
  })
})

describe('Ajustes', () => {
  it('guarda la key, alterna visibilidad y prueba la conexión', async () => {
    const ai = new MockAiProvider({ json: { ok: true } })
    renderApp('/ajustes', ai)
    const key = screen.getByLabelText('API key de Gemini')
    expect(key).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar' }))
    expect(key).toHaveAttribute('type', 'text')
    expect(screen.getByRole('link', { name: 'Google AI Studio' })).toHaveAttribute(
      'href',
      'https://aistudio.google.com/apikey',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Probar conexión' }))
    expect(await screen.findByText('Conexión correcta.')).toBeInTheDocument()
    expect(ai.jsonCalls).toHaveLength(1)
  })

  it('muestra error en español sin API key', async () => {
    renderApp('/ajustes')
    await userEvent.click(screen.getByRole('button', { name: 'Probar conexión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Falta la API key')
  })

  it('persiste la ciudad', async () => {
    renderApp('/ajustes')
    const city = screen.getByLabelText(/Ciudad/)
    expect(city).toHaveValue('Monterrey')
    await userEvent.clear(city)
    await userEvent.type(city, 'Apodaca')
    expect(localStorage.getItem('armario.settings')).toContain('Apodaca')
    saveSettings({ city: 'Monterrey' })
  })
})
