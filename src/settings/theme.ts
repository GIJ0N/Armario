import { useEffect } from 'react'
import { useSettings, type Theme } from '.'

export const THEME_LABELS: Record<Theme, string> = { neutral: 'Neutro', warm: 'Cálido' }

/** Aplica el tema elegido como `data-theme` en <html> y ajusta el color de la barra del navegador. */
export function useApplyTheme(): void {
  const [{ theme }] = useSettings()
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    // Lee el fondo ya resuelto (incluye el modo oscuro automático) para la barra de estado.
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta && bg) meta.setAttribute('content', bg)
  }, [theme])
}
