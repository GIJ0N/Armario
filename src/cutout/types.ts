/** Motor que produjo un recorte. 'bbox' = plan B (recorte rectangular con el cuadro de la IA, sin modelo). */
export type CutoutEngine = 'webgpu' | 'wasm' | 'bbox'

export interface DownloadProgress {
  loaded: number
  total: number
  /** 0–1 */
  fraction: number
}

export type CutoutErrorCode = 'not-downloaded' | 'timeout' | 'cancelled' | 'empty-mask' | 'failed'

/** Error del recorte con mensaje en español, listo para la interfaz. */
export class CutoutError extends Error {
  readonly code: CutoutErrorCode
  constructor(code: CutoutErrorCode, message: string) {
    super(message)
    this.name = 'CutoutError'
    this.code = code
  }
}

/** Quita el fondo de una foto. La implementación real corre un modelo ONNX en el dispositivo; las pruebas usan MockBackgroundRemover. */
export interface BackgroundRemover {
  /** true si los pesos del modelo ya están guardados en el teléfono (no usa la red). */
  isDownloaded(): Promise<boolean>
  /**
   * Deja el modelo listo: lo descarga si falta (solo se llama desde el botón «Descargar modelo») y crea la sesión.
   * `onProgress` recibe el avance de la descarga.
   */
  ready(onProgress?: (p: DownloadProgress) => void): Promise<void>
  /**
   * Devuelve la prenda con fondo transparente (PNG), recortada al contenido con un margen pequeño.
   * Nunca descarga el modelo: lanza CutoutError('not-downloaded') si falta.
   */
  remove(image: Blob): Promise<Blob>
  /** Motor usado en la última llamada a remove (webgpu / wasm). */
  readonly lastEngine: Exclude<CutoutEngine, 'bbox'> | null
  /** Libera el worker (p. ej. tras un tiempo límite o al cambiar de motor). */
  dispose?(): void
}
