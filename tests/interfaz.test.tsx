import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiProviderContextProvider } from '../src/ai/AiProviderContext'
import { MockAiProvider } from '../src/ai/mock'
import App from '../src/App'
import { BottomSheet } from '../src/components/BottomSheet'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { garmentInputSchema } from '../src/db'
import { loadSettings, saveSettings, SETTINGS_STORAGE_KEY } from '../src/settings'
import { fakeRepo } from './fixtures/fakeRepo'

// jsdom no decodifica imágenes: simulamos el redimensionado.
vi.mock('../src/lib/image', () => ({
  resizeImage: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
  downscaleForAi: async (b: Blob) => b,
}))

function renderApp(path: string, repo = fakeRepo([]), ai?: MockAiProvider) {
  const app = (
    <RepositoryProvider repository={repo}>
      <App />
    </RepositoryProvider>
  )
  render(
    <MemoryRouter initialEntries={[path]}>
      {ai ? <AiProviderContextProvider provider={ai}>{app}</AiProviderContextProvider> : app}
    </MemoryRouter>,
  )
  return repo
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('sin red')))
})

describe('tema', () => {
  it('por defecto es neutral y un valor inválido se ignora', () => {
    expect(loadSettings().theme).toBe('neutral')
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ theme: 'neon' }))
    expect(loadSettings().theme).toBe('neutral')
  })

  it('aplica data-theme al abrir con el tema guardado', () => {
    saveSettings({ theme: 'warm' })
    renderApp('/')
    expect(document.documentElement.dataset.theme).toBe('warm')
  })

  it('elegir una muestra en Ajustes guarda el tema y lo aplica', async () => {
    renderApp('/ajustes')
    expect(document.documentElement.dataset.theme).toBe('neutral')
    const warm = screen.getByRole('button', { name: /Cálido/ })
    expect(warm).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(warm)
    expect(document.documentElement.dataset.theme).toBe('warm')
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).theme).toBe('warm')
    expect(screen.getByRole('button', { name: /Cálido/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Neutro/ })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('Armario: búsqueda', () => {
  it('filtra por nombre, color y material sin distinguir acentos', async () => {
    const repo = fakeRepo([])
    await repo.create(garmentInputSchema.parse({ category: 'top', subcategory: 'Camisa', colors: ['azul marino'], material: 'lino', formality: 3, warmth: 1 }))
    await repo.create(garmentInputSchema.parse({ category: 'bottom', subcategory: 'Jeans', colors: ['negro'], material: 'mezclilla', formality: 2, warmth: 2 }))
    await repo.create(garmentInputSchema.parse({ category: 'shoes', subcategory: 'Botín', colors: ['café'], material: 'piel', formality: 3, warmth: 2 }))
    renderApp('/armario', repo)

    expect(await screen.findByText('Camisa')).toBeInTheDocument()
    expect(screen.getByTestId('count')).toHaveTextContent('3 prendas')
    const search = screen.getByRole('searchbox', { name: 'Buscar prendas' })

    await userEvent.type(search, 'MEZCLILLA')
    expect(screen.getByTestId('count')).toHaveTextContent('1 prenda')
    expect(screen.getByText('Jeans')).toBeInTheDocument()
    expect(screen.queryByText('Camisa')).not.toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'cafe')
    expect(screen.getByText('Botín')).toBeInTheDocument()
    expect(screen.getByTestId('count')).toHaveTextContent('1 prenda')

    await userEvent.clear(search)
    await userEvent.type(search, 'camis')
    expect(screen.getByText('Camisa')).toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'zzz')
    expect(screen.getByTestId('count')).toHaveTextContent('0 prendas')
    expect(screen.getByText(/No hay prendas que coincidan/)).toBeInTheDocument()
  })
})

describe('Agregar varias fotos', () => {
  const files = [1, 2, 3].map((n) => new File([new Uint8Array([n])], `p${n}.jpg`, { type: 'image/jpeg' }))

  it('encola 3 fotos, etiqueta cada una, permite omitir una y guarda 2', async () => {
    const ai = new MockAiProvider()
    const repo = renderApp('/agregar', fakeRepo([]), ai)

    await userEvent.upload(screen.getByTestId('gallery-input'), files)
    expect(await screen.findByTestId('queue-progress')).toHaveTextContent('Foto 1 de 3')
    expect(await screen.findByTestId('ai-suggested')).toBeInTheDocument()
    expect(ai.tagCalls).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))

    await waitFor(() => expect(screen.getByTestId('queue-progress')).toHaveTextContent('Foto 2 de 3'))
    // Cada foto se etiqueta de a una, cuando le toca.
    await waitFor(() => expect(ai.tagCalls).toHaveLength(2))
    expect(await screen.findByTestId('ai-suggested')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Omitir esta foto' }))

    await waitFor(() => expect(screen.getByTestId('queue-progress')).toHaveTextContent('Foto 3 de 3'))
    await waitFor(() => expect(ai.tagCalls).toHaveLength(3))
    expect(await screen.findByTestId('ai-suggested')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Armario' })).toBeInTheDocument()
    expect(repo.garments).toHaveLength(2)
    expect(await screen.findByText('2 prendas guardadas')).toBeInTheDocument()
  })

  it('sin IA configurada cada foto se llena a mano', async () => {
    const repo = renderApp('/agregar')
    await userEvent.upload(screen.getByTestId('gallery-input'), files.slice(0, 2))
    expect(await screen.findByTestId('queue-progress')).toHaveTextContent('Foto 1 de 2')
    await screen.findByAltText('Vista previa de la foto')
    await userEvent.selectOptions(screen.getByLabelText('Categoría *'), 'top')
    await userEvent.selectOptions(screen.getByLabelText('Formalidad *'), '3')
    await userEvent.selectOptions(screen.getByLabelText('Abrigo *'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))
    await waitFor(() => expect(screen.getByTestId('queue-progress')).toHaveTextContent('Foto 2 de 2'))
    expect(screen.getByLabelText('Categoría *')).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Omitir esta foto' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Armario' })).toBeInTheDocument()
    expect(repo.garments).toHaveLength(1)
  })
})

describe('hoja inferior', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button type="button">Abrir</button>
        {open && (
          <BottomSheet
            title="Una hoja"
            onClose={() => {
              onClose()
              setOpen(false)
            }}
          >
            <button type="button">Dentro</button>
          </BottomSheet>
        )}
      </>
    )
  }

  it('es modal, enfoca su contenido y se cierra con Escape', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const sheet = screen.getByRole('dialog', { name: 'Una hoja' })
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(within(sheet).getByRole('button', { name: 'Dentro' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('el diálogo de confirmación de eliminar se cierra con Escape sin borrar', async () => {
    const repo = fakeRepo([])
    const g = await repo.create(garmentInputSchema.parse({ category: 'top', subcategory: 'Playera', formality: 1, warmth: 1 }))
    renderApp(`/armario/${g.id}`, repo)
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar prenda' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(repo.garments).toHaveLength(1)
  })
})

describe('avisos', () => {
  it('muestra «Prenda guardada» tras guardar una prenda', async () => {
    renderApp('/agregar')
    await userEvent.selectOptions(screen.getByLabelText('Categoría *'), 'top')
    await userEvent.selectOptions(screen.getByLabelText('Formalidad *'), '3')
    await userEvent.selectOptions(screen.getByLabelText('Abrigo *'), '2')
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))
    })
    expect(await screen.findByTestId('toast')).toHaveTextContent('Prenda guardada')
  })
})
