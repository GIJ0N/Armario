import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Garment } from '../db'
import { createCutoutFor, runExclusive, useBackgroundRemover } from '../cutout'
import { GarmentPhoto } from './GarmentPhoto'
import { useRepository } from './RepositoryContext'

/** Vista previa «Sin fondo / Original» y «Rehacer recorte» en el detalle de la prenda. */
export function CutoutControls({ garment, onChange }: { garment: Garment; onChange: (g: Garment) => void }) {
  const repo = useRepository()
  const remover = useBackgroundRemover()
  const [variant, setVariant] = useState<'cutout' | 'original'>('cutout')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const hasCutout = !!garment.cutout_path

  async function redo() {
    setBusy(true)
    setMessage(null)
    try {
      const out = await runExclusive(async () => {
        if (!(await remover.isDownloaded())) return 'missing' as const
        return createCutoutFor(repo, garment, { remover })
      })
      if (out === 'missing') {
        setMessage({ kind: 'error', text: 'El modelo de recorte no está descargado.' })
      } else if (out.result) {
        onChange(out.garment)
        setVariant('cutout')
        setMessage({ kind: 'info', text: 'Recorte listo.' })
      } else {
        setMessage({
          kind: 'error',
          text: `No se pudo recortar${out.maskError ? `: ${out.maskError.message}` : '.'} Se sigue usando la foto original.`,
        })
      }
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'No se pudo recortar.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cutout-controls">
      <div className="cutout-preview">
        <GarmentPhoto
          photoPath={garment.photo_path}
          cutoutPath={garment.cutout_path}
          variant={variant}
          alt={variant === 'cutout' && hasCutout ? 'Prenda sin fondo' : 'Foto original de la prenda'}
        />
      </div>
      {hasCutout ? (
        <div className="cutout-toggle" role="group" aria-label="Vista de la foto">
          <button type="button" className="btn btn-small" aria-pressed={variant === 'cutout'} onClick={() => setVariant('cutout')}>
            Sin fondo
          </button>
          <button type="button" className="btn btn-small" aria-pressed={variant === 'original'} onClick={() => setVariant('original')}>
            Original
          </button>
        </div>
      ) : (
        <p className="page-hint">Esta prenda no tiene recorte sin fondo.</p>
      )}
      <button type="button" className="btn btn-small" disabled={busy} onClick={() => void redo()}>
        {busy ? 'Recortando…' : 'Rehacer recorte'}
      </button>
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'form-error' : 'page-hint'}>
          {message.text}{' '}
          {message.kind === 'error' && message.text.includes('no está descargado') && <Link to="/ajustes">Ir a Ajustes</Link>}
        </p>
      )}
    </div>
  )
}
