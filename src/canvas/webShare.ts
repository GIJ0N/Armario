export type ShareResult = 'shared' | 'downloaded' | 'cancelled'

/**
 * Comparte un PNG con la hoja de compartir del sistema (Web Share con archivos) si el navegador lo permite;
 * si no, lo descarga. Pequeño envoltorio para poder simularlo en pruebas. Lanza solo si ambas vías fallan.
 */
export async function shareImageFile(blob: Blob, filename: string, title?: string): Promise<ShareResult> {
  const file = new File([blob], filename, { type: 'image/png' })
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      // Cerrar la hoja de compartir no es un error.
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      throw e
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return 'downloaded'
}
