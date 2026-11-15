/**
 * Modelo de segmentación de objeto saliente que se descarga una sola vez en el teléfono.
 * Los pesos NO están en el repositorio. Ver «Recorte de fondo» en CLAUDE.md.
 */
export const CUTOUT_MODEL = {
  id: 'rmbg-1.4-int8',
  name: 'RMBG-1.4 (cuantizado int8)',
  url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx',
  /** Tamaño aproximado para mostrar y calcular el avance si el servidor no manda Content-Length. */
  approxBytes: 44_400_000,
  /** Menos que esto es una descarga truncada o una página de error. */
  minBytes: 30_000_000,
  /** Lado del cuadrado de entrada del modelo. */
  inputSize: 1024,
  /** Normalización: (pixel/255 - mean) / std. */
  mean: [0.5, 0.5, 0.5] as const,
  std: [1, 1, 1] as const,
  license: 'bria-rmbg-1.4 (pesos de uso no comercial; uso personal permitido)',
} as const

/** Cache Storage donde se guardan los pesos (disponible sin conexión después de la primera descarga). */
export const MODEL_CACHE_NAME = 'armario-cutout-v1'

/** Un recorte que ocupa menos de esta fracción de la imagen se considera máscara vacía. */
export const MIN_MASK_COVERAGE = 0.005

/** Tiempo máximo (carga del modelo + inferencia) antes de pasar al plan B. */
export const CUTOUT_TIMEOUT_MS = 90_000
