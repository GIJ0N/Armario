import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { AiProviderContextProvider } from '../src/ai/AiProviderContext'
import { AiNetworkError } from '../src/ai/errors'
import { MockAiProvider } from '../src/ai/mock'
import type { AiProvider } from '../src/ai/provider'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { simulateWithGarment, unlockedByComplement } from '../src/purchase'
import { saveSettings } from '../src/settings'
import { fakeRepo } from './fixtures/fakeRepo'
import { wardrobe30 } from './fixtures/wardrobe30'

// jsdom no decodifica imágenes: simulamos el redimensionado.
vi.mock('../src/lib/image', () => ({
  downscaleForAi: async (b: Blob) => b,
  resizeImage: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
}))

beforeEach(() => localStorage.clear())

function renderComprar(repo = fakeRepo(), ai?: AiProvider) {
  const app = (
    <RepositoryProvider repository={repo}>
      <App />
    </RepositoryProvider>
  )
  render(
    <MemoryRouter initialEntries={['/comprar']}>
      {ai ? <AiProviderContextProvider provider={ai}>{app}</AiProviderContextProvider> : app}
    </MemoryRouter>,
  )
  return repo
}

async function fillForm(o: { category: string; sub: string; colors?: string; formality: string; warmth: string; statement?: boolean }) {
  await userEvent.selectOptions(await screen.findByLabelText('Categoría *'), o.category)
  await userEvent.type(screen.getByLabelText('Subcategoría'), o.sub)
  if (o.colors) await userEvent.type(screen.getByLabelText('Colores (separados por coma)'), o.colors)
  await userEvent.selectOptions(screen.getByLabelText('Formalidad *'), o.formality)
  await userEvent.selectOptions(screen.getByLabelText('Abrigo *'), o.warmth)
  if (o.statement) await userEvent.click(screen.getByLabelText('Es prenda protagonista (llamativa)'))
  await userEvent.click(screen.getByRole('button', { name: 'Guardar y evaluar' }))
}

const chinos = { category: 'bottom', sub: 'Chinos', colors: 'azul marino', formality: '3', warmth: '2' }
const gala = { category: 'top', sub: 'Camisa de gala', colors: 'rojo', formality: '5', warmth: '2', statement: true }

