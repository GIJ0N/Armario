export class AiNotConfiguredError extends Error {
  constructor(message = 'Falta la API key de Gemini.') {
    super(message)
    this.name = 'AiNotConfiguredError'
  }
}

/** Información técnica opcional (sin la API key) para que el usuario pueda mostrarla en una captura. */
export type AiErrorDetail = string | undefined

/** `timeout`: se agotó el tiempo; `fetch`: fetch lanzó una excepción; `offline`: navigator.onLine es false; `http`: HTTP 5xx. */
export type AiNetworkKind = 'timeout' | 'fetch' | 'offline' | 'http' | 'other'

export class AiNetworkError extends Error {
  readonly detail: AiErrorDetail
  readonly kind: AiNetworkKind
  constructor(message = 'No se pudo conectar con la IA.', detail?: string, kind: AiNetworkKind = 'other') {
    super(message)
    this.name = 'AiNetworkError'
    this.detail = detail
    this.kind = kind
  }
}

/** HTTP 429: se agotó el límite de la capa gratuita. */
export class AiRateLimitError extends Error {
  readonly detail: AiErrorDetail
  constructor(message = 'Se alcanzó el límite de uso de la IA.', detail?: string) {
    super(message)
    this.detail = detail
    this.name = 'AiRateLimitError'
  }
}

export class AiInvalidResponseError extends Error {
  readonly detail: AiErrorDetail
  constructor(message = 'La IA devolvió una respuesta inválida.', detail?: string) {
    super(message)
    this.detail = detail
    this.name = 'AiInvalidResponseError'
  }
}

/** HTTP 404: el modelo configurado no existe o no está disponible para la key. */
export class AiModelNotFoundError extends Error {
  readonly detail: AiErrorDetail
  constructor(model: string, detail?: string) {
    super(`El modelo «${model}» no existe o no está disponible para tu key. Prueba con otro modelo.`)
    this.name = 'AiModelNotFoundError'
    this.detail = detail
  }
}

/** HTTP 400 API_KEY_INVALID, 401 o 403. */
export class AiAuthError extends Error {
  readonly detail: AiErrorDetail
  constructor(message = 'La API key no es válida o no tiene permiso.', detail?: string) {
    super(message)
    this.detail = detail
    this.name = 'AiAuthError'
  }
}

/** Mensaje en español para mostrar al usuario. */
export function describeAiError(e: unknown): string {
  if (e instanceof AiNotConfiguredError) return 'Falta la API key de Gemini. Agrégala en Ajustes.'
  if (e instanceof AiAuthError) return 'La API key no es válida o no tiene permiso. Revísala en Ajustes.'
  if (e instanceof AiRateLimitError) return 'Se alcanzó el límite gratuito de la IA. Intenta más tarde.'
  if (e instanceof AiModelNotFoundError) return e.message
  if (e instanceof AiNetworkError) {
    if (e.kind === 'timeout') return 'La IA tardó más de 45 s en responder.'
    if (e.kind === 'offline') return 'Sin conexión a internet.'
    if (e.kind === 'fetch') {
      return 'Tu teléfono no pudo conectarse con Gemini (posible bloqueo por VPN, bloqueador de anuncios, Relay privado o la red). Revisa y vuelve a intentar.'
    }
    if (e.kind === 'http') return e.message
    return 'No se pudo conectar con la IA. Revisa tu conexión.'
  }
  if (e instanceof AiInvalidResponseError) return e.message.startsWith('La IA rechazó') ? e.message : 'La IA devolvió una respuesta que no se pudo usar.'
  return 'Ocurrió un error inesperado con la IA.'
}

/** Detalle técnico del error, si lo tiene. */
export function aiErrorDetail(e: unknown): string | undefined {
  if (e instanceof Error && 'detail' in e && typeof (e as { detail?: unknown }).detail === 'string') {
    return (e as { detail: string }).detail || undefined
  }
  return undefined
}
