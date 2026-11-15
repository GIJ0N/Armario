import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../src/App'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { fakeRepo } from './fixtures/fakeRepo'

beforeEach(() => localStorage.clear())

describe('Ajustes: gusto', () => {
  it('muestra el perfil y «Reiniciar gusto» lo borra con confirmación, conservando las calificaciones', async () => {
    const repo = fakeRepo()
    const o = await repo.outfits.create({ garment_ids: ['top-polo-marino'], occasion: 'casual', weather_snapshot: null, reasoning: '', source: 'rules' })
    await repo.feedback.rate(o.id, 'dislike', ['too_formal'], '', new Date(Date.now() - 5000))
    await repo.taste.save('Prefiere un nivel de formalidad más bajo de lo que sugiere la ocasión.')
    render(
      <MemoryRouter initialEntries={['/ajustes']}>
        <RepositoryProvider repository={repo}>
          <App />
        </RepositoryProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('taste-summary')).toHaveTextContent('formalidad más bajo')
    expect(screen.getByTestId('taste-counts')).toHaveTextContent('Calificaciones: 1 (0 me gusta, 1 no me gusta)')
    await userEvent.click(screen.getByRole('button', { name: 'Reiniciar gusto' }))
    // Cancelar no hace nada.
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByTestId('taste-summary')).toHaveTextContent('formalidad más bajo')
    await userEvent.click(screen.getByRole('button', { name: 'Reiniciar gusto' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reiniciar' }))
    await waitFor(() => expect(screen.getByTestId('taste-summary')).toHaveTextContent('Todavía no hay un perfil de gusto'))
    expect(repo.ratings).toHaveLength(1)
    expect((await repo.taste.get())?.summary).toBe('')
  })
})
