import { createContext, useContext, type ReactNode } from 'react'
import { useSettings } from '../settings'
import { getAiProvider } from './index'
import type { AiProvider } from './provider'

// eslint-disable-next-line react-refresh/only-export-components
export const AiProviderContext = createContext<AiProvider | null>(null)

/** Permite inyectar un proveedor (p. ej. el simulado en pruebas). */
export function AiProviderContextProvider({
  provider,
  children,
}: {
  provider: AiProvider
  children: ReactNode
}) {
  return <AiProviderContext.Provider value={provider}>{children}</AiProviderContext.Provider>
}

export interface AiAccess {
  /** false si no hay proveedor inyectado ni API key guardada. */
  configured: boolean
  /** Lanza AiNotConfiguredError si no está configurado. */
  getProvider: () => AiProvider
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAi(): AiAccess {
  const injected = useContext(AiProviderContext)
  const [settings] = useSettings()
  if (injected) return { configured: true, getProvider: () => injected }
  return { configured: settings.geminiApiKey.trim().length > 0, getProvider: getAiProvider }
}
