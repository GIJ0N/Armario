import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { GarmentSizeSection } from '../src/components/GarmentSizeSection'
import { OutfitCanvas } from '../src/components/OutfitCanvas'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { ToastProvider } from '../src/components/ToastProvider'
import type { Garment } from '../src/db'
import { fakeRepo } from './fixtures/fakeRepo'

const renderPng = vi.hoisted(() => vi.fn())
const shareFile = vi.hoisted(() => vi.fn())
vi.mock('../src/canvas/share', async (orig) => ({ ...(await orig<typeof import('../src/canvas/share')>()), renderOutfitPng: renderPng }))
vi.mock('../src/canvas/webShare', () => ({ shareImageFile: shareFile }))

const base: Omit<Garment, 'id' | 'category' | 'subcategory'> = {
  photo_path: null,
  colors: [],
  pattern: '',
  material: '',
  fit: 'regular',
  formality: 3,
  warmth: 2,
  occasions: [],
  is_statement: false,
  status: 'active',
  notes: '',
  created_at: '2026-01-01',
  cutout_path: null,
  cutout_kind: null,
}
const g = (id: string, category: Garment['category'], subcategory: string, extra: Partial<Garment> = {}): Garment => ({ ...base, id, category, subcategory, ...extra })
const items = [g('t', 'top', 'Playera'), g('b', 'bottom', 'Jeans'), g('s', 'shoes', 'Tenis')]

const leftOf = (name: string) => parseFloat(garment(name).style.left)

function stage() {
  return screen.getByTestId('canvas-stage')
}
function garment(name: string) {
  return stage().querySelector(`[aria-label="${name}"]`) as HTMLElement
}

beforeEach(() => {
  // 160×300 px para un viewBox de 320×600: 1 px = 2 unidades.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ x: 0, y: 0, left: 0, top: 0, right: 160, bottom: 300, width: 160, height: 300, toJSON: () => ({}) }) as DOMRect,
  )
  renderPng.mockReset()
  shareFile.mockReset()
})
afterEach(() => vi.restoreAllMocks())

function setup(props: Partial<React.ComponentProps<typeof OutfitCanvas>> = {}) {
  const onAdjustSave = vi.fn()
  const onSelectGarment = vi.fn()
  const onAdjustCancel = vi.fn()
  const onAdjustingChange = vi.fn()
  const utils = render(
    <RepositoryProvider repository={fakeRepo([])}>
      <ToastProvider>
        <OutfitCanvas items={items} onAdjustSave={onAdjustSave} onSelectGarment={onSelectGarment} onAdjustCancel={onAdjustCancel} onAdjustingChange={onAdjustingChange} {...props} />
      </ToastProvider>
    </RepositoryProvider>,
  )
  return { ...utils, onAdjustSave, onSelectGarment, onAdjustCancel, onAdjustingChange }
}

const enter = () => userEvent.click(screen.getByRole('button', { name: 'Ajustar' }))
function select(name: string) {
  fireEvent.pointerDown(garment(name), { pointerId: 1, clientX: 50, clientY: 50 })
  fireEvent.pointerUp(garment(name), { pointerId: 1, clientX: 50, clientY: 50 })
}

