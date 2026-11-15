/** Lado largo de la foto guardada (fase 10: 1600 para que el recorte conserve detalle). */
export const MAX_EDGE = 1600
/** Lado largo máximo de la imagen que se envía a Gemini. */
export const AI_MAX_EDGE = 1024
export const JPEG_QUALITY = 0.8

export function fitWithin(width: number, height: number, max = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Reduce una imagen a `maxEdge` px de lado largo (1600 por defecto) y la codifica como JPEG ~0.8. Depende del decodificador del navegador (HEIC en Safari). */
export async function resizeImage(file: Blob, maxEdge = MAX_EDGE): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('No se pudo leer la imagen. Prueba con otra foto (JPEG o PNG).')
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No se pudo procesar la imagen.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob) throw new Error('No se pudo procesar la imagen.')
    return blob
  } finally {
    bitmap.close()
  }
}

/** Copia de la foto a ≤1024 px para enviarla a la IA. Si no se puede reducir (p. ej. sin decodificador), devuelve la original. */
export async function downscaleForAi(photo: Blob): Promise<Blob> {
  try {
    return await resizeImage(photo, AI_MAX_EDGE)
  } catch {
    return photo
  }
}
