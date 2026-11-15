import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('Ajustes: probar conexión', () => {
  function renderAjustes() {
    localStorage.setItem('armario.settings', JSON.stringify({ geminiApiKey: 'KEY123', geminiModel: 'gemini-viejo' }))
    render(
      <MemoryRouter initialEntries={['/ajustes']}>
        <RepositoryProvider repository={fakeRepo()}>
          <App />
        </RepositoryProvider>
      </MemoryRouter>,
    )
  }
  afterEach(() => vi.unstubAllGlobals())

  it('si listModels falla muestra el mensaje y el detalle técnico', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')))
    renderAjustes()
    await userEvent.click(await screen.findByRole('button', { name: 'Probar conexión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu teléfono no pudo conectarse con Gemini')
    const detail = screen.getByTestId('probe-detail')
    expect(detail).toHaveTextContent('Detalle técnico: TypeError: Load failed (navigator.onLine=true)')
    expect(detail.textContent).not.toContain('KEY123')
  })

  it('si el modelo no aparece ofrece chips Flash y al tocar uno cambia el ajuste', async () => {
    const models = [
      { name: 'models/gemini-x-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-y-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-z-flash-embed', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-pro', supportedGenerationMethods: ['generateContent'] },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ models }), { status: 200 })))
    renderAjustes()
    await userEvent.click(await screen.findByRole('button', { name: 'Probar conexión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu key funciona, pero el modelo «gemini-viejo» no aparece.')
    expect(screen.queryByRole('button', { name: 'gemini-pro' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'gemini-z-flash-embed' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'gemini-y-flash-lite' }))
    expect(screen.getByLabelText('Modelo')).toHaveValue('gemini-y-flash-lite')
    expect(JSON.parse(localStorage.getItem('armario.settings')!).geminiModel).toBe('gemini-y-flash-lite')
  })

  it('si el modelo existe sigue con el ping y un error HTTP muestra el detalle', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'models/gemini-viejo' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'bad' } }), { status: 400 }))
    vi.stubGlobal('fetch', f)
    renderAjustes()
    await userEvent.click(await screen.findByRole('button', { name: 'Probar conexión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('La IA rechazó la solicitud (HTTP 400).')
    expect(screen.getByTestId('probe-detail')).toHaveTextContent('HTTP 400 INVALID_ARGUMENT bad')
    expect(f).toHaveBeenCalledTimes(2)
  })
})
