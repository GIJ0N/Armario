import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../src/App'

const LABELS = ['Hoy', 'Armario', 'Agregar', 'Comprar', 'Uso', 'Ajustes']

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('shell de la app', () => {
  it('muestra la barra con las 6 pestañas en español', () => {
    renderApp()
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((l) => l.textContent?.replace(/[^\p{L}]/gu, ''))).toEqual(LABELS)
  })

  it('Hoy es la pantalla de inicio', () => {
    renderApp('/')
    expect(screen.getByRole('heading', { level: 1, name: 'Hoy' })).toBeInTheDocument()
  })

  it('navega a otra pestaña y muestra su título', async () => {
    renderApp('/')
    await userEvent.click(screen.getByRole('link', { name: /Ajustes/ }))
    expect(screen.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeInTheDocument()
  })
})
