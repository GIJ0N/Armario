import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutfitCanvas } from '../src/components/OutfitCanvas'
import { OutfitVisual } from '../src/components/OutfitVisual'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import type { Garment } from '../src/db'
import { fakeRepo } from './fixtures/fakeRepo'

const base: Omit<Garment, 'id' | 'category' | 'subcategory' | 'photo_path'> = {
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
}

const g = (id: string, category: Garment['category'], subcategory: string, extra: Partial<Garment> = {}): Garment => ({
  ...base,
  id,
  category,
  subcategory,
  photo_path: null,
  cutout_path: null,
  cutout_kind: null,
  ...extra,
})

const garments = [
  g('t', 'top', 'Playera', { photo_path: 'photo:t', cutout_path: 'cutout:t', cutout_kind: 'mask' }),
  g('b', 'bottom', 'Jeans', { photo_path: 'photo:b', cutout_path: 'cutout:b', cutout_kind: 'bbox' }),
  g('s', 'shoes', 'Tenis', { photo_path: 'photo:s' }),
  g('c', 'accessory', 'Gorra'),
]

function renderWith(ui: React.ReactElement) {
  const repo = { ...fakeRepo(), getPhoto: async () => new Blob(['x'], { type: 'image/png' }) }
  return render(<RepositoryProvider repository={repo}>{ui}</RepositoryProvider>)
}

beforeEach(() => {
  URL.createObjectURL = vi.fn((b: Blob) => `blob:${b.size}-${Math.random()}`)
  URL.revokeObjectURL = vi.fn()
})

describe('OutfitCanvas', () => {
  it('muestra un botón por prenda sobre el lienzo y una etiqueta por prenda', async () => {
    const { container } = renderWith(<OutfitCanvas items={garments} />)
    const stage = container.querySelector('.canvas-stage') as HTMLElement
    expect(stage.querySelectorAll('button.canvas-garment')).toHaveLength(4)
    for (const name of ['Playera', 'Jeans', 'Tenis', 'Gorra']) {
      expect(screen.getAllByRole('button', { name })).toHaveLength(2) // lienzo + etiqueta
    }
    expect(screen.getByRole('list', { name: 'Prendas del outfit' }).children).toHaveLength(4)
  })

  it('el recorte con máscara es un <img> sin marco; bbox, original y sin foto usan mosaico enmarcado', async () => {
    const { container } = renderWith(<OutfitCanvas items={garments} />)
    await waitFor(() => expect(container.querySelector('img.canvas-cutout')).toBeInTheDocument())
    const stage = container.querySelector('.canvas-stage') as HTMLElement
    const tee = stage.querySelector('[aria-label="Playera"]')!
    expect(tee.querySelector('img.canvas-cutout')).toBeInTheDocument()
    expect(tee.querySelector('.canvas-tile')).toBeNull()
    for (const name of ['Jeans', 'Tenis']) {
      const btn = stage.querySelector(`[aria-label="${name}"]`)!
      await waitFor(() => expect(btn.querySelector('.canvas-tile img')).toBeInTheDocument())
      expect(btn.querySelector('img.canvas-cutout')).toBeNull()
    }
    const cap = stage.querySelector('[aria-label="Gorra"]')!
    expect(cap.querySelector('.canvas-tile svg')).toBeInTheDocument()
    expect(cap.querySelector('img')).toBeNull()
  })

  it('onSelectGarment se llama con el id al tocar la prenda o su etiqueta', async () => {
    const onSelect = vi.fn()
    renderWith(<OutfitCanvas items={garments} onSelectGarment={onSelect} newId="c" />)
    const [onCanvas, chip] = screen.getAllByRole('button', { name: /^Jeans/ })
    await userEvent.click(onCanvas)
    expect(onSelect).toHaveBeenLastCalledWith('b')
    await userEvent.click(screen.getByRole('button', { name: 'Gorra (nueva)' }))
    expect(onSelect).toHaveBeenLastCalledWith('c')
    await userEvent.click(chip)
    expect(onSelect).toHaveBeenCalledTimes(3)
  })

  it('sin onSelectGarment tocar no hace nada ni falla', async () => {
    renderWith(<OutfitCanvas items={garments} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Tenis' })[0])
  })
})

describe('OutfitVisual', () => {
  it('usa el lienzo si hay prenda de arriba o de abajo', () => {
    const { container } = renderWith(<OutfitVisual items={garments} />)
    expect(container.querySelector('.outfit-canvas')).toBeInTheDocument()
  })
  it('sin arriba ni abajo vuelve a la cuadrícula', () => {
    const { container } = renderWith(<OutfitVisual items={[garments[2], garments[3]]} />)
    expect(container.querySelector('.outfit-canvas')).toBeNull()
    expect(container.querySelector('ul.outfit-visual')).toBeInTheDocument()
    expect(screen.getByText('Tenis')).toBeInTheDocument()
  })
})
