import { createBackup, deliverBackup, importBackup, type BackupManifest } from '../db/backup'
import { getStorage } from '../db'
import { recordBackup } from './backupState'

/** Exporta y entrega el respaldo; registra la fecha solo si se completó. Devuelve false si se canceló. */
export async function exportBackupNow(): Promise<boolean> {
  const { file } = await createBackup(getStorage())
  const delivered = await deliverBackup(file)
  if (delivered) recordBackup()
  return delivered
}

export function restoreBackupFile(file: Blob): Promise<BackupManifest> {
  return importBackup(file, getStorage())
}

export function reloadApp() {
  window.location.reload()
}
