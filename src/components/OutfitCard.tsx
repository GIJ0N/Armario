import { useState } from 'react'
import {
  CATEGORY_LABELS,
  DISLIKE_TAGS,
  LIKE_TAGS,
  tagLabel,
  type FeedbackEntry,
  type Garment,
  type Rating,
} from '../db'
import type { SuggestedOutfit } from '../engine'
import { GarmentPhoto } from './GarmentPhoto'

const SOURCE_LABELS = { ia: 'IA', reglas: 'reglas' } as const

interface OutfitCardProps {
  outfit: SuggestedOutfit
  garments: Map<string, Garment>
  /** Si se omite, la tarjeta no muestra «Me lo pongo». */
  onWear?: () => void
  onUndo?: () => void
  worn?: boolean
  busy?: boolean
  /** Calificación guardada de este outfit (fase 5). */
  feedback?: FeedbackEntry | null
  /** Si se omite, la tarjeta no muestra 👍 / 👎. Debe rechazar si no se pudo guardar. */
  onRate?: (rating: Rating, tags: string[], comment: string) => Promise<void>
}

const RATING_TEXT: Record<Rating, string> = { like: '👍 Me gusta', dislike: '👎 No me gusta' }

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
          Tu calificación: {RATING_TEXT[feedback.rating]}
          {feedback.tags.length > 0 && ` · ${feedback.tags.map((t) => tagLabel(feedback.rating, t)).join(', ')}`}
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
              {r === 'like' ? '👍' : '👎'}
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
}: OutfitCardProps) {
  const items = outfit.garmentIds.map((id) => garments.get(id)).filter((g): g is Garment => !!g)
  return (
    <li className="outfit-card" data-testid="outfit-card">
      <div className="outfit-head">
        <span className="badge badge-source" data-testid="source-badge">
          {SOURCE_LABELS[outfit.source]}
        </span>
      </div>
      <ul className="outfit-items">
        {items.map((g) => {
          const title = g.subcategory || CATEGORY_LABELS[g.category]
          return (
            <li key={g.id} className="outfit-item">
              <div className="outfit-thumb">
                <GarmentPhoto photoPath={g.photo_path} alt={title} />
              </div>
              <span className="outfit-item-name">{title}</span>
            </li>
          )
        })}
      </ul>
      <p className="outfit-reasoning">{outfit.reasoning}</p>
      {onRate && <RatingPanel feedback={feedback} onRate={onRate} />}
      <div className="outfit-actions">
        {onWear &&
          (worn ? (
            <>
              <span className="worn-note" data-testid="worn-note">
                Puesto hoy ✓
              </span>
              <button type="button" className="btn btn-quiet btn-inline" disabled={busy} onClick={onUndo}>
                Deshacer
              </button>
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
