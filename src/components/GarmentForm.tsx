import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  CATEGORIES,
  CATEGORY_LABELS,
  FIT_LABELS,
  FITS,
  FORMALITY_LABELS,
  OCCASIONS,
  OCCASION_LABELS,
  STATUSES,
  STATUS_LABELS,
  WARMTH_LABELS,
  garmentInputSchema,
  type Garment,
  type GarmentData,
  type Occasion,
} from '../db'
import { resizeImage } from '../lib/image'
import { GarmentPhoto } from './GarmentPhoto'

export interface GarmentFormSubmit {
  data: GarmentData
  /** Foto nueva ya reducida; null si no cambió. */
  newPhoto: Blob | null
  /** true si se quitó la foto existente. */
  removePhoto: boolean
}

interface Props {
  initial?: Garment
  submitLabel: string
  onSubmit: (value: GarmentFormSubmit) => Promise<void>
}

export function GarmentForm({ initial, submitLabel, onSubmit }: Props) {
  const [category, setCategory] = useState<string>(initial?.category ?? '')
  const [subcategory, setSubcategory] = useState(initial?.subcategory ?? '')
  const [colors, setColors] = useState(initial?.colors.join(', ') ?? '')
  const [pattern, setPattern] = useState(initial?.pattern ?? '')
  const [material, setMaterial] = useState(initial?.material ?? '')
  const [fit, setFit] = useState<string>(initial?.fit ?? 'regular')
  const [formality, setFormality] = useState(initial ? String(initial.formality) : '')
  const [warmth, setWarmth] = useState(initial ? String(initial.warmth) : '')
  const [occasions, setOccasions] = useState<Occasion[]>(initial?.occasions ?? [])
  const [isStatement, setIsStatement] = useState(initial?.is_statement ?? false)
  const [status, setStatus] = useState<string>(initial?.status ?? 'active')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null)
  const newPhoto = photo?.blob ?? null
  const previewUrl = photo?.url ?? null
  const [removePhoto, setRemovePhoto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!photo) return
    return () => URL.revokeObjectURL(photo.url)
  }, [photo])

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const blob = await resizeImage(file)
      setPhoto({ blob, url: URL.createObjectURL(blob) })
      setRemovePhoto(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer la imagen.')
    }
  }

  function toggleOccasion(o: Occasion) {
    setOccasions((cur) => (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!category) return setError('Elige una categoría.')
    if (!formality) return setError('Elige la formalidad.')
    if (!warmth) return setError('Elige el nivel de abrigo.')
    const parsed = garmentInputSchema.safeParse({
      photo_path: initial?.photo_path ?? null,
      category,
      subcategory,
      colors: colors.split(',').map((c) => c.trim()).filter(Boolean),
      pattern,
      material,
      fit,
      formality: Number(formality),
      warmth: Number(warmth),
      occasions,
      is_statement: isStatement,
      status,
      notes,
    })
    if (!parsed.success) return setError('Revisa los datos de la prenda.')
    setSaving(true)
    try {
      await onSubmit({ data: parsed.data, newPhoto, removePhoto })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.')
      setSaving(false)
    }
  }

  const hasExisting = !!initial?.photo_path && !removePhoto && !newPhoto

  return (
    <form className="garment-form" onSubmit={handleSubmit} noValidate>
      <div className="photo-box">
        {previewUrl ? (
          <img className="garment-img" src={previewUrl} alt="Vista previa de la foto" />
        ) : hasExisting ? (
          <GarmentPhoto photoPath={initial.photo_path} alt="Foto de la prenda" />
        ) : (
          <div className="photo-placeholder" aria-hidden="true">📷</div>
        )}
      </div>
      <div className="photo-actions">
        <button type="button" className="btn" onClick={() => cameraRef.current?.click()}>
          Tomar foto
        </button>
        <button type="button" className="btn" onClick={() => galleryRef.current?.click()}>
          Elegir de la galería
        </button>
        {(hasExisting || newPhoto) && (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setPhoto(null)
              setRemovePhoto(true)
            }}
          >
            Quitar foto
          </button>
        )}
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label="Tomar foto con la cámara"
        data-testid="camera-input"
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        hidden
        aria-label="Elegir foto de la galería"
        data-testid="gallery-input"
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <label className="field">
        <span>Categoría *</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Elige…</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Subcategoría</span>
        <input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} placeholder="Camisa, jeans, tenis…" />
      </label>
      <label className="field">
        <span>Colores (separados por coma)</span>
        <input value={colors} onChange={(e) => setColors(e.target.value)} placeholder="azul marino, blanco" />
      </label>
      <label className="field">
        <span>Estampado</span>
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Liso, rayas, cuadros…" />
      </label>
      <label className="field">
        <span>Material</span>
        <input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Algodón, mezclilla…" />
      </label>
      <label className="field">
        <span>Corte</span>
        <select value={fit} onChange={(e) => setFit(e.target.value)}>
          {FITS.map((f) => (
            <option key={f} value={f}>{FIT_LABELS[f]}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Formalidad *</span>
        <select value={formality} onChange={(e) => setFormality(e.target.value)}>
          <option value="">Elige…</option>
          {FORMALITY_LABELS.map((l, i) => (
            <option key={l} value={i + 1}>{i + 1} · {l}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Abrigo *</span>
        <select value={warmth} onChange={(e) => setWarmth(e.target.value)}>
          <option value="">Elige…</option>
          {WARMTH_LABELS.map((l, i) => (
            <option key={l} value={i + 1}>{i + 1} · {l}</option>
          ))}
        </select>
      </label>
      <fieldset className="field">
        <legend>Ocasiones</legend>
        <div className="checks">
          {OCCASIONS.map((o) => (
            <label key={o} className="check">
              <input type="checkbox" checked={occasions.includes(o)} onChange={() => toggleOccasion(o)} />
              {OCCASION_LABELS[o]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={isStatement} onChange={(e) => setIsStatement(e.target.checked)} />
        Es prenda protagonista (llamativa)
      </label>
      <label className="field">
        <span>Estado</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Notas</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && <p role="alert" className="form-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? 'Guardando…' : submitLabel}
      </button>
    </form>
  )
}
