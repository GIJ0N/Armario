import { loadSettings } from '../settings'
import { GeminiProvider } from './gemini'
import { AiNotConfiguredError } from './errors'
import type { AiProvider } from './provider'

export * from './errors'
export * from './provider'
export { GeminiProvider } from './gemini'

/** Proveedor real según los ajustes; lanza AiNotConfiguredError si no hay API key. */
export function getAiProvider(): AiProvider {
  const { geminiApiKey, geminiModel } = loadSettings()
  if (!geminiApiKey.trim()) throw new AiNotConfiguredError()
  return new GeminiProvider({ apiKey: geminiApiKey, model: geminiModel })
}