describe('modo Ajustar', () => {
  it('fuera del modo ajuste tocar una prenda abre el cambio (onSelectGarment); en modo ajuste solo la selecciona', async () => {
    const { onSelectGarment, onAdjustingChange } = setup()
    await userEvent.click(garment('Playera'))
    expect(onSelectGarment).toHaveBeenCalledWith('t')
    expect(stage()).not.toHaveAttribute('data-adjusting')
    await enter()
    expect(stage()).toHaveAttribute('data-adjusting')
    expect(onAdjustingChange).toHaveBeenLastCalledWith(true)
    onSelectGarment.mockClear()
    await userEvent.click(garment('Playera'))
    expect(onSelectGarment).not.toHaveBeenCalled()
    expect(garment('Playera')).toHaveAttribute('data-selected')
  })

  it('arrastrar con un dedo mueve la prenda seleccionada (píxeles → unidades del viewBox)', async () => {
    setup()
    await enter()
    const before = leftOf('Playera')
    fireEvent.pointerDown(garment('Playera'), { pointerId: 1, clientX: 80, clientY: 100 })
    expect(garment('Playera')).toHaveAttribute('data-selected')
    fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 90, clientY: 100 })
    // 10 px × (320/160) = 20 unidades = 6.25 % del ancho.
    expect(leftOf('Playera') - before).toBeCloseTo(6.25, 1)
    fireEvent.pointerUp(stage(), { pointerId: 1 })
    // Otro movimiento tras soltar no hace nada.
    fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 200, clientY: 100 })
    expect(leftOf('Playera') - before).toBeCloseTo(6.25, 1)
  })

  it('pellizcar con dos dedos cambia el tamaño de la prenda seleccionada', async () => {
    setup()
    await enter()
    select('Jeans')
    fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 60, clientY: 100 })
    fireEvent.pointerDown(stage(), { pointerId: 2, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stage(), { pointerId: 2, clientX: 140, clientY: 100 })
    // distancia 40 → 80: ×2
    expect(garment('Jeans')).toHaveAttribute('data-scale', '2')
    fireEvent.pointerMove(stage(), { pointerId: 2, clientX: 80, clientY: 100 })
    expect(Number(garment('Jeans').getAttribute('data-scale'))).toBeCloseTo(0.5, 1)
    fireEvent.pointerUp(stage(), { pointerId: 2 })
    fireEvent.pointerUp(stage(), { pointerId: 1 })
    // El pellizco no deseleccionó; un toque en el fondo sí.
    expect(garment('Jeans')).toHaveAttribute('data-selected')
    fireEvent.pointerDown(stage(), { pointerId: 3, clientX: 5, clientY: 5 })
    fireEvent.pointerUp(stage(), { pointerId: 3 })
    expect(garment('Jeans')).not.toHaveAttribute('data-selected')
  })

  it('+ / − y el control deslizante cambian el tamaño; Restablecer lo deja automático', async () => {
    setup()
    await enter()
    expect(screen.getByRole('button', { name: 'Aumentar tamaño' })).toBeDisabled()
    select('Playera')
    await userEvent.click(screen.getByRole('button', { name: 'Aumentar tamaño' }))
    expect(garment('Playera')).toHaveAttribute('data-scale', '1.05')
    await userEvent.click(screen.getByRole('button', { name: 'Reducir tamaño' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reducir tamaño' }))
    expect(garment('Playera')).toHaveAttribute('data-scale', '0.95')
    fireEvent.change(screen.getByRole('slider', { name: 'Tamaño de Playera' }), { target: { value: '150' } })
    expect(garment('Playera')).toHaveAttribute('data-scale', '1.5')
    expect(screen.getByRole('slider')).toHaveValue('150')
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer' }))
    expect(garment('Playera')).toHaveAttribute('data-scale', '1')
  })

  it('Al frente / Atrás cambian el apilado', async () => {
    setup()
    await enter()
    select('Jeans')
    const z = (n: string) => Number(garment(n).getAttribute('data-z'))
    await userEvent.click(screen.getByRole('button', { name: 'Al frente' }))
    expect(z('Jeans')).toBeGreaterThan(Math.max(z('Playera'), z('Tenis')))
    await userEvent.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(z('Jeans')).toBeLessThan(Math.min(z('Playera'), z('Tenis')))
  })

  it('el teclado mueve (flechas) y cambia el tamaño (+/−) de la prenda seleccionada', async () => {
    setup()
    await enter()
    select('Playera')
    const before = leftOf('Playera')
    fireEvent.keyDown(stage(), { key: 'ArrowRight' })
    expect(leftOf('Playera') - before).toBeCloseTo(2 / 3.2, 1)
    fireEvent.keyDown(stage(), { key: 'ArrowLeft', shiftKey: true })
    expect(leftOf('Playera') - before).toBeCloseTo(-8 / 3.2, 1)
    fireEvent.keyDown(stage(), { key: '+' })
    expect(garment('Playera')).toHaveAttribute('data-scale', '1.05')
    fireEvent.keyDown(stage(), { key: '-' })
    fireEvent.keyDown(stage(), { key: '-' })
    expect(garment('Playera')).toHaveAttribute('data-scale', '0.95')
  })

  it('Cancelar restaura el estado anterior y no guarda', async () => {
    const { onAdjustSave, onAdjustCancel, onAdjustingChange } = setup()
    await enter()
    select('Playera')
    await userEvent.click(screen.getByRole('button', { name: 'Aumentar tamaño' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(garment('Playera')).toHaveAttribute('data-scale', '1')
    expect(onAdjustSave).not.toHaveBeenCalled()
    expect(onAdjustCancel).toHaveBeenCalled()
    expect(onAdjustingChange).toHaveBeenLastCalledWith(false)
    expect(stage()).not.toHaveAttribute('data-adjusting')
  })

  it('Listo con «Este outfit» (por defecto) guarda el ajuste del outfit, no el de la prenda', async () => {
    const { onAdjustSave } = setup()
    await enter()
    expect(screen.getByRole('button', { name: 'Este outfit' })).toHaveAttribute('aria-pressed', 'true')
    select('Playera')
    await userEvent.click(screen.getByRole('button', { name: 'Aumentar tamaño' }))
    await userEvent.click(screen.getByRole('button', { name: 'Listo' }))
    expect(onAdjustSave).toHaveBeenCalledWith({ layout: { t: { scale: 1.05, dx: 0, dy: 0, z: 0 } }, garments: {} })
    expect(stage()).not.toHaveAttribute('data-adjusting')
  })

  it('Listo con «Siempre para esta prenda» entrega el ajuste de la prenda y deja el outfit intacto', async () => {
    const { onAdjustSave } = setup()
    await enter()
    select('Jeans')
    await userEvent.click(screen.getByRole('button', { name: 'Siempre para esta prenda' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aumentar tamaño' }))
    await userEvent.click(screen.getByRole('button', { name: 'Listo' }))
    expect(onAdjustSave).toHaveBeenCalledWith({ layout: null, garments: { b: { scale: 1.05, dx: 0, dy: 0 } } })
  })

  it('Listo sin cambios no guarda; Restablecer todo limpia la capa activa', async () => {
    const { onAdjustSave } = setup({ layout: { t: { scale: 1.4, dx: 0, dy: 0, z: 0 } } })
    expect(garment('Playera')).toHaveAttribute('data-scale', '1.4')
    await enter()
    await userEvent.click(screen.getByRole('button', { name: 'Listo' }))
    expect(onAdjustSave).not.toHaveBeenCalled()
    await enter()
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer todo' }))
    expect(garment('Playera')).toHaveAttribute('data-scale', '1')
    await userEvent.click(screen.getByRole('button', { name: 'Listo' }))
    expect(onAdjustSave).toHaveBeenCalledWith({ layout: null, garments: {} })
  })

  it('aplica el ajuste de la prenda (canvas_adjust) y luego el del outfit', () => {
    setup({ items: [g('t', 'top', 'Playera', { canvas_adjust: { scale: 1.2, dx: 0, dy: 0 } }), items[1]], layout: { t: { scale: 1.5, dx: 0, dy: 0, z: 0 } } })
    expect(garment('Playera')).toHaveAttribute('data-scale', '1.8')
  })

  it('el lienzo pequeño pide abrir el ajuste al anfitrión', async () => {
    const onAdjustRequest = vi.fn()
    render(
      <RepositoryProvider repository={fakeRepo([])}>
        <OutfitCanvas items={items} size="small" onAdjustRequest={onAdjustRequest} />
      </RepositoryProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Ajustar' }))
    expect(onAdjustRequest).toHaveBeenCalled()
  })
})

describe('Compartir', () => {
  it('renderiza el PNG y lo comparte', async () => {
    const blob = new Blob(['p'], { type: 'image/png' })
    renderPng.mockResolvedValue(blob)
    shareFile.mockResolvedValue('shared')
    setup({ shareable: true })
    await userEvent.click(screen.getByRole('button', { name: 'Compartir' }))
    await waitFor(() => expect(shareFile).toHaveBeenCalledWith(blob, 'outfit.png', 'Mi outfit'))
    const input = renderPng.mock.calls[0][0] as { items: { box: { id: string } }[] }
    expect(input.items.map((i) => i.box.id)).toEqual(['t', 'b', 's'])
    expect(screen.queryByText('No se pudo compartir la imagen')).toBeNull()
  })

  it('si falla muestra un aviso y no lanza', async () => {
    renderPng.mockRejectedValue(new Error('boom'))
    setup({ shareable: true })
    await userEvent.click(screen.getByRole('button', { name: 'Compartir' }))
    expect(await screen.findByText('No se pudo compartir la imagen')).toBeInTheDocument()
    shareFile.mockReset()
    renderPng.mockResolvedValue(new Blob())
    shareFile.mockRejectedValue(new Error('share'))
    await userEvent.click(screen.getByRole('button', { name: 'Compartir' }))
    await waitFor(() => expect(screen.getAllByText('No se pudo compartir la imagen').length).toBeGreaterThan(0))
  })
})

describe('GarmentSizeSection', () => {
  it('el control de tamaño guarda canvas_adjust y Restablecer lo quita', async () => {
    const repo = fakeRepo([g('x', 'bottom', 'Jeans')])
    const onChange = vi.fn()
    render(
      <RepositoryProvider repository={repo}>
        <GarmentSizeSection garment={repo.garments[0]} onChange={onChange} />
      </RepositoryProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Tamaño en el maniquí' })).toBeInTheDocument()
    const slider = screen.getByLabelText('Tamaño de la prenda en el maniquí')
    expect(screen.getByRole('button', { name: 'Restablecer' })).toBeDisabled()
    fireEvent.change(slider, { target: { value: '115' } })
    // vista previa inmediata
    expect(document.querySelector('[data-garment-id="x"]')).toHaveAttribute('data-scale', '1.15')
    await waitFor(() => expect(repo.garments[0].canvas_adjust).toEqual({ scale: 1.15, dx: 0, dy: 0 }))
    expect(onChange).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer' }))
    await waitFor(() => expect(repo.garments[0].canvas_adjust).toBeNull())
    expect(slider).toHaveValue('100')
  })
})

describe('Hoy: ajustar un outfit sugerido', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              String(input).includes('geocoding')
                ? { results: [{ name: 'Monterrey', latitude: 25.67, longitude: -100.31 }] }
                : {
                    current: { temperature_2m: 22, apparent_temperature: 22, precipitation: 0, weather_code: 1 },
                    daily: { temperature_2m_max: [26], temperature_2m_min: [17], precipitation_probability_max: [15] },
                  },
            ),
          ),
        ),
      ),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('Ajustar en la tarjeta guarda el ajuste en la fila del outfit y bloquea el carrusel mientras se ajusta', async () => {
    const repo = fakeRepo()
    render(
      <MemoryRouter initialEntries={['/']}>
        <RepositoryProvider repository={repo}>
          <App />
        </RepositoryProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sugerir outfits' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Sugerir outfits' }))
    const cards = await screen.findAllByTestId('outfit-card')
    const card = cards[0]
    expect(screen.getByTestId('outfit-carousel')).not.toHaveAttribute('data-locked')
    await userEvent.click(within(card).getByRole('button', { name: 'Ajustar' }))
    expect(screen.getByTestId('outfit-carousel')).toHaveAttribute('data-locked')
    const first = card.querySelector('.canvas-stage .canvas-garment') as HTMLElement
    fireEvent.pointerDown(first, { pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(first, { pointerId: 1 })
    await userEvent.click(within(card).getByRole('button', { name: 'Aumentar tamaño' }))
    await userEvent.click(within(card).getByRole('button', { name: 'Listo' }))
    expect(screen.getByTestId('outfit-carousel')).not.toHaveAttribute('data-locked')
    const id = first.getAttribute('data-garment-id')!
    const row = repo.saved.find((o) => o.garment_ids.includes(id))!
    await waitFor(() => expect(row.canvas_layout?.[id]?.scale).toBe(1.05))
    expect(card.querySelector(`[data-garment-id="${id}"]`)).toHaveAttribute('data-scale', '1.05')
    expect(within(card).getByRole('button', { name: 'Compartir' })).toBeInTheDocument()
  })
})

describe('Outfits guardados: Ajustar abre un lienzo grande en una hoja', () => {
  it('Listo guarda el ajuste del outfit en su fila', async () => {
    const { SavedOutfitsList } = await import('../src/components/SavedOutfitsList')
    const repo = fakeRepo(items)
    const o = await repo.outfits.create({ garment_ids: ['t', 'b', 's'], occasion: 'casual', weather_snapshot: null, reasoning: 'r', source: 'manual' })
    await repo.outfits.save(o.id, 'Mío')
    render(
      <RepositoryProvider repository={repo}>
        <ToastProvider>
          <SavedOutfitsList />
        </ToastProvider>
      </RepositoryProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Ajustar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ajustar outfit' })
    const btn = dialog.querySelector('[data-garment-id="b"]') as HTMLElement
    fireEvent.pointerDown(btn, { pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(btn, { pointerId: 1 })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aumentar tamaño' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Listo' }))
    await waitFor(() => expect(repo.saved[0].canvas_layout).toEqual({ b: { scale: 1.05, dx: 0, dy: 0, z: 0 } }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.querySelector('[data-garment-id="b"]')).toHaveAttribute('data-scale', '1.05')
  })
})
