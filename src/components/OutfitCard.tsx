import { Bookmark, Check, Plus, ThumbsDown, ThumbsUp, WashingMachine } from 'lucide-react'
import { useState } from 'react'
import {
  DISLIKE_TAGS,
  LIKE_TAGS,
  tagLabel,
  type FeedbackEntry,
  type Garment,
  type Rating,
} from '../db'
import type { OutfitSource } from '../engine'
import { OutfitVisual } from './OutfitVisual'

const SOURCE_LABELS = { ia: 'IA', reglas: 'reglas', manual: 'manual' } as const

/** Lo que la tarjeta necesita de un outfit; 'manual' = armado o editado por la persona. */
export interface CardOutfit {
  garmentIds: string[]
  reasoning: string
  source: OutfitSource | 'manual'
}

interface OutfitCardProps {
  outfit: CardOutfit
  garments: Map<string, Garment>
  /** Si se omite, la tarjeta no muestra «Me lo pongo». */
  onWear?: () => void
  onUndo?: () => void
  worn?: boolean
  busy?: boolean
  /** Calificación guardada de este outfit (fase 5). */
  feedback?: FeedbackEntry | null
  /** Si se omite, la tarjeta no muestra me gusta / no me gusta. Debe rechazar si no se pudo guardar. */
  onRate?: (rating: Rating, tags: string[], comment: string) => Promise<void>
  /** Fase 12: tocar una prenda del lienzo o su chip abre «Cambiar <prenda>». */
  onSelectGarment?: (id: string) => void
  /** «Añadir pieza» (capa exterior o accesorio). */
  onAdd?: () => void
  /** Bookmark: guarda el outfit (o lo quita de guardados si `saved`). */
  saved?: boolean
  onToggleSave?: () => void
  /** Tras «Me lo pongo»: abre la hoja «Mandar a lavandería». */
  onLaundry?: () => void
}

const RATING_TEXT: Record<Rating, string> = { like: 'Me gusta', dislike: 'No me gusta' }

function RatingPanel({ feedback, onRate }: { feedback: FeedbackEntry | null; onRate: NonNullable<OutfitCardProps['onRate']> }) {
  const [picking, setPicking] = useState<Rating | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function open(rating: Rating) {
    const same = feedback?.rating === rating
    setTags(same ? feedback.tags : [])
    setComment(same ? feedback.comment : '')
    setError(null)
    setPicking(rating)
  }

  async function save() {
    if (!picking) return
    setSaving(true)
    setError(null)
    try {
      await onRate(picking, tags, comment)
      setPicking(null)
    } catch {
      setError('No se pudo guardar tu calificación.')
    } finally {
      setSaving(false)
    }
  }

  const options = picking === 'like' ? LIKE_TAGS : DISLIKE_TAGS
  return (
    <div className="rating" data-testid="rating">
      {feedback && !picking && (
        <p className="rating-saved" data-testid="rating-saved">
          {feedback.rating === 'like' ? <ThumbsUp size={16} aria-hidden="true" /> : <ThumbsDown size={16} aria-hidden="true" />}
          <span>
            {RATING_TEXT[feedback.rating]}
            {feedback.tags.length > 0 && ` · ${feedback.tags.map((t) => tagLabel(feedback.rating, t)).join(', ')}`}
          </span>
        </p>
      )}
      {!picking && (
        <div className="rating-buttons">
          {(['like', 'dislike'] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`btn btn-inline${feedback?.rating === r ? ' btn-selected' : ''}`}
              aria-pressed={feedback?.rating === r}
              aria-label={r === 'like' ? 'Me gusta' : 'No me gusta'}
              onClick={() => open(r)}
            >
              {r === 'like' ? <ThumbsUp size={18} aria-hidden="true" /> : <ThumbsDown size={18} aria-hidden="true" />}
              {RATING_TEXT[r]}
            </button>
          ))}
        </div>
      )}
      {picking && (
        <div className="rating-form">
          <p className="rating-title">{RATING_TEXT[picking]}: ¿por qué? (opcional)</p>
          <div className="chips" role="group" aria-label="Motivos">
            {options.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip${tags.includes(t) ? ' chip-active' : ''}`}
                aria-pressed={tags.includes(t)}
                onClick={() => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}
              >
                {tagLabel(picking, t)}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Comentario (opcional)</span>
            <input value={comment} maxLength={200} onChange={(e) => setComment(e.target.value)} />
          </label>
          <div className="rating-actions">
            <button type="button" className="btn btn-inline" disabled={saving} onClick={() => setPicking(null)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary btn-inline" disabled={saving} onClick={() => void save()}>
              Guardar calificación
            </button>
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function OutfitCard({
  outfit,
  garments,
  onWear,
  onUndo,
  worn = false,
  busy = false,
  feedback = null,
  onRate,
  onSelectGarment,
  onAdd,
  saved = false,
  onToggleSave,
  onLaundry,
}: OutfitCardProps) {
  const items = outfit.garmentIds.map((id) => garments.get(id)).filter((g): g is Garment => !!g)
  return (
    <li className="outfit-card" data-testid="outfit-card">
      <div className="outfit-head">
        <span className="badge badge-source" data-testid="source-badge">
          {SOURCE_LABELS[outfit.source]}
        </span>
        <span className="outfit-head-tools">
          {onAdd && (
            <button type="button" className="btn btn-quiet btn-inline" onClick={onAdd}>
              <Plus size={16} aria-hidden="true" />
              Añadir pieza
            </button>
          )}
          {onToggleSave && (
            <button
              type="button"
              className="icon-btn"
              aria-label={saved ? 'Quitar de guardados' : 'Guardar outfit'}
              aria-pressed={saved}
              title={saved ? 'Quitar de guardados' : 'Guardar outfit'}
              onClick={onToggleSave}
            >
              <Bookmark size={22} aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
            </button>
          )}
        </span>
      </div>
      <OutfitVisual items={items} onSelectGarment={onSelectGarment} />
      <p className="outfit-reasoning">{outfit.reasoning}</p>
      {onRate && <RatingPanel feedback={feedback} onRate={onRate} />}
      <div className="outfit-actions">
        {onWear &&
          (worn ? (
            <>
              <span className="worn-note" data-testid="worn-note">
                <Check size={18} aria-hidden="true" />
                Puesto hoy
              </span>
              <button type="button" className="btn btn-quiet btn-inline" disabled={busy} onClick={onUndo}>
                Deshacer
              </button>
              {onLaundry && (
                <button type="button" className="btn btn-inline" onClick={onLaundry}>
                  <WashingMachine size={16} aria-hidden="true" />
                  Mandar a lavandería
                </button>
              )}
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={onWear}>
              Me lo pongo
            </button>
          ))}
      </div>
    </li>
  )
}