describe('Comprar: evaluar una prenda', () => {
  it('sin IA: guarda la candidata, muestra veredicto verde, outfits, ejemplos y botones', async () => {
    const repo = renderComprar()
    expect(screen.queryByLabelText('Estado')).not.toBeInTheDocument() // estado fijo: candidata
    await fillForm(chinos)

    expect(await screen.findByTestId('verdict-badge')).toHaveTextContent('Cómprala')
    expect(screen.getByTestId('verdict-badge')).toHaveClass('verdict-buy')
    expect(screen.getByTestId('outfit-summary')).toHaveTextContent(/^Formaría \d+ outfits en \d+ ocasiones\.$/)
    expect(screen.getAllByTestId('occasion-chip').length).toBeGreaterThanOrEqual(2)
    const examples = screen.getAllByTestId('example-outfit')
    expect(examples.length).toBeGreaterThanOrEqual(1)
    expect(examples.length).toBeLessThanOrEqual(3)
    expect(within(examples[0]).getByText(/Chinos \(nueva\)/)).toBeInTheDocument()
    expect(screen.getByText(/Sin IA/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lo compré' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar en lista de deseos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument()

    const saved = repo.garments.find((g) => g.subcategory === 'Chinos')!
    expect(saved.status).toBe('candidate')
    const ev = await repo.purchases.latestFor(saved.id)
    expect(ev?.verdict).toBe('buy')
    expect(ev?.outfitCount).toBeGreaterThanOrEqual(5)
  })

  it('el veredicto cambia con los umbrales de Ajustes', async () => {
    saveSettings({ buyMinOccasions: 5 }) // los chinos solo forman outfits en 4 ocasiones
    renderComprar()
    await fillForm(chinos)
    expect(await screen.findByTestId('verdict-badge')).toHaveTextContent('Solo con complementos')
    expect(screen.getByTestId('verdict-badge')).toHaveClass('verdict-with_complements')
  })

  it('prenda difícil: ámbar, huecos y complementos con «desbloquea N outfits más» calculado por el motor', async () => {
    const repo = renderComprar()
    await fillForm(gala)
    expect(await screen.findByTestId('verdict-badge')).toHaveTextContent('Solo con complementos')
    const cards = screen.getAllByTestId('complement-card')
    expect(cards.length).toBeGreaterThanOrEqual(1)
    expect(cards.length).toBeLessThanOrEqual(3)
    const ev = (await repo.purchases.latestFor(repo.garments.find((g) => g.subcategory === 'Camisa de gala')!.id))!
    ev.complements.forEach((c, i) => {
      expect(c.unlocks).toBeGreaterThan(0)
      expect(cards[i]).toHaveTextContent(`desbloquea ${c.unlocks} outfit`)
      expect(cards[i]).toHaveTextContent(c.label)
    })
    expect(screen.getByRole('heading', { name: 'Qué le falta' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Huecos detectados' })).toBeInTheDocument()
  })

  it('duplicado: «No te conviene» en rojo con aviso y miniaturas', async () => {
    const repo = fakeRepo([...wardrobe30, { ...wardrobe30[0], id: 'playera-2' }])
    renderComprar(repo)
    await fillForm({ category: 'top', sub: 'playera', colors: 'blanco', formality: '2', warmth: '1' })
    expect(await screen.findByTestId('verdict-badge')).toHaveTextContent('No te conviene')
    expect(screen.getByTestId('verdict-badge')).toHaveClass('verdict-skip')
    const warning = screen.getByTestId('duplicate-warning')
    expect(warning).toHaveTextContent('Ya tienes 2 prendas parecidas')
    expect(within(warning).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByTestId('complement-card')).not.toBeInTheDocument()
  })

  it('con IA: rellena la ficha desde la foto y los complementos de la IA llevan números del motor', async () => {
    const galaTag = { category: 'top' as const, subcategory: 'camisa de gala', colors: ['rojo'], pattern: 'liso', material: '', fit: 'regular' as const, formality: 5, warmth: 2, occasions: ['formal_event' as const], is_statement: true, notes: '' }
    const ai = new MockAiProvider({
      garment: galaTag,
      json: {
        explanation: 'Te faltan zapatos de vestir muy formales. Compra en https://tienda.example.com',
        complements: [
          { category: 'shoes', subcategory: 'zapato de vestir', colors: ['negro'], formality: 5, warmth: 2, fit: 'regular', reason: 'Sube el nivel del calzado.', unlocks: 999 },
        ],
      },
    })
    const repo = renderComprar(fakeRepo(), ai)
    await userEvent.upload(await screen.findByTestId('gallery-input'), new File([new Uint8Array([1])], 'camisa.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByTestId('ai-suggested')).toBeInTheDocument()
    expect(screen.getByLabelText('Subcategoría')).toHaveValue('camisa de gala')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y evaluar' }))

    expect(await screen.findByTestId('verdict-badge')).toHaveTextContent('Solo con complementos')
    expect(ai.tagCalls).toHaveLength(1)
    expect(ai.jsonCalls).toHaveLength(1)
    expect(screen.getByTestId('explanation')).toHaveTextContent('Te faltan zapatos de vestir muy formales.')
    expect(screen.getByTestId('explanation').textContent).not.toMatch(/https?:|example/)
    const card = screen.getByTestId('complement-card')
    expect(card).toHaveTextContent('Sube el nivel del calzado.')
    const cand = repo.garments.find((g) => g.subcategory === 'camisa de gala')!
    const base = simulateWithGarment(cand, { garments: wardrobe30 })
    const real = unlockedByComplement(cand, wardrobe30, base, { category: 'shoes', subcategory: 'zapato de vestir', colors: ['negro'], formality: 5, warmth: 2, fit: 'regular' })
    expect(card).toHaveTextContent(`desbloquea ${real} outfits más`)
    expect(card).not.toHaveTextContent('999')
    expect(repo.photos).toHaveLength(1)
  })

  it('con IA que falla: sigue con reglas y avisa en español', async () => {
    const ai = new MockAiProvider({ error: new AiNetworkError('sin red') })
    renderComprar(fakeRepo(), ai)
    await fillForm(gala)
    expect(await screen.findByTestId('verdict-badge')).toHaveTextContent('Solo con complementos')
    expect(screen.getByText(/Se usó el análisis por reglas/)).toBeInTheDocument()
    expect(screen.getAllByTestId('complement-card').length).toBeGreaterThan(0)
  })
})

describe('Comprar: acciones', () => {
  it('«Lo compré» pasa la prenda a activa y aparece en Armario', async () => {
    const repo = renderComprar()
    await fillForm(chinos)
    await userEvent.click(await screen.findByRole('button', { name: 'Lo compré' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Armario' })).toBeInTheDocument()
    expect(repo.garments.find((g) => g.subcategory === 'Chinos')?.status).toBe('active')
    expect(await screen.findByText('Chinos')).toBeInTheDocument()
  })

  it('«Guardar en lista de deseos» lleva a la lista con la prenda y su veredicto', async () => {
    renderComprar()
    await fillForm(chinos)
    await userEvent.click(await screen.findByRole('button', { name: 'Guardar en lista de deseos' }))
    const list = await screen.findByRole('list', { name: 'Lista de deseos' })
    expect(within(list).getByText('Chinos')).toBeInTheDocument()
    expect(within(list).getByTestId('verdict-badge')).toHaveTextContent('Cómprala')
    expect(screen.getByRole('tab', { name: 'Lista de deseos (1)' })).toHaveAttribute('aria-selected', 'true')
  })

  it('«Descartar» pide confirmación y elimina la prenda', async () => {
    const repo = renderComprar()
    await fillForm(chinos)
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('¿Descartar esta prenda?')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(repo.garments.some((g) => g.subcategory === 'Chinos')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Descartar' }))
    await waitFor(() => expect(repo.garments.some((g) => g.subcategory === 'Chinos')).toBe(false))
    expect(await screen.findByText('Prenda descartada.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar y evaluar' })).toBeInTheDocument()
  })
})

describe('Comprar: lista de deseos', () => {
  async function wishlistRepo() {
    const repo = fakeRepo()
    const g = await repo.create({ category: 'bottom', subcategory: 'Chinos', colors: ['azul marino'], formality: 3, warmth: 2, status: 'candidate' })
    const sinEvaluar = await repo.create({ category: 'top', subcategory: 'Polo', colors: ['negro'], formality: 3, warmth: 2, status: 'candidate' })
    await repo.purchases.save({
      garmentId: g.id,
      verdict: 'skip',
      outfitCount: 0,
      gaps: ['Evaluación vieja.'],
      complements: [],
      details: { perOccasion: {}, occasionCount: 0, partnerCount: 0, duplicateIds: [], examples: [], explanation: 'Antigua.', note: '', usedAi: false },
    })
    return { repo, g, sinEvaluar }
  }

  it('lista candidatas con su último veredicto; tocar abre la evaluación guardada', async () => {
    const { repo } = await wishlistRepo()
    renderComprar(repo)
    await userEvent.click(await screen.findByRole('tab', { name: /Lista de deseos/ }))
    const list = await screen.findByRole('list', { name: 'Lista de deseos' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('Sin evaluar')).toBeInTheDocument()
    await userEvent.click(within(list).getByRole('button', { name: 'Ver evaluación de Chinos' }))
    expect(await screen.findByTestId('verdict-badge')).toHaveTextContent('No te conviene')
    expect(screen.getByText('Evaluación vieja.')).toBeInTheDocument()
  })

  it('«Reevaluar» vuelve a simular con el armario actual y guarda una evaluación nueva', async () => {
    const { repo, g } = await wishlistRepo()
    renderComprar(repo)
    await userEvent.click(await screen.findByRole('tab', { name: /Lista de deseos/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ver evaluación de Chinos' }))
    expect(await screen.findByTestId('verdict-badge')).toHaveTextContent('No te conviene')
    await userEvent.click(screen.getByRole('button', { name: 'Reevaluar' }))
    await waitFor(() => expect(screen.getByTestId('verdict-badge')).toHaveTextContent('Cómprala'))
    expect((await repo.purchases.latestFor(g.id))?.verdict).toBe('buy')
    await userEvent.click(screen.getByRole('button', { name: 'Volver a la lista' }))
    expect(await screen.findByRole('list', { name: 'Lista de deseos' })).toBeInTheDocument()
  })

  it('una candidata sin evaluar se evalúa al abrirla', async () => {
    const { repo, sinEvaluar } = await wishlistRepo()
    renderComprar(repo)
    await userEvent.click(await screen.findByRole('tab', { name: /Lista de deseos/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ver evaluación de Polo' }))
    expect(await screen.findByTestId('verdict-badge')).toBeInTheDocument()
    expect(await repo.purchases.latestFor(sinEvaluar.id)).not.toBeNull()
  })

  it('lista vacía', async () => {
    renderComprar()
    await userEvent.click(await screen.findByRole('tab', { name: /Lista de deseos/ }))
    expect(await screen.findByText(/Tu lista de deseos está vacía/)).toBeInTheDocument()
  })
})
