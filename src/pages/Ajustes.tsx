import { useEffect, useState } from 'react'
import { z } from 'zod'
import { GeminiProvider } from '../ai/gemini'
import { AiNotConfiguredError, describeAiError } from '../ai/errors'
import { useAi } from '../ai/AiProviderContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useRepository } from '../components/RepositoryContext'
import type { Repository } from '../db'
import { useSettings } from '../settings'

type Probe = { kind: 'idle' } | { kind: 'running' } | { kind: 'ok' } | { kind: 'error'; message: string }

interface TasteView {
  summary: string
  likes: number
  dislikes: number
}

async function fetchTaste(repo: Repository): Promise<TasteView | null> {
  try {
    const [profile, recent] = await Promise.all([repo.taste.get(), repo.feedback.listRecent(1000)])
    const active = profile?.resetAt ? recent.filter((e) => e.createdAt > profile.resetAt) : recent
    return {
      summary: profile?.summary ?? '',
      likes: active.filter((e) => e.rating === 'like').length,
      dislikes: active.filter((e) => e.rating === 'dislike').length,
    }
  } catch {
    return null
  }
}

const pingSchema = z.object({ ok: z.boolean() })

export default function AjustesPage() {
  const [settings, update] = useSettings()
  const ai = useAi()
  const repo = useRepository()
  const [taste, setTaste] = useState<TasteView | null>(null)
  const [resetting, setResetting] = useState(false)
  const [show, setShow] = useState(false)
  const [probe, setProbe] = useState<Probe>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false
    void fetchTaste(repo).then((t) => !cancelled && setTaste(t))
    return () => {
      cancelled = true
    }
  }, [repo])

  async function resetTaste() {
    setResetting(false)
    await repo.taste.reset()
    setTaste(await fetchTaste(repo))
  }

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

        <h2 className="section-title">Gusto</h2>
        {taste && (
          <>
            <p className="taste-summary" data-testid="taste-summary">
              {taste.summary || 'Todavía no hay un perfil de gusto. Se crea después de 10 calificaciones nuevas.'}
            </p>
            <p className="page-hint" data-testid="taste-counts">
              Calificaciones: {taste.likes + taste.dislikes} ({taste.likes} me gusta, {taste.dislikes} no me gusta)
            </p>
            <button
              type="button"
              className="btn"
              disabled={taste.likes + taste.dislikes === 0 && !taste.summary}
              onClick={() => setResetting(true)}
            >
              Reiniciar gusto
            </button>
          </>
        )}
      </div>
      {resetting && (
        <ConfirmDialog
          title="¿Reiniciar tu gusto?"
          message="Se borrará el perfil de gusto y dejarán de influir las calificaciones anteriores. Tus calificaciones se conservan."
          confirmLabel="Reiniciar"
          onConfirm={() => void resetTaste()}
          onCancel={() => setResetting(false)}
        />
      )}
    </section>
  )
}
