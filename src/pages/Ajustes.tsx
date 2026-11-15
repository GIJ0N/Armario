import { useState } from 'react'
import { z } from 'zod'
import { GeminiProvider } from '../ai/gemini'
import { AiNotConfiguredError, describeAiError } from '../ai/errors'
import { useAi } from '../ai/AiProviderContext'
import { useSettings } from '../settings'

type Probe = { kind: 'idle' } | { kind: 'running' } | { kind: 'ok' } | { kind: 'error'; message: string }

const pingSchema = z.object({ ok: z.boolean() })

export default function AjustesPage() {
  const [settings, update] = useSettings()
  const ai = useAi()
  const [show, setShow] = useState(false)
  const [probe, setProbe] = useState<Probe>({ kind: 'idle' })

  async function test() {
    setProbe({ kind: 'running' })
    try {
      if (!ai.configured) throw new AiNotConfiguredError()
      // Con proveedor inyectado se usa; si no, uno nuevo con los valores actuales.
      const provider = settings.geminiApiKey
        ? new GeminiProvider({ apiKey: settings.geminiApiKey, model: settings.geminiModel })
        : ai.getProvider()
      await provider.generateJson({
        system: 'You are a connectivity check. Respond with JSON only.',
        user: 'Return {"ok": true}.',
        schema: pingSchema,
        jsonSchema: {
          type: 'OBJECT',
          properties: { ok: { type: 'BOOLEAN' } },
          required: ['ok'],
        },
      })
      setProbe({ kind: 'ok' })
    } catch (e) {
      setProbe({ kind: 'error', message: describeAiError(e) })
    }
  }

  return (
    <section>
      <h1 className="page-title">Ajustes</h1>
      <div className="garment-form">
        <h2 className="section-title">Inteligencia artificial</h2>
        <p className="page-hint">
          Consigue una API key gratuita en{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>{' '}
          (https://aistudio.google.com/apikey). Se guarda solo en este dispositivo y no se incluye en los respaldos.
        </p>
        <label className="field">
          <span>API key de Gemini</span>
          <div className="key-row">
            <input
              type={show ? 'text' : 'password'}
              value={settings.geminiApiKey}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => update({ geminiApiKey: e.target.value.trim() })}
            />
            <button type="button" className="btn" onClick={() => setShow((s) => !s)}>
              {show ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </label>
        <label className="field">
          <span>Modelo</span>
          <input
            value={settings.geminiModel}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => update({ geminiModel: e.target.value.trim() })}
          />
        </label>
        <button type="button" className="btn" onClick={() => void test()} disabled={probe.kind === 'running'}>
          Probar conexión
        </button>
        <div aria-live="polite">
          {probe.kind === 'running' && <p className="page-hint">Probando…</p>}
          {probe.kind === 'ok' && <p className="ok-msg">Conexión correcta.</p>}
          {probe.kind === 'error' && (
            <p role="alert" className="form-error">
              {probe.message}
            </p>
          )}
        </div>

        <h2 className="section-title">Ubicación</h2>
        <label className="field">
          <span>Ciudad (para el clima)</span>
          <input value={settings.city} onChange={(e) => update({ city: e.target.value })} />
        </label>
      </div>
    </section>
  )
}
