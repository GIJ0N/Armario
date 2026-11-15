import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CutoutControls } from '../src/components/CutoutControls'
import { CutoutSettings } from '../src/components/CutoutSettings'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { BackgroundRemoverContextProvider, MockBackgroundRemover } from '../src/cutout'
import type { MockRemoverOptions } from '../src/cutout/mock'
import { fakeRepo } from './fixtures/fakeRepo'

beforeEach(() => {
  localStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})

async function setup(options: MockRemoverOptions = {}, count = 3, withCutout = 0) {
  const repo = fakeRepo([])
  repo.getPhoto = async () => new Blob(['photo'], { type: 'image/jpeg' })
  for (let i = 0; i < count; i++) {
    const g = await repo.create({ category: 'top', subcategory: `Prenda ${i + 1}`, formality: 3, warmth: 2, photo_path: `photo:${i}` })
    if (i < withCutout) await repo.setCutout(g.id, new Blob(['c']), 'mask')
  }
  const remover = new MockBackgroundRemover(options)
  const ui = (
    <MemoryRouter>
      <RepositoryProvider repository={repo}>
        <BackgroundRemoverContextProvider remover={remover}>
          <CutoutSettings />
        </BackgroundRemoverContextProvider>
      </RepositoryProvider>
    </MemoryRouter>
  )
  render(ui)
  return { repo, remover }
}

describe('Ajustes › Recorte de fondo', () => {
  it('muestra el estado del modelo y lo descarga con avance solo al pulsar el botón', async () => {
    const { remover } = await setup({ downloaded: false, delayMs: 40 })
    expect(await screen.findByTestId('cutout-model-state')).toHaveTextContent('No descargado')
    expect(remover.readyCalls).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'Descargar modelo' }))
    expect(await screen.findByText(/Descargando 50 %/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('cutout-model-state')).toHaveTextContent('Listo'))
    expect(remover.readyCalls).toBe(1)
    expect(screen.getByRole('button', { name: 'Modelo descargado' })).toBeDisabled()
  })

  it('procesar prendas sin recorte: cuenta N, avanza una por una y guarda cada recorte', async () => {
    const { repo, remover } = await setup({}, 3, 1)
    const button = await screen.findByRole('button', { name: 'Procesar prendas sin recorte (2)' })
    await userEvent.click(button)
    expect(await screen.findByText(/2 prendas con recorte\./)).toBeInTheDocument()
    expect(remover.removeCalls).toHaveLength(2)
    expect(repo.garments.every((g) => !!g.cutout_path)).toBe(true)
    expect(screen.getByRole('button', { name: 'Procesar prendas sin recorte (0)' })).toBeDisabled()
  })

  it('procesar: cuenta los fallos sin detenerse', async () => {
    const { repo } = await setup({ failCalls: [2] }, 3)
    await userEvent.click(await screen.findByRole('button', { name: 'Procesar prendas sin recorte (3)' }))
    expect(await screen.findByText(/2 prendas con recorte, 1 sin resultado\./)).toBeInTheDocument()
    expect(repo.garments.filter((g) => g.cutout_path)).toHaveLength(2)
  })

  it('cancelar detiene el lote después de la prenda en curso', async () => {
    const { repo, remover } = await setup({ delayMs: 60 }, 4)
    await userEvent.click(await screen.findByRole('button', { name: 'Procesar prendas sin recorte (4)' }))
    expect(await screen.findByText(/Procesando 1 de 4/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByText(/^Cancelado\./)).toBeInTheDocument()
    expect(remover.removeCalls.length).toBeLessThan(4)
    expect(repo.garments.filter((g) => g.cutout_path).length).toBe(remover.removeCalls.length)
    // Sigue habiendo prendas pendientes.
    expect(screen.getByRole('button', { name: /Procesar prendas sin recorte \([1-9]\)/ })).toBeEnabled()
  })

  it('sin modelo descargado, procesar y probar están desactivados y nada se descarga solo', async () => {
    const { remover } = await setup({ downloaded: false }, 2)
    expect(await screen.findByRole('button', { name: 'Procesar prendas sin recorte (2)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Probar recorte' })).toBeDisabled()
    expect(remover.readyCalls).toBe(0)
    expect(remover.removeCalls).toHaveLength(0)
  })

  it('«Probar recorte» muestra milisegundos y motor, sin guardar nada', async () => {
    const { repo, remover } = await setup({ engine: 'webgpu' }, 2)
    await userEvent.click(await screen.findByRole('button', { name: 'Probar recorte' }))
    const diag = await screen.findByTestId('cutout-diagnostic')
    expect(diag).toHaveTextContent('Motor usado: webgpu')
    expect(diag).toHaveTextContent(/Recorte: \d+ ms/)
    expect(diag).toHaveTextContent(/Carga del modelo: \d+ ms/)
    expect(remover.removeCalls).toHaveLength(1)
    expect(repo.garments.some((g) => g.cutout_path)).toBe(false)
  })

  it('«Probar recorte» informa el error del modelo', async () => {
    await setup({ error: new Error('sin memoria') }, 1)
    await userEvent.click(await screen.findByRole('button', { name: 'Probar recorte' }))
    expect(await screen.findByTestId('cutout-diagnostic')).toHaveTextContent('sin memoria')
  })

  it('el motor preferido se guarda', async () => {
    const { remover } = await setup()
    await userEvent.selectOptions(await screen.findByLabelText('Motor de recorte'), 'wasm')
    expect(localStorage.getItem('armario.cutoutEngine')).toBe('wasm')
    expect(remover.disposeCalls).toBe(1)
  })
})

