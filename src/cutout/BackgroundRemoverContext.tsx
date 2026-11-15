import { createContext, useContext, type ReactNode } from 'react'
import { OnnxBackgroundRemover } from './onnxRemover'
import type { BackgroundRemover } from './types'

// eslint-disable-next-line react-refresh/only-export-components
export const BackgroundRemoverContext = createContext<BackgroundRemover | null>(null)

/** Permite inyectar un quitafondos (p. ej. el simulado en pruebas). */
export function BackgroundRemoverContextProvider({ remover, children }: { remover: BackgroundRemover; children: ReactNode }) {
  return <BackgroundRemoverContext.Provider value={remover}>{children}</BackgroundRemoverContext.Provider>
}

let shared: BackgroundRemover | null = null

/** Instancia única del quitafondos real; no carga nada hasta que se use. */
// eslint-disable-next-line react-refresh/only-export-components
export function getBackgroundRemover(): BackgroundRemover {
  shared ??= new OnnxBackgroundRemover()
  return shared
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBackgroundRemover(): BackgroundRemover {
  return useContext(BackgroundRemoverContext) ?? getBackgroundRemover()
}
