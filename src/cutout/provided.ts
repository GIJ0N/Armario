import { resizeImage } from '../lib/image'
import { cropRgba } from './geometry'
import { notifyCutoutChanged } from './events'
import { hasMeaningfulAlpha, providedCutoutBounds } from './providedAlpha'
import { decodeRgba, encodePng, type DecodedRgba } from './providedCanvas'
import { queueCutout } from './pipeline'
import type { BBox } from '../ai/provider'
import type { Garment, Repository } from '../db'
import type { BackgroundRemover } from './types'

/**
 * Recorte provisto: Fotos («Copiar» sobre la prenda) y Archivos («Eliminar fondo») del iPhone ya entregan un PNG con
 * transparencia. Si la imagen la trae, se usa tal cual (recorte `mask`) y no se necesita el modelo.
 */

export interface PreparedPhoto {
  /** Foto «original» reducida y aplanada sobre blanco (JPEG): para la IA y la vista Original. */
  photo: Blob
  /** PNG con alfa recortado al contenido, o null si la imagen no traía transparencia. */
  providedCutout: Blob | null
}

export interface PrepareDeps {
  decode: (blob: Blob, maxEdge: number) => Promise<DecodedRgba | null>
  encodePng: (rgba: Uint8ClampedArray, width: number, height: number) => Promise<Blob>
  flatten: (blob: Blob) => Promise<Blob>
}

/** Lado largo máximo del recorte provisto (igual que las fotos guardadas). */
const PROVIDED_MAX_EDGE = 1600

const defaultDeps: PrepareDeps = { decode: decodeRgba, encodePng, flatten: (b) => resizeImage(b) }

/** Un JPEG nunca trae transparencia: se evita decodificarlo. */
function mayHaveAlpha(file: Blob): boolean {
  return !/^image\/jpe?g$/i.test(file.type)
}

/** PNG recortado al contenido si la imagen trae transparencia significativa; si no (o si falla algo), null. Nunca lanza. */
export async function detectProvidedCutout(file: Blob, deps: Partial<PrepareDeps> = {}): Promise<Blob | null> {
  if (!mayHaveAlpha(file)) return null
  const d = { ...defaultDeps, ...deps }
  try {
    const img = await d.decode(file, PROVIDED_MAX_EDGE)
    if (!img || !hasMeaningfulAlpha(img.rgba, img.width, img.height)) return null
    const rect = providedCutoutBounds(img.rgba, img.width, img.height)
    if (!rect) return null
    return await d.encodePng(cropRgba(img.rgba, img.width, rect), rect.w, rect.h)
  } catch {
    return null
  }
}

/** Foto aplanada (camino de siempre) más, si la imagen ya viene recortada, el recorte listo para guardar. */
export async function preparePhoto(file: Blob, deps: Partial<PrepareDeps> = {}): Promise<PreparedPhoto> {
  const d = { ...defaultDeps, ...deps }
  const providedCutout = await detectProvidedCutout(file, d)
  const photo = await d.flatten(file)
  return { photo, providedCutout }
}

/** Guarda un recorte provisto como `mask` y avisa a las pantallas abiertas. */
export async function storeProvidedCutout(repo: Repository, garmentId: string, blob: Blob): Promise<Garment> {
  const updated = await repo.setCutout(garmentId, blob, 'mask')
  notifyCutoutChanged(garmentId)
  return updated
}

/**
 * Tras guardar una prenda con foto: si la imagen traía recorte se guarda directamente (sin modelo ni cola); si no, o si
 * guardarlo falla, recorte en segundo plano como siempre.
 */
export async function finishCutoutAfterSave(
  repo: Repository,
  remover: BackgroundRemover,
  garment: Garment,
  opts: { providedCutout?: Blob | null; bbox?: BBox } = {},
): Promise<void> {
  if (opts.providedCutout) {
    try {
      await storeProvidedCutout(repo, garment.id, opts.providedCutout)
      return
    } catch {
      /* cae al recorte con el modelo */
    }
  }
  void queueCutout(repo, remover, garment, opts.bbox)
}
