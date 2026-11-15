import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CutoutControls } from '../src/components/CutoutControls'
import { CutoutSettings } from '../src/components/CutoutSettings'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { BackgroundRemoverContextProvider, MockBackgroundRemover } from '../src/cutout'
import type { MockRemoverOptions } from '../src/cutout/mock'
import { IN_FLIGHT_KEY, SKIP_KEY, resetCrashGuardForTests } from '../src/cutout/crashGuard'
import { fakeRepo } from './fixtures/fakeRepo'

beforeEach(() => {
  localStorage.clear()
  resetCrashGuardForTests()
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})

async function setup(
  options: MockRemoverOptions = {},
  count = 3,
  withCutout = 0,
  prep?: (repo: ReturnType<typeof fakeRepo>) => void,
) {
  const repo = fakeRepo([])
  repo.getPhoto = async () => new Blob(['photo'], { type: 'image/jpeg' })
  for (let i = 0; i < count; i++) {
    const g = await repo.create({ category: 'top', subcategory: `Prenda ${i + 1}`, formality: 3, warmth: 2, photo_path: `photo:${i}` })
    if (i < withCutout) await repo.setCutout(g.id, new Blob(['c']), 'mask')
  }
  prep?.(repo)
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
  it('«Rehacer todos los recortes» vuelve a recortar también las prendas que ya tenían recorte', async () => {
    const { repo, remover } = await setup({}, 3, 2)
    await userEvent.click(await screen.findByRole('button', { name: 'Rehacer todos los recortes (3)' }))
    expect(await screen.findByText(/3 prendas con recorte\./)).toBeInTheDocument()
    expect(remover.removeCalls).toHaveLength(3)
    expect(repo.garments.every((g) => g.cutout_kind === 'mask')).toBe(true)
  })

  it('«Rehacer todos los recortes» se puede cancelar', async () => {
    const { remover } = await setup({ delayMs: 30 }, 4, 4)
    await userEvent.click(await screen.findByRole('button', { name: 'Rehacer todos los recortes (4)' }))
    expect(await screen.findByRole('progressbar', { name: 'Avance del procesamiento' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByText(/Cancelado\./)).toBeInTheDocument()
    expect(remover.removeCalls.length).toBeLessThan(4)
  })

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

  it('el motor preferido se guarda; WebGPU solo aparece como opción experimental', async () => {
    const { remover } = await setup()
    const select = await screen.findByLabelText('Motor de recorte')
    expect(select).toHaveValue('wasm')
    expect(screen.getByRole('option', { name: 'WebGPU (experimental)' })).toBeInTheDocument()
    await userEvent.selectOptions(select, 'webgpu')
    expect(localStorage.getItem('armario.cutoutEngine')).toBe('webgpu')
    await userEvent.selectOptions(select, 'wasm')
    expect(localStorage.getItem('armario.cutoutEngine')).toBe('wasm')
    expect(remover.disposeCalls).toBe(2)
  })

  it("una preferencia antigua 'auto' se muestra y guarda como WASM", async () => {
    localStorage.setItem('armario.cutoutEngine', 'auto')
    await setup()
    expect(await screen.findByLabelText('Motor de recorte')).toHaveValue('wasm')
    expect(localStorage.getItem('armario.cutoutEngine')).toBe('wasm')
  })

  it('el lote se detiene tras 3 fallos seguidos con un mensaje claro', async () => {
    const { remover } = await setup({ error: new Error('sin memoria') }, 6)
    await userEvent.click(await screen.findByRole('button', { name: 'Procesar prendas sin recorte (6)' }))
    expect(await screen.findByText(/Se detuvo tras 3 fallos seguidos\. Cierra otras apps y pestañas/)).toBeInTheDocument()
    expect(remover.removeCalls).toHaveLength(3)
  })

  it('los fallos que no son seguidos no detienen el lote', async () => {
    const { remover } = await setup({ failCalls: [1, 2, 4, 5] }, 6)
    await userEvent.click(await screen.findByRole('button', { name: 'Procesar prendas sin recorte (6)' }))
    expect(await screen.findByText(/2 prendas con recorte, 4 sin resultado\./)).toBeInTheDocument()
    expect(remover.removeCalls).toHaveLength(6)
  })

  it('muestra «Procesando 4 de 12»', async () => {
    const { remover } = await setup({ delayMs: 25 }, 12)
    await userEvent.click(await screen.findByRole('button', { name: 'Procesar prendas sin recorte (12)' }))
    expect(await screen.findByText(/Procesando 4 de 12/, undefined, { timeout: 3000 })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByText(/Cancelado\./)).toBeInTheDocument()
    expect(remover.removeCalls.length).toBeLessThan(12)
  })

  it('el diagnóstico informa si el worker se recicló', async () => {
    await setup({}, 1)
    await userEvent.click(await screen.findByRole('button', { name: 'Probar recorte' }))
    expect(await screen.findByTestId('cutout-diagnostic')).toHaveTextContent('Worker reciclado: no')
    expect(screen.getByTestId('cutout-diagnostic')).toHaveTextContent('Preferencia: WASM')
  })
})

describe('Ajustes › cierre por falta de memoria', () => {
  const crashPrep = (repo: ReturnType<typeof fakeRepo>) =>
    localStorage.setItem(IN_FLIGHT_KEY, JSON.stringify({ garmentId: repo.garments[1].id, startedAt: 1 }))

  it('muestra el aviso, fuerza WASM y omite la prenda; «Entendido» lo cierra', async () => {
    localStorage.setItem('armario.cutoutEngine', 'webgpu')
    await setup({}, 3, 0, crashPrep)
    expect(await screen.findByTestId('cutout-crash-card')).toHaveTextContent(
      'La última vez el recorte se cerró por falta de memoria. Cierra otras apps y pestañas, y vuelve a intentarlo.',
    )
    expect(localStorage.getItem('armario.cutoutEngine')).toBe('wasm')
    expect(localStorage.getItem(IN_FLIGHT_KEY)).toBeNull()
    expect(await screen.findByTestId('cutout-skipped')).toHaveTextContent('1 prenda omitida por memoria')
    expect(screen.getByRole('button', { name: 'Procesar prendas sin recorte (2)' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Entendido' }))
    expect(screen.queryByTestId('cutout-crash-card')).toBeNull()
    expect(localStorage.getItem('armario.cutoutCrashed')).toBeNull()
    expect(screen.getByTestId('cutout-skipped')).toBeInTheDocument()
  })

  it('«Intentar de nuevo» cierra el aviso y procesa las pendientes sin tocar la omitida', async () => {
    const { repo, remover } = await setup({}, 3, 0, crashPrep)
    await userEvent.click(await screen.findByRole('button', { name: 'Intentar de nuevo' }))
    expect(await screen.findByText(/2 prendas con recorte\./)).toBeInTheDocument()
    expect(remover.removeCalls).toHaveLength(2)
    expect(repo.garments.filter((g) => g.cutout_path)).toHaveLength(2)
    expect(repo.garments[1].cutout_path).toBeFalsy()
    expect(screen.queryByTestId('cutout-crash-card')).toBeNull()
  })

  it('«Reintentar omitidas» vacía la lista y las prendas vuelven a contar como pendientes', async () => {
    await setup({}, 3, 0, crashPrep)
    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar omitidas' }))
    expect(screen.queryByTestId('cutout-skipped')).toBeNull()
    expect(localStorage.getItem(SKIP_KEY)).toBeNull()
    expect(screen.getByRole('button', { name: 'Procesar prendas sin recorte (3)' })).toBeEnabled()
  })

  it('sin marca previa no hay aviso', async () => {
    await setup({}, 2)
    await screen.findByRole('button', { name: 'Probar recorte' })
    expect(screen.queryByTestId('cutout-crash-card')).toBeNull()
    expect(screen.queryByTestId('cutout-skipped')).toBeNull()
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
