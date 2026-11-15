/** Lectura de imágenes del portapapeles. El lector es inyectable para las pruebas; nada aquí lanza errores. */

export interface ClipboardItemLike {
  types: readonly string[]
  getType: (type: string) => Promise<Blob>
}

export type ClipboardReader = () => Promise<ClipboardItemLike[]>

export type ClipboardImageResult =
  | { ok: true; file: File }
  | { ok: false; reason: 'empty' | 'denied' | 'error' }

export const NO_CLIPBOARD_IMAGE_MESSAGE =
  'No hay una imagen en el portapapeles. En Fotos, mantén presionada la prenda y toca Copiar.'

/** El portapapeles asíncrono con imágenes existe (Safari iOS 13.4+ y Chrome). */
export function clipboardReadSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function'
}

const defaultReader: ClipboardReader = () => navigator.clipboard.read() as unknown as Promise<ClipboardItemLike[]>

function extensionOf(type: string): string {
  return type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
}

/** Elige el primer tipo image/*, con preferencia por image/png (conserva la transparencia). */
export function pickImageType(types: readonly string[]): string | null {
  if (types.includes('image/png')) return 'image/png'
  return types.find((t) => t.startsWith('image/')) ?? null
}

/**
 * Lee la primera imagen del portapapeles. Debe llamarse de forma síncrona dentro del gesto del usuario (el lector se invoca
 * antes de cualquier `await`), para que iOS muestre la burbuja «Pegar».
 */
export async function readClipboardImage(reader: ClipboardReader = defaultReader): Promise<ClipboardImageResult> {
  try {
    const items = await reader()
    for (const item of items) {
      const type = pickImageType(item.types)
      if (!type) continue
      const blob = await item.getType(type)
      if (blob.size === 0) continue
      const mime = blob.type || type
      return { ok: true, file: new File([blob], `portapapeles.${extensionOf(mime)}`, { type: mime }) }
    }
    return { ok: false, reason: 'empty' }
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    return { ok: false, reason: name === 'NotAllowedError' ? 'denied' : 'error' }
  }
}

/** Imagen de un evento `paste` (plan B sin la API asíncrona). */
export function imageFromPasteEvent(e: { clipboardData: DataTransfer | null }): File | null {
  const data = e.clipboardData
  if (!data) return null
  const files = [...(data.files ?? [])].filter((f) => f.type.startsWith('image/'))
  const png = files.find((f) => f.type === 'image/png') ?? files[0]
  if (png) return png
  for (const item of [...(data.items ?? [])]) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) return f
    }
  }
  return null
}