describe('Detalle: Sin fondo / Original y Rehacer recorte', () => {
  async function renderControls(options: MockRemoverOptions = {}, withCutout = true) {
    const repo = fakeRepo([])
    repo.getPhoto = async () => new Blob(['x'])
    let g = await repo.create({ category: 'top', formality: 3, warmth: 2, photo_path: 'photo:1' })
    if (withCutout) g = await repo.setCutout(g.id, new Blob(['c']), 'mask')
    const remover = new MockBackgroundRemover(options)
    const onChange = vi.fn()
    render(
      <MemoryRouter>
        <RepositoryProvider repository={repo}>
          <BackgroundRemoverContextProvider remover={remover}>
            <CutoutControls garment={g} onChange={onChange} />
          </BackgroundRemoverContextProvider>
        </RepositoryProvider>
      </MemoryRouter>,
    )
    return { repo, remover, onChange }
  }

  it('alterna entre sin fondo y original', async () => {
    await renderControls()
    expect(await screen.findByAltText('Prenda sin fondo')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Original' }))
    expect(await screen.findByAltText('Foto original de la prenda')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('sin recorte no ofrece el interruptor y usa la original', async () => {
    await renderControls({}, false)
    expect(await screen.findByAltText('Foto original de la prenda')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sin fondo' })).toBeNull()
    expect(screen.getByText(/no tiene recorte/)).toBeInTheDocument()
  })

  it('Rehacer recorte crea uno nuevo y avisa al padre', async () => {
    const { remover, onChange } = await renderControls()
    await userEvent.click(screen.getByRole('button', { name: 'Rehacer recorte' }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(remover.removeCalls).toHaveLength(1)
    expect(await screen.findByText('Recorte listo.')).toBeInTheDocument()
  })

  it('Rehacer sin modelo descargado no lo descarga y apunta a Ajustes', async () => {
    const { remover } = await renderControls({ downloaded: false })
    await userEvent.click(screen.getByRole('button', { name: 'Rehacer recorte' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no está descargado')
    expect(screen.getByRole('link', { name: 'Ir a Ajustes' })).toBeInTheDocument()
    expect(remover.readyCalls).toBe(0)
  })
})
