import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { fakeRepo } from './fixtures/fakeRepo'

const LABELS = ['Hoy', 'Armario', 'Agregar', 'Comprar', 'Yo']

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RepositoryProvider repository={fakeRepo([])}>
        <App />
      </RepositoryProvider>
    </MemoryRouter>,
  )
}

describe('shell de la app', () => {
  // Hoy consulta el clima: sin red en las pruebas.
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('sin red')))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('muestra la barra con las 5 pestañas en español', () => {
    renderApp()
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('aria-label') ?? l.textContent?.replace(/[^\p{L}]/gu, ''))).toEqual(LABELS)
  })

  it('Hoy es la pantalla de inicio', () => {
    renderApp('/')
    expect(screen.getByRole('heading', { level: 1, name: 'Hoy' })).toBeInTheDocument()
  })

  it('navega a otra pestaña y muestra su título', async () => {
    renderApp('/')
    await userEvent.click(screen.getByRole('link', { name: /Yo/ }))
    expect(screen.getByRole('heading', { level: 1, name: 'Yo' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: /Ajustes/ }))
    expect(screen.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeInTheDocument()
  })

  it.each(['/yo', '/uso', '/ajustes'])('la pestaña Yo está activa en %s', (path) => {
    renderApp(path)
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    expect(within(nav).getByRole('link', { name: /Yo/ })).toHaveClass('active')
    expect(within(nav).getByRole('link', { name: /Hoy/ })).not.toHaveClass('active')
  })

  it('la pestaña Yo no está activa en Armario', () => {
    renderApp('/armario')
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    expect(within(nav).getByRole('link', { name: /Yo/ })).not.toHaveClass('active')
  })

  it('Yo enlaza a Uso y Ajustes', async () => {
    renderApp('/yo')
    expect(await screen.findByTestId('usage-headline')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Uso/ })).toHaveAttribute('href', '/uso')
    expect(screen.getByRole('link', { name: /^Ajustes/ })).toHaveAttribute('href', '/ajustes')
  })
})
