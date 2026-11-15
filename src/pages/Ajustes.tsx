import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { GeminiProvider } from '../ai/gemini'
import { AiNotConfiguredError, aiErrorDetail, describeAiError } from '../ai/errors'
import { useAi } from '../ai/AiProviderContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useRepository } from '../components/RepositoryContext'
import type { Repository } from '../db'
import { BackupError } from '../db/backup'
import { exportBackupNow, reloadApp, restoreBackupFile } from '../lib/backupActions'
import { describeLastBackup, getLastBackupAt, useBackupStateVersion } from '../lib/backupState'
import { useSettings, THEMES, type Theme } from '../settings'
import { THEME_LABELS } from '../settings/theme'

type Probe =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string; detail?: string }
  | { kind: 'missingModel'; model: string; flash: string[] }

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

/** Entero ≥ 1: se puede borrar y reescribir; solo se guardan valores válidos y al salir se restaura el guardado. */
function IntSetting({ label, value, max, onCommit }: { label: string; value: number; max: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Math.floor(Number(e.target.value))
          if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= 1) onCommit(Math.min(n, max))
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
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

  const backupVersion = useBackupStateVersion()
  const [exporting, setExporting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [backupMsg, setBackupMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    const p = navigator.storage?.persisted?.()
    p?.then(
      (v) => alive && setPersisted(v),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])

  // `backupVersion` fuerza la relectura de la fecha del último respaldo.
  void backupVersion
  const lastBackup = describeLastBackup(getLastBackupAt())

  async function exportBackup() {
    setExporting(true)
    setBackupMsg(null)
    try {
      if (await exportBackupNow()) setBackupMsg({ kind: 'ok', text: 'Respaldo listo.' })
    } catch (e) {
      setBackupMsg({ kind: 'error', text: e instanceof Error ? e.message : 'No se pudo crear el respaldo.' })
    } finally {
      setExporting(false)
    }
  }

  async function restore(file: File) {
    setPendingFile(null)
    setRestoring(true)
    setBackupMsg(null)
    try {
      await restoreBackupFile(file)
      reloadApp()
    } catch (e) {
      setRestoring(false)
      setBackupMsg({
        kind: 'error',
        text: e instanceof BackupError ? e.message : 'No se pudo restaurar el respaldo. Tus datos actuales no cambiaron.',
      })
    }
  }

  async function test() {
    setProbe({ kind: 'running' })
    try {
      if (!ai.configured) throw new AiNotConfiguredError()
      // Con proveedor inyectado se usa; si no, uno nuevo con los valores actuales.
      const provider = settings.geminiApiKey
        ? new GeminiProvider({ apiKey: settings.geminiApiKey, model: settings.geminiModel })
        : ai.getProvider()
      if (provider instanceof GeminiProvider) {
        // Primero se distingue red / key / modelo con un GET que no genera contenido.
        const models = await provider.listModels()
        if (!models.some((m) => m.id === settings.geminiModel)) {
          const flash = models
            .filter((m) => m.supportsGenerateContent && m.id.includes('flash'))
            .map((m) => m.id)
            .slice(0, 5)
          setProbe({ kind: 'missingModel', model: settings.geminiModel, flash })
          return
        }
      }
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
      setProbe({ kind: 'error', message: describeAiError(e), detail: aiErrorDetail(e) })
    }
  }

  return (
    <section>
      <h1 className="page-title">Ajustes</h1>
      <div className="garment-form">
        <h2 className="section-title">Apariencia</h2>
        <div className="swatches" role="group" aria-label="Tema de color">
          {THEMES.map((t: Theme) => (
            <button
              key={t}
              type="button"
              className="swatch"
              aria-pressed={settings.theme === t}
              onClick={() => update({ theme: t })}
            >
              <span className="swatch-preview" data-swatch={t} aria-hidden="true">
                <i />
                <b />
                <em />
              </span>
              <span className="swatch-label">
                {THEME_LABELS[t]}
                {settings.theme === t && <Check size={18} aria-hidden="true" />}
              </span>
            </button>
          ))}
        </div>
        <p className="page-hint">El modo oscuro se activa solo según tu iPhone.</p>
        <h2 className="section-title">Inteligencia artificial</h2>
        <p className="page-hint">
          Key gratuita en{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>
          ; se guarda solo en este dispositivo.
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
          {probe.kind === 'error' && probe.detail && (
            <p
              className="page-hint"
              data-testid="probe-detail"
              style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.75rem', userSelect: 'text', WebkitUserSelect: 'text', wordBreak: 'break-all' }}
            >
              Detalle técnico: {probe.detail}
            </p>
          )}
          {probe.kind === 'missingModel' && (
            <>
              <p role="alert" className="form-error">
                Tu key funciona, pero el modelo «{probe.model}» no aparece.
                {probe.flash.length > 0 ? ' Modelos Flash disponibles:' : ' No hay modelos Flash disponibles para generar contenido.'}
              </p>
              {probe.flash.length > 0 && (
                <div className="chip-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {probe.flash.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="btn"
                      onClick={() => {
                        update({ geminiModel: id })
                        setProbe({ kind: 'idle' })
                      }}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <h2 className="section-title">Ubicación</h2>
        <label className="field">
          <span>Ciudad (para el clima)</span>
          <input value={settings.city} onChange={(e) => update({ city: e.target.value })} />
        </label>

        <h2 className="section-title">Evaluador de compras</h2>
        <p className="page-hint">
          «Cómprala» exige al menos estos outfits en al menos estas ocasiones; con menos sale «Solo con complementos».
        </p>
        <IntSetting
          label="Outfits mínimos para «Cómprala»"
          value={settings.buyMinOutfits}
          max={99}
          onCommit={(n) => update({ buyMinOutfits: n })}
        />
        <IntSetting
          label="Ocasiones mínimas para «Cómprala»"
          value={settings.buyMinOccasions}
          max={6}
          onCommit={(n) => update({ buyMinOccasions: n })}
        />

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

        <h2 className="section-title">Respaldo</h2>
        <p className="page-hint">
          Tu armario vive solo en este dispositivo. Exporta un zip (base y fotos) y guárdalo en Archivos o iCloud
          Drive. No incluye tu API key.
        </p>
        <p className="page-hint" data-testid="last-backup">
          Último respaldo: {lastBackup}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => void exportBackup()} disabled={exporting || restoring}>
          {exporting ? 'Preparando…' : 'Exportar respaldo'}
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={exporting || restoring}>
          {restoring ? 'Restaurando…' : 'Restaurar respaldo'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          data-testid="restore-input"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) setPendingFile(file)
          }}
        />
        <div aria-live="polite">
          {backupMsg?.kind === 'ok' && <p className="ok-msg">{backupMsg.text}</p>}
          {backupMsg?.kind === 'error' && (
            <p role="alert" className="form-error">
              {backupMsg.text}
            </p>
          )}
        </div>
        <p className="page-hint" data-testid="persisted">
          Almacenamiento persistente:{' '}
          {persisted === null ? 'no disponible' : persisted ? 'sí' : 'no (iOS puede borrar los datos si no usas la app)'}
        </p>
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
      {pendingFile && (
        <ConfirmDialog
          title="Restaurar respaldo"
          message="Esto reemplaza tu armario actual por el contenido del respaldo. Se guarda una copia de seguridad de tus datos actuales antes de reemplazarlos."
          confirmLabel="Restaurar"
          onConfirm={() => void restore(pendingFile)}
          onCancel={() => setPendingFile(null)}
        />
      )}
    </section>
  )
}
