import { unzipSync, zipSync } from 'fflate'
import { z } from 'zod'
import { localDateString } from '../lib/date'
import { MIGRATIONS } from './migrations'
import { getSqliteStatic } from './sqlite'
import type { Storage } from './storage'

/** Error con mensaje en español, listo para mostrarse en la interfaz. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

export const BACKUP_FORMAT = 1
const DB_FILE = 'armario.sqlite'
const MANIFEST_FILE = 'manifest.json'
const PHOTO_PREFIX = 'photos/'
const CUTOUT_KEY_PREFIX = 'cutout:'
/** Extensiones admitidas en photos/: fotos y recortes bbox son JPEG; los recortes con máscara son PNG (alfa). */
const EXT_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png' }

function extFor(blob: Blob): string {
  return blob.type === 'image/png' ? '.png' : '.jpg'
}

export const manifestSchema = z.object({
  app: z.literal('armario'),
  format: z.number().int(),
  schemaVersion: z.number().int().min(0),
  exportedAt: z.string(),
  garmentCount: z.number().int().min(0),
  /** Fotos originales (sin recortes). */
  photoCount: z.number().int().min(0),
  /** Recortes sin fondo (fase 10); los respaldos anteriores no lo traen. */
  cutoutCount: z.number().int().min(0).optional(),
})
export type BackupManifest = z.infer<typeof manifestSchema>

const SQLITE_MAGIC = 'SQLite format 3\u0000'

/** `user_version` está en el encabezado del archivo SQLite (offset 60, entero de 32 bits big-endian). */
function headerUserVersion(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 100) return null
  for (let i = 0; i < SQLITE_MAGIC.length; i++) if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return null
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(60, false)
}

/** Abre los bytes en una base temporal y cuenta prendas; falla si el archivo no es una base válida. */
async function inspectDb(bytes: Uint8Array): Promise<{ garmentCount: number }> {
  const sqlite3 = await getSqliteStatic()
  const db = new sqlite3.oo1.DB(':memory:', 'c')
  try {
    const ptr = sqlite3.wasm.allocFromTypedArray(bytes)
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer!,
      'main',
      ptr,
      bytes.byteLength,
      bytes.byteLength,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    )
    if (rc !== 0) throw new Error(`deserialize ${rc}`)
    const hasGarments = db.selectValue("SELECT count(*) FROM sqlite_master WHERE name = 'garments'")
    return { garmentCount: hasGarments ? Number(db.selectValue('SELECT count(*) FROM garments')) : 0 }
  } finally {
    db.close()
  }
}

export interface BackupResult {
  file: File
  filename: string
  manifest: BackupManifest
}

/** Arma el zip del respaldo: base + fotos + manifiesto. Nunca incluye ajustes ni la API key. */
export async function createBackup(storage: Storage, now: Date = new Date()): Promise<BackupResult> {
  const dbBytes = await storage.loadSnapshot()
  if (!dbBytes || dbBytes.byteLength === 0) throw new BackupError('No hay datos que respaldar todavía.')
  const stored = await storage.listPhotos()
  const photos = stored.filter((p) => !p.key.startsWith(CUTOUT_KEY_PREFIX))
  const cutouts = stored.filter((p) => p.key.startsWith(CUTOUT_KEY_PREFIX))
  const { garmentCount } = await inspectDb(dbBytes)
  const manifest: BackupManifest = {
    app: 'armario',
    format: BACKUP_FORMAT,
    schemaVersion: headerUserVersion(dbBytes) ?? 0,
    exportedAt: now.toISOString(),
    garmentCount,
    photoCount: photos.length,
    cutoutCount: cutouts.length,
  }
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    [MANIFEST_FILE]: [new TextEncoder().encode(JSON.stringify(manifest, null, 2)), { level: 6 }],
    [DB_FILE]: [dbBytes, { level: 6 }],
  }
  for (const p of stored) {
    // Las fotos (JPEG) y los recortes (PNG/JPEG) ya están comprimidos: se guardan sin recomprimir.
    files[`${PHOTO_PREFIX}${p.key}${extFor(p.blob)}`] = [new Uint8Array(await p.blob.arrayBuffer()), { level: 0 }]
  }
  const zipped = zipSync(files)
  const filename = `armario-respaldo-${localDateString(now)}.zip`
  const file = new File([zipped as BlobPart], filename, { type: 'application/zip' })
  return { file, filename, manifest }
}

/**
 * Entrega el archivo: hoja de compartir de iOS (Guardar en Archivos / iCloud Drive) si existe;
 * si no, descarga normal. Devuelve false si la persona canceló.
 */
export async function deliverBackup(file: File): Promise<boolean> {
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: file.name })
      return true
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false
    // Cualquier otro fallo de compartir: se intenta la descarga directa.
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return true
}

/** Restaura un respaldo. No toca nada hasta validar todo; antes de reemplazar guarda la base actual. */
export async function importBackup(file: Blob, storage: Storage, now: Date = new Date()): Promise<BackupManifest> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new BackupError('El archivo no es un respaldo válido (no se pudo leer el zip).')
  }
  const manifestBytes = entries[MANIFEST_FILE]
  const dbBytes = entries[DB_FILE]
  if (!manifestBytes || !dbBytes) {
    throw new BackupError('El archivo no es un respaldo de Armario (faltan archivos).')
  }
  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(new TextDecoder().decode(manifestBytes))
  } catch {
    throw new BackupError('El respaldo está dañado (manifiesto ilegible).')
  }
  const parsed = manifestSchema.safeParse(rawManifest)
  if (!parsed.success) throw new BackupError('El archivo no es un respaldo de Armario.')
  const manifest = parsed.data
  if (manifest.format !== BACKUP_FORMAT) {
    throw new BackupError('Este respaldo tiene un formato que esta versión no reconoce.')
  }
  const newer = () =>
    new BackupError('Este respaldo viene de una versión más nueva de Armario. Actualiza la app e inténtalo de nuevo.')
  if (manifest.schemaVersion > MIGRATIONS.length) throw newer()
  const headerVersion = headerUserVersion(dbBytes)
  if (headerVersion === null) throw new BackupError('El respaldo está dañado (la base de datos no es válida).')
  if (headerVersion > MIGRATIONS.length) throw newer()
  try {
    await inspectDb(dbBytes)
  } catch {
    throw new BackupError('El respaldo está dañado (la base de datos no se puede abrir).')
  }

  const photos: { key: string; blob: Blob }[] = []
  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith(PHOTO_PREFIX)) continue
    const ext = Object.keys(EXT_TYPES).find((e) => name.endsWith(e))
    if (!ext) continue
    const key = name.slice(PHOTO_PREFIX.length, -ext.length)
    if (key) photos.push({ key, blob: new Blob([data as BlobPart], { type: EXT_TYPES[ext] }) })
  }

  // Regla: nada se reemplaza sin guardar antes la base actual.
  const current = await storage.loadSnapshot()
  if (current && current.byteLength > 0) {
    await storage.saveBackupSnapshot(`pre-restore-${now.toISOString().replace(/[:.]/g, '-')}`, current)
  }
  await storage.replaceAll(dbBytes, photos)
  return manifest
}
