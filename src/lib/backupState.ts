import { useEffect, useState } from 'react'

export const LAST_BACKUP_KEY = 'armario.lastBackupAt'
export const BACKUP_SNOOZE_KEY = 'armario.backupSnoozeUntil'
export const SAFARI_DISMISS_KEY = 'armario.safariDismissedUntil'

const DAY_MS = 86_400_000
export const BACKUP_INTERVAL_DAYS = 7
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Sin almacenamiento: el recordatorio simplemente reaparece.
  }
  notify()
}
function readTime(key: string): number | null {
  const raw = read(key)
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : t
}

export const getLastBackupAt = () => readTime(LAST_BACKUP_KEY)
export const recordBackup = (now: Date = new Date()) => write(LAST_BACKUP_KEY, now.toISOString())
export const snoozeBackupReminder = (now: Date = new Date()) =>
  write(BACKUP_SNOOZE_KEY, new Date(now.getTime() + DAY_MS).toISOString())
export const dismissSafariBanner = (now: Date = new Date()) =>
  write(SAFARI_DISMISS_KEY, new Date(now.getTime() + 3 * DAY_MS).toISOString())

/** Se vuelve a renderizar cuando cambia algún estado de respaldo/avisos. */
export function useBackupStateVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    const l = () => setV((x) => x + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  return v
}

/** Pura: ¿toca mostrar el recordatorio semanal? */
export function shouldShowBackupReminder(opts: {
  now: Date
  garmentCount: number
  lastBackupAt: number | null
  snoozeUntil: number | null
}): boolean {
  if (opts.garmentCount < 1) return false
  if (opts.snoozeUntil !== null && opts.now.getTime() < opts.snoozeUntil) return false
  if (opts.lastBackupAt === null) return true
  return opts.now.getTime() - opts.lastBackupAt >= BACKUP_INTERVAL_DAYS * DAY_MS
}

export const getBackupSnooze = () => readTime(BACKUP_SNOOZE_KEY)
export const getSafariDismissedUntil = () => readTime(SAFARI_DISMISS_KEY)

/** "Hace N días" / "Nunca". */
export function describeLastBackup(lastBackupAt: number | null, now: Date = new Date()): string {
  if (lastBackupAt === null) return 'Nunca'
  const days = Math.floor((now.getTime() - lastBackupAt) / DAY_MS)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'hace 1 día'
  return `hace ${days} días`
}
