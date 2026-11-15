import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { CutoutControls } from '../src/components/CutoutControls'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { ToastProvider } from '../src/components/ToastProvider'
import { BackgroundRemoverContextProvider, MockBackgroundRemover } from '../src/cutout'
import { notifyCutoutChanged } from '../src/cutout/events'
import type { Repository } from '../src/db'
import { fakeRepo } from './fixtures/fakeRepo'

// jsdom no decodifica imágenes ni tiene canvas: el aplanado y el pegamento con canvas se simulan.
// Un archivo cuyo contenido es «CUT» se decodifica con transparencia; cualquier otro, opaco.
vi.mock('../src/lib/image', () => ({
  resizeImage: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
  downscaleForAi: async (b: Blob) => b,
}))
vi.mock('../src/cutout/providedCanvas', () => ({
  decodeRgba: async (blob: Blob) => {
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.readAsText(blob)
    })
    const w = 20
    const h = 20
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = text === 'CUT' && x >= 5 && x < 15 ? 255 : text === 'CUT' ? 0 : 255
    return { width: w, height: h, rgba }
  },
  encodePng: async () => new Blob(['provided-png'], { type: 'image/png' }),
}))
vi.mock('../src/cutout/imageOps', () => ({
  cropToBBoxBlob: async () => new Blob(['crop'], { type: 'image/jpeg' }),
}))

const cut = (name = 'cut.png') => new File(['CUT'], name, { type: 'image/png' })
const opaque = (name = 'flat.png') => new File(['FLAT'], name, { type: 'image/png' })

beforeEach(() => {
  localStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})

function renderApp(path: string, repo: Repository, remover = new MockBackgroundRemover({ downloaded: true })) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <BackgroundRemoverContextProvider remover={remover}>
          <RepositoryProvider repository={repo}>
            <App />
          </RepositoryProvider>
        </BackgroundRemoverContextProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
  return remover
}

function spyRepo(garments: Parameters<typeof fakeRepo>[0] = []) {
  const repo = fakeRepo(garments)
  repo.getPhoto = async () => new Blob(['photo'], { type: 'image/jpeg' })
  const setCutout = vi.spyOn(repo, 'setCutout')
  return { repo, setCutout }
}

async function fillRequired() {
  await userEvent.selectOptions(screen.getByLabelText('Categoría *'), 'top')
  await userEvent.selectOptions(screen.getByLabelText('Formalidad *'), '3')
  await userEvent.selectOptions(screen.getByLabelText('Abrigo *'), '2')
}

