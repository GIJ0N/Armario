import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { RepositoryProvider } from '../src/components/RepositoryContext'
import { BackupError } from '../src/db/backup'
import AjustesPage from '../src/pages/Ajustes'
import { describeLastBackup, shouldShowBackupReminder, LAST_BACKUP_KEY, BACKUP_SNOOZE_KEY } from '../src/lib/backupState'
import { shouldWarnSafari } from '../src/lib/platform'
import { fakeRepo } from './fixtures/fakeRepo'
import { wardrobe30 } from './fixtures/wardrobe30'

const actions = vi.hoisted(() => ({
  exportBackupNow: vi.fn(),
  restoreBackupFile: vi.fn(),
  reloadApp: vi.fn(),
}))
vi.mock('../src/lib/backupActions', () => actions)

const DAY = 86_400_000
const NOW = new Date('2026-11-14T12:00:00Z')

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('sin red')))
  Object.values(actions).forEach((f) => f.mockReset())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Ajustes → Respaldo', () => {
  it('muestra Nunca y exporta', async () => {
    actions.exportBackupNow.mockResolvedValue(true)
    render(<RepositoryProvider repository={fakeRepo()}><AjustesPage /></RepositoryProvider>)
    expect(screen.getByTestId('last-backup')).toHaveTextContent('Último respaldo: Nunca')
    await userEvent.click(screen.getByRole('button', { name: 'Exportar respaldo' }))
    expect(await screen.findByText('Respaldo listo.')).toBeInTheDocument()
  })

  it('muestra la fecha del último respaldo', () => {
    localStorage.setItem(LAST_BACKUP_KEY, new Date(Date.now() - 3 * DAY).toISOString())
    render(<RepositoryProvider repository={fakeRepo()}><AjustesPage /></RepositoryProvider>)
    expect(screen.getByTestId('last-backup')).toHaveTextContent('hace 3 días')
  })

  it('restaurar pide confirmación y recarga al terminar', async () => {
    actions.restoreBackupFile.mockResolvedValue({})
    render(<RepositoryProvider repository={fakeRepo()}><AjustesPage /></RepositoryProvider>)
    const file = new File(['x'], 'b.zip', { type: 'application/zip' })
    await userEvent.upload(screen.getByTestId('restore-input'), file)
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Esto reemplaza tu armario actual')
    expect(actions.restoreBackupFile).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar' }))
    await waitFor(() => expect(actions.reloadApp).toHaveBeenCalled())
    expect(actions.restoreBackupFile).toHaveBeenCalledWith(file)
  })

  it('cancelar no restaura y los errores salen en español', async () => {
    actions.restoreBackupFile.mockRejectedValue(new BackupError('El archivo no es un respaldo válido.'))
    render(<RepositoryProvider repository={fakeRepo()}><AjustesPage /></RepositoryProvider>)
    const file = new File(['x'], 'b.zip')
    await userEvent.upload(screen.getByTestId('restore-input'), file)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(actions.restoreBackupFile).not.toHaveBeenCalled()
    await userEvent.upload(screen.getByTestId('restore-input'), file)
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no es un respaldo válido')
    expect(actions.reloadApp).not.toHaveBeenCalled()
  })
})

describe('lógica del recordatorio', () => {
  const base = { now: NOW, garmentCount: 3, lastBackupAt: null, snoozeUntil: null }
  it('aparece sin respaldo previo o a los 7 días, y solo con prendas', () => {
    expect(shouldShowBackupReminder(base)).toBe(true)
    expect(shouldShowBackupReminder({ ...base, garmentCount: 0 })).toBe(false)
    expect(shouldShowBackupReminder({ ...base, lastBackupAt: NOW.getTime() - 6 * DAY })).toBe(false)
    expect(shouldShowBackupReminder({ ...base, lastBackupAt: NOW.getTime() - 7 * DAY })).toBe(true)
  })
  it('respeta el aplazamiento de 24 h', () => {
    expect(shouldShowBackupReminder({ ...base, snoozeUntil: NOW.getTime() + 1000 })).toBe(false)
    expect(shouldShowBackupReminder({ ...base, snoozeUntil: NOW.getTime() - 1 })).toBe(true)
  })
  it('describe el último respaldo', () => {
    expect(describeLastBackup(null, NOW)).toBe('Nunca')
    expect(describeLastBackup(NOW.getTime() - DAY, NOW)).toBe('hace 1 día')
  })
})

describe('banner de respaldo en el shell', () => {
  function renderApp(garments = wardrobe30) {
    return render(
      <MemoryRouter initialEntries={['/armario']}>
        <RepositoryProvider repository={fakeRepo(garments)}>
          <App />
        </RepositoryProvider>
      </MemoryRouter>,
    )
  }

  it('aparece, y "Recordar mañana" lo oculta 24 h', async () => {
    renderApp()
    expect(await screen.findByText('Haz tu respaldo semanal')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Recordar mañana' }))
    expect(screen.queryByText('Haz tu respaldo semanal')).not.toBeInTheDocument()
    const until = Date.parse(localStorage.getItem(BACKUP_SNOOZE_KEY)!)
    expect(until - Date.now()).toBeGreaterThan(23 * 3600_000)
  })

  it('no aparece con un respaldo reciente ni con el armario vacío', async () => {
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString())
    renderApp()
    await screen.findByRole('heading', { name: 'Armario' })
    expect(screen.queryByText('Haz tu respaldo semanal')).not.toBeInTheDocument()
  })

  it('no aparece con el armario vacío', async () => {
    renderApp([])
    await screen.findByRole('heading', { name: 'Armario' })
    expect(screen.queryByText('Haz tu respaldo semanal')).not.toBeInTheDocument()
  })

  it('"Respaldar" exporta', async () => {
    actions.exportBackupNow.mockResolvedValue(true)
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Respaldar' }))
    expect(actions.exportBackupNow).toHaveBeenCalled()
  })

  it('chip Sin conexión según online/offline', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Armario' })
    expect(screen.queryByText('Sin conexión')).not.toBeInTheDocument()
    window.dispatchEvent(new Event('offline'))
    expect(await screen.findByText('Sin conexión')).toBeInTheDocument()
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(screen.queryByText('Sin conexión')).not.toBeInTheDocument())
  })

  it('banner de Safari solo si se fuerza un entorno iOS no instalado', async () => {
    render(
      <MemoryRouter initialEntries={['/armario']}>
        <RepositoryProvider repository={fakeRepo([])}>
          <App platformEnv={{ userAgent: 'iPhone', standalone: false }} />
        </RepositoryProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/Abre Armario desde el ícono/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Entendido' }))
    expect(screen.queryByText(/Abre Armario desde el ícono/)).not.toBeInTheDocument()
  })
})

describe('detección de Safari', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'
  const ipadDesktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
  it('avisa en iPhone/iPad no instalados', () => {
    expect(shouldWarnSafari({ userAgent: iphone, standalone: false })).toBe(true)
    expect(shouldWarnSafari({ userAgent: ipadDesktop, maxTouchPoints: 5, standalone: false })).toBe(true)
  })
  it('no avisa instalado, ni en escritorio', () => {
    expect(shouldWarnSafari({ userAgent: iphone, standalone: true })).toBe(false)
    expect(shouldWarnSafari({ userAgent: ipadDesktop, maxTouchPoints: 0, standalone: false })).toBe(false)
    expect(shouldWarnSafari({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130', standalone: false })).toBe(false)
  })
})
