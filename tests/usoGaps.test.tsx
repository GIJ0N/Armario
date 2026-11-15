import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AiProviderContextProvider } from '../src/ai/AiProviderContext'
import { MockAiProvider } from '../src/ai/mock'
import type { AiProvider } from '../src/ai/provider'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import UsoPage from '../src/pages/Uso'
import { computeWardrobeGaps } from '../src/purchase'
import { fakeRepo } from './fixtures/fakeRepo'
import { wardrobe30 } from './fixtures/wardrobe30'

beforeEach(() => localStorage.clear())

function renderUso(repo = fakeRepo(), ai?: AiProvider) {
  const page = (
    <RepositoryProvider repository={repo}>
      <UsoPage />
    </RepositoryProvider>
  )
  render(<MemoryRouter>{ai ? <AiProviderContextProvider provider={ai}>{page}</AiProviderContextProvider> : page}</MemoryRouter>)
}

describe('Uso: Qué le falta a mi armario', () => {
  it('no calcula nada hasta tocar «Calcular»; luego muestra 3 sugerencias con números del motor', async () => {
    renderUso()
    expect(await screen.findByRole('heading', { name: 'Qué le falta a mi armario' })).toBeInTheDocument()
    expect(screen.queryByTestId('wardrobe-gap')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Calcular' }))
    const items = await screen.findAllByTestId('wardrobe-gap')
    expect(items).toHaveLength(3)
    const expected = computeWardrobeGaps(wardrobe30)
    items.forEach((li, i) => {
      expect(li).toHaveTextContent(expected[i].label)
      expect(li).toHaveTextContent(`desbloquearía ${expected[i].unlocks} outfits nuevos`)
    })
    expect(screen.getByRole('button', { name: 'Volver a calcular' })).toBeEnabled()
  })

  it('con IA agrega frases pero conserva los números del motor', async () => {
    const ai = new MockAiProvider({ json: { phrases: ['Una chamarra te da más capas.', 'Mocasines suben el nivel.', 'Un chino llena el hueco.'], unlocks: [1, 1, 1] } })
    renderUso(fakeRepo(), ai)
    await userEvent.click(await screen.findByRole('button', { name: 'Calcular' }))
    const items = await screen.findAllByTestId('wardrobe-gap')
    expect(items[0]).toHaveTextContent('Una chamarra te da más capas.')
    expect(ai.jsonCalls).toHaveLength(1)
    const expected = computeWardrobeGaps(wardrobe30)
    expect(items[0]).toHaveTextContent(`desbloquearía ${expected[0].unlocks} outfits nuevos`)
  })

  it('sin prendas activas sugiere agregar prendas', async () => {
    renderUso(fakeRepo([]))
    await userEvent.click(await screen.findByRole('button', { name: 'Calcular' }))
    expect(await screen.findByText(/Agrega prendas activas/)).toBeInTheDocument()
    expect(within(screen.getByTestId('wardrobe-gaps')).queryByTestId('wardrobe-gap')).not.toBeInTheDocument()
  })
})
