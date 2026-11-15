import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useOnline } from '../lib/useOnline'
import { useLocation } from 'react-router-dom'
import { exportBackupNow } from '../lib/backupActions'
import {
  dismissSafariBanner,
  getBackupSnooze,
  getLastBackupAt,
  getSafariDismissedUntil,
  shouldShowBackupReminder,
  snoozeBackupReminder,
  useBackupStateVersion,
} from '../lib/backupState'
import { detectPlatformEnv, shouldWarnSafari, type PlatformEnv } from '../lib/platform'
import { useRepository } from './RepositoryContext'

export function OfflineChip() {
  const online = useOnline()
  if (online) return null
  return (
    <div className="offline-chip" role="status">
      <WifiOff size={14} aria-hidden="true" />
      Sin conexión
    </div>
  )
}

function BackupReminder() {
  const repo = useRepository()
  const { pathname } = useLocation()
  const version = useBackupStateVersion()
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    repo.list().then(
      (list) => alive && setCount(list.length),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [repo, pathname])

  // `version` fuerza la relectura de localStorage cuando cambia el estado.
  void version
  const show = shouldShowBackupReminder({
    now: new Date(),
    garmentCount: count,
    lastBackupAt: getLastBackupAt(),
    snoozeUntil: getBackupSnooze(),
  })
  if (!show) return null

  async function backupNow() {
    setBusy(true)
    setError(null)
    try {
      await exportBackupNow()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el respaldo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="banner" role="region" aria-label="Recordatorio de respaldo">
      <strong>Haz tu respaldo semanal</strong>
      <p>Guarda una copia de tu armario en Archivos o iCloud Drive para no perderlo.</p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="banner-actions">
        <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void backupNow()}>
          Respaldar ahora
        </button>
        <button type="button" className="btn btn-small" onClick={() => snoozeBackupReminder()}>
          Recordar mañana
        </button>
      </div>
    </div>
  )
}

function SafariBanner({ env }: { env?: PlatformEnv }) {
  useBackupStateVersion()
  const current = env ?? detectPlatformEnv()
  if (!shouldWarnSafari(current)) return null
  const until = getSafariDismissedUntil()
  if (until !== null && new Date().getTime() < until) return null
  return (
    <div className="banner banner-warn" role="region" aria-label="Aviso de Safari">
      <strong>Abre Armario desde el ícono de tu pantalla de inicio.</strong>
      <p>
        En Safari, tus datos pueden borrarse tras 7 días sin uso. Toca Compartir y luego Agregar a pantalla de inicio y
        abre la app desde ese ícono.
      </p>
      <div className="banner-actions">
        <button type="button" className="btn btn-small" onClick={() => dismissSafariBanner()}>
          Entendido
        </button>
      </div>
    </div>
  )
}

/** Avisos del shell: Safari, recordatorio de respaldo y estado sin conexión. */
export function ShellBanners({ platformEnv }: { platformEnv?: PlatformEnv }) {
  return (
    <>
      <OfflineChip />
      <SafariBanner env={platformEnv} />
      <BackupReminder />
    </>
  )
}
