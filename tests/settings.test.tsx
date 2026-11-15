import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MODEL, SETTINGS_STORAGE_KEY, loadSettings, saveSettings, useSettings } from '../src/settings'
import { AiNotConfiguredError } from '../src/ai/errors'
import { getAiProvider } from '../src/ai'
import { GeminiProvider } from '../src/ai/gemini'

beforeEach(() => localStorage.clear())

describe('ajustes', () => {
  it('tiene valores por defecto', () => {
    expect(loadSettings()).toMatchObject({ geminiApiKey: '', geminiModel: DEFAULT_MODEL, city: 'Monterrey' })
  })

  it('persiste en localStorage y el hook se actualiza', () => {
    const { result } = renderHook(() => useSettings())
    act(() => result.current[1]({ geminiApiKey: 'abc', city: 'Saltillo' }))
    expect(result.current[0]).toMatchObject({ geminiApiKey: 'abc', city: 'Saltillo' })
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({ geminiApiKey: 'abc' })
    expect(loadSettings().geminiModel).toBe(DEFAULT_MODEL)
  })

  it('getAiProvider exige API key', () => {
    expect(() => getAiProvider()).toThrow(AiNotConfiguredError)
    saveSettings({ geminiApiKey: 'k' })
    expect(getAiProvider()).toBeInstanceOf(GeminiProvider)
  })
})
