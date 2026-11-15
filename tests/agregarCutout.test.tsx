import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { AiProviderContextProvider } from '../src/ai/AiProviderContext'
import { DEFAULT_MOCK_GARMENT, MockAiProvider } from '../src/ai/mock'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { BackgroundRemoverContextProvider, MockBackgroundRemover } from '../src/cutout'
import type { MockRemoverOptions } from '../src/cutout/mock'
import { fakeRepo } from './fixtures/fakeRepo'

// jsdom no decodifica imágenes ni tiene canvas: se simulan el redimensionado y el recorte rectangular.
vi.mock('../src/lib/image', () => ({
  resizeImage: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
  downscaleForAi: async (b: Blob) => b,
}))
vi.mock('../src/cutout/imageOps', () => ({
  cropToBBoxBlob: async () => new Blob(['crop'], { type: 'image/jpeg' }),
}))

beforeEach(() => localStorage.clear())

async function addWithPhoto(removerOptions: MockRemoverOptions, bbox?: unknown) {
  const repo = fakeRepo([])
  repo.getPhoto = async () => new Blob(['photo'], { type: 'image/jpeg' })
  const remover = new MockBackgroundRemover(removerOptions)
  const ai = new MockAiProvider({ garment: { ...DEFAULT_MOCK_GARMENT, bbox } as never })
  render(
    <MemoryRouter initialEntries={['/agregar']}>
      <AiProviderContextProvider provider={ai}>
        <BackgroundRemoverContextProvider remover={remover}>
          <RepositoryProvider repository={repo}>
            <App />
          </RepositoryProvider>
        </BackgroundRemoverContextProvider>
      </AiProviderContextProvider>
    </MemoryRouter>,
  )
  await userEvent.upload(screen.getByTestId('gallery-input'), new File(['x'], 'p.jpg', { type: 'image/jpeg' }))
  await screen.findByTestId('ai-suggested')
  await userEvent.click(screen.getByRole('button', { name: 'Guardar prenda' }))
  await screen.findByRole('heading', { level: 1, name: 'Armario' })
  return { repo, remover }
}

describe('Agregar: recorte en segundo plano tras guardar', () => {
  it('con el modelo descargado guarda la máscara', async () => {
    const { repo, remover } = await addWithPhoto({ downloaded: true }, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
    await waitFor(() => expect(repo.garments[0].cutout_kind).toBe('mask'))
    expect(remover.readyCalls).toBe(0)
  })

  it('sin el modelo usa el bbox de la IA y nunca descarga el modelo', async () => {
    const { repo, remover } = await addWithPhoto({ downloaded: false }, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
    await waitFor(() => expect(repo.garments[0].cutout_kind).toBe('bbox'))
    expect(remover.readyCalls).toBe(0)
    expect(remover.removeCalls).toHaveLength(0)
  })

  it('un bbox inválido se ignora: sin modelo no hay recorte y la prenda se guarda igual', async () => {
    const { repo, remover } = await addWithPhoto({ downloaded: false }, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 })
    expect(repo.garments).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 50))
    expect(repo.garments[0].cutout_path).toBeUndefined()
    expect(remover.readyCalls).toBe(0)
  })
})
