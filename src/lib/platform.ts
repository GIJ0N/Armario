export interface PlatformEnv {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
  standalone: boolean
}

/** iPhone/iPad, incluido iPadOS con UA de escritorio (Macintosh + pantalla táctil). */
export function isIos(env: Pick<PlatformEnv, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true
  return /Macintosh/.test(env.userAgent) && (env.maxTouchPoints ?? 0) > 1
}

/** Pura: ¿hay que avisar que se abrió desde Safari y no desde el ícono de inicio? */
export function shouldWarnSafari(env: PlatformEnv): boolean {
  return isIos(env) && !env.standalone
}

export function detectPlatformEnv(): PlatformEnv {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone,
  }
}
