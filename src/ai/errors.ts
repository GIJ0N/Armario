export class AiNotConfiguredError extends Error {
  constructor(message = 'Falta la API key de Gemini.') {
    super(message)
    this.name = 'AiNotConfiguredError'
  }
}

export class AiNetworkError extends Error {
  constructor(message = 'No se pudo conectar con la IA.') {
    super(message)
    this.name = 'AiNetworkError'
  }
}

/** HTTP 429: se agotó el límite de la capa gratuita. */
export class AiRateLimitError extends Error {
  constructor(message = 'Se alcanzó el límite de uso de la IA.') {
    super(message)
    this.name = 'AiRateLimitError'
  }
}

export class AiInvalidResponseError extends Error {
  constructor(message = 'La IA devolvió una respuesta inválida.') {
    super(message)
    this.name = 'AiInvalidResponseError'
  }
}

/** HTTP 400 API_KEY_INVALID, 401 o 403. */
export class AiAuthError extends Error {
  constructor(message = 'La API key no es válida o no tiene permiso.') {
    super(message)
    this.name = 'AiAuthError'
  }
}

/** Mensaje en español para mostrar al usuario. */
export function describeAiError(e: unknown): string {
  if (e instanceof AiNotConfiguredError) return 'Falta la API key de Gemini. Agrégala en Ajustes.'
  if (e instanceof AiAuthError) return 'La API key no es válida o no tiene permiso. Revísala en Ajustes.'
  if (e instanceof AiRateLimitError) return 'Se alcanzó el límite gratuito de la IA. Intenta más tarde.'
  if (e instanceof AiNetworkError) return 'No se pudo conectar con la IA. Revisa tu conexión.'
  if (e instanceof AiInvalidResponseError) return 'La IA devolvió una respuesta que no se pudo usar.'
  return 'Ocurrió un error inesperado con la IA.'
}
