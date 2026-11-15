import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../src/App'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { loadSettings, saveSettings, SETTINGS_STORAGE_KEY } from '../src/settings'
import { fakeRepo } from './fixtures/fakeRepo'

beforeEach(() => localStorage.clear())

describe('Ajustes: evaluador de compras', () => {
  it('muestra los umbrales por defecto y los guarda en localStorage', async () => {
    render(
      <MemoryRouter initialEntries={['/ajustes']}>
        <RepositoryProvider repository={fakeRepo()}>
          <App />
        </RepositoryProvider>
      </MemoryRouter>,
    )
    const outfits = await screen.findByLabelText('Outfits mínimos para «Cómprala»')
    const occasions = screen.getByLabelText('Ocasiones mínimas para «Cómprala»')
    expect(outfits).toHaveValue(5)
    expect(occasions).toHaveValue(2)
    await userEvent.clear(outfits)
    await userEvent.type(outfits, '8')
    await userEvent.clear(occasions)
    await userEvent.type(occasions, '3')
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({ buyMinOutfits: 8, buyMinOccasions: 3 })
    expect(loadSettings()).toMatchObject({ buyMinOutfits: 8, buyMinOccasions: 3 })
  })

  it('valores inválidos guardados vuelven a los predeterminados', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ buyMinOutfits: 0, buyMinOccasions: 'x' }))
    expect(loadSettings()).toMatchObject({ buyMinOutfits: 5, buyMinOccasions: 2 })
    saveSettings({ buyMinOutfits: 12 })
    expect(loadSettings().buyMinOutfits).toBe(12)
  })
})