describe('Agregar con una imagen ya recortada', () => {
  it('vista previa con insignia; al guardar usa el recorte como mask y no llama al modelo', async () => {
    const { repo, setCutout } = spyRepo()
    const remover = renderApp('/agregar', repo)
    await userEvent.upload(screen.getByTestId('gallery-input'), cut())
    expect(await screen.findByText('Sin fondo (del iPhone)')).toBeInTheDocument()
    expect(screen.getByAltText('Vista previa de la prenda sin fondo')).toBeInTheDocument()
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))
    await screen.findByRole('heading', { level: 1, name: 'Armario' })
    expect(setCutout).toHaveBeenCalledTimes(1)
    expect(setCutout.mock.calls[0][2]).toBe('mask')
    expect(setCutout.mock.calls[0][1].type).toBe('image/png')
    expect(repo.garments[0].cutout_kind).toBe('mask')
    await new Promise((r) => setTimeout(r, 30))
    expect(remover.removeCalls).toHaveLength(0)
    expect(remover.readyCalls).toBe(0)
  })

  it('una imagen opaca sigue el camino de antes: recorte con el modelo y sin insignia', async () => {
    const { repo, setCutout } = spyRepo()
    const remover = renderApp('/agregar', repo)
    await userEvent.upload(screen.getByTestId('gallery-input'), opaque())
    await screen.findByAltText('Vista previa de la foto')
    expect(screen.queryByText('Sin fondo (del iPhone)')).not.toBeInTheDocument()
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))
    await screen.findByRole('heading', { level: 1, name: 'Armario' })
    await waitFor(() => expect(remover.removeCalls).toHaveLength(1))
    expect(setCutout).toHaveBeenCalledTimes(1) // el que hace queueCutout
  })

  it('cola de varias fotos: la recortada usa su recorte, la opaca el modelo', async () => {
    const { repo, setCutout } = spyRepo()
    const remover = renderApp('/agregar', repo)
    await userEvent.upload(screen.getByTestId('gallery-input'), [cut('a.png'), opaque('b.png')])
    expect(await screen.findByTestId('queue-progress')).toHaveTextContent('Foto 1 de 2')
    await screen.findByText('Sin fondo (del iPhone)')
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))
    await waitFor(() => expect(screen.getByTestId('queue-progress')).toHaveTextContent('Foto 2 de 2'))
    expect(setCutout).toHaveBeenCalledTimes(1)
    expect(remover.removeCalls).toHaveLength(0)
    await screen.findByAltText('Vista previa de la foto')
    expect(screen.queryByText('Sin fondo (del iPhone)')).not.toBeInTheDocument()
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))
    await screen.findByRole('heading', { level: 1, name: 'Armario' })
    await waitFor(() => expect(remover.removeCalls).toHaveLength(1))
  })

  it('«Pegar foto» con una imagen recortada en el portapapeles', async () => {
    const { repo, setCutout } = spyRepo()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [{ types: ['image/png'], getType: async () => new Blob(['CUT'], { type: 'image/png' }) }] },
    })
    const remover = renderApp('/agregar', repo)
    await userEvent.click(await screen.findByRole('button', { name: 'Pegar foto' }))
    expect(await screen.findByText('Sin fondo (del iPhone)')).toBeInTheDocument()
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))
    await screen.findByRole('heading', { level: 1, name: 'Armario' })
    expect(setCutout).toHaveBeenCalledTimes(1)
    expect(remover.removeCalls).toHaveLength(0)
  })

  it('sin la API del portapapeles se ve el destino de pegado en lugar del botón', async () => {
    renderApp('/agregar', spyRepo().repo)
    expect(await screen.findByTestId('paste-target')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pegar foto' })).not.toBeInTheDocument()
  })

  it('la guía «Quitar el fondo con tu iPhone» se abre desde Agregar', async () => {
    renderApp('/agregar', spyRepo().repo)
    await userEvent.click(screen.getByRole('button', { name: '¿Cómo quito el fondo?' }))
    const sheet = screen.getByRole('dialog', { name: 'Quitar el fondo con tu iPhone' })
    expect(within(sheet).getByText('Una prenda')).toBeInTheDocument()
    expect(within(sheet).getByText('Varias a la vez')).toBeInTheDocument()
    expect(within(sheet).getByText(/Eliminar fondo/)).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Entendido' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Comprar con una imagen ya recortada', () => {
  it('la candidata guarda el recorte provisto sin llamar al modelo', async () => {
    const { repo, setCutout } = spyRepo()
    const remover = renderApp('/comprar', repo)
    await userEvent.upload(await screen.findByTestId('gallery-input'), cut())
    await screen.findByText('Sin fondo (del iPhone)')
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y evaluar' }))
    await waitFor(() => expect(setCutout).toHaveBeenCalledTimes(1))
    expect(setCutout.mock.calls[0][2]).toBe('mask')
    expect(repo.garments[0].status).toBe('candidate')
    expect(remover.removeCalls).toHaveLength(0)
  })
})

describe('Detalle de la prenda', () => {
  async function seed() {
    const ctx = spyRepo()
    const g = await ctx.repo.create({ category: 'top', subcategory: 'Camisa', formality: 3, warmth: 2, photo_path: 'photo:old' })
    return { ...ctx, id: g.id }
  }

  it('reemplazar la foto con una imagen recortada guarda el recorte sin modelo', async () => {
    const { repo, setCutout, id } = await seed()
    const remover = renderApp(`/armario/${id}`, repo)
    await userEvent.upload(await screen.findByTestId('gallery-input'), cut())
    await screen.findByText('Sin fondo (del iPhone)')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await screen.findByRole('heading', { level: 1, name: 'Armario' })
    expect(setCutout).toHaveBeenCalledTimes(1)
    expect(setCutout.mock.calls[0][2]).toBe('mask')
    expect(remover.removeCalls).toHaveLength(0)
  })

  it('«Elegir recorte» con transparencia reemplaza solo el recorte y avisa', async () => {
    const { repo, setCutout, id } = await seed()
    renderApp(`/armario/${id}`, repo)
    await userEvent.upload(await screen.findByTestId('cutout-input'), cut())
    expect(await screen.findByText('Recorte actualizado')).toBeInTheDocument()
    expect(setCutout).toHaveBeenCalledWith(id, expect.any(Blob), 'mask')
    expect(repo.garments[0].photo_path).toBe('photo:old')
  })

  it('«Elegir recorte» sin transparencia muestra el mensaje y no cambia nada', async () => {
    const { repo, setCutout, id } = await seed()
    renderApp(`/armario/${id}`, repo)
    await userEvent.upload(await screen.findByTestId('cutout-input'), opaque())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esa imagen no trae fondo transparente. Cópiala desde Fotos manteniendo presionada la prenda.',
    )
    expect(setCutout).not.toHaveBeenCalled()
  })

  it('la guía se abre desde el área del recorte', async () => {
    const { repo, id } = await seed()
    renderApp(`/armario/${id}`, repo)
    await userEvent.click(await screen.findByRole('button', { name: '¿Cómo quito el fondo?' }))
    expect(screen.getByRole('dialog', { name: 'Quitar el fondo con tu iPhone' })).toBeInTheDocument()
  })
})

describe('CutoutControls: «Pegar recorte»', () => {
  it('pega un PNG con transparencia', async () => {
    const { repo, setCutout } = spyRepo()
    const g = await repo.create({ category: 'top', formality: 3, warmth: 2, photo_path: 'photo:1' })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [{ types: ['image/png'], getType: async () => new Blob(['CUT'], { type: 'image/png' }) }] },
    })
    const onChange = vi.fn()
    render(
      <MemoryRouter>
        <ToastProvider>
          <RepositoryProvider repository={repo}>
            <BackgroundRemoverContextProvider remover={new MockBackgroundRemover()}>
              <CutoutControls garment={g} onChange={onChange} />
            </BackgroundRemoverContextProvider>
          </RepositoryProvider>
        </ToastProvider>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Pegar recorte' }))
    expect(await screen.findByText('Recorte actualizado')).toBeInTheDocument()
    expect(setCutout).toHaveBeenCalledWith(g.id, expect.any(Blob), 'mask')
    expect(onChange).toHaveBeenCalled()
  })
})

describe('bus de eventos del recorte', () => {
  it('Armario vuelve a leer la prenda cuando termina un recorte en segundo plano', async () => {
    const repo = fakeRepo([])
    const g = await repo.create({ category: 'top', subcategory: 'Camisa', formality: 3, warmth: 2, photo_path: 'photo:1' })
    const getPhoto = vi.fn(async () => new Blob(['p'], { type: 'image/jpeg' }))
    repo.getPhoto = getPhoto
    renderApp('/armario', repo)
    await screen.findByText('Camisa')
    expect(getPhoto).toHaveBeenCalledWith('photo:1')
    expect(getPhoto).not.toHaveBeenCalledWith(`cutout:${g.id}`)
    await act(async () => {
      await repo.setCutout(g.id, new Blob(['c']), 'mask')
      notifyCutoutChanged(g.id)
    })
    await waitFor(() => expect(getPhoto).toHaveBeenCalledWith(`cutout:${g.id}`))
  })
})
