import { Camera, Images, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
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
  type Status,
} from '../db'
import type { TaggedGarment } from '../ai/provider'
import { preparePhoto } from '../cutout/provided'
import { CutoutGuideButton } from './CutoutGuideSheet'
import { GarmentPhoto } from './GarmentPhoto'
import { PasteCutoutButton } from './PasteCutoutButton'

export interface GarmentFormSubmit {
  data: GarmentData
  /** Foto nueva ya reducida; null si no cambió. */
  newPhoto: Blob | null
  /** true si se quitó la foto existente. */
  removePhoto: boolean
  /** Recorte que ya traía la imagen elegida (PNG con transparencia del iPhone); null si no. */
  providedCutout: Blob | null
}

interface Props {
  initial?: Garment
  submitLabel: string
  onSubmit: (value: GarmentFormSubmit) => Promise<void>
  /** Se llama con la foto ya reducida (o null al quitarla). */
  onPhotoChange?: (blob: Blob | null) => void
  /** Valores sugeridos por la IA; cada cambio de `id` vuelve a rellenar el formulario. */
  suggestion?: { id: number; values: TaggedGarment } | null
  /** Contenido (estado de la IA) que se muestra bajo la foto. */
  aiSlot?: ReactNode
  /** Estado fijo (p. ej. «candidata» en Comprar): oculta el selector de estado. */
  fixedStatus?: Status
  /** Si se da, elegir varias fotos de la galería las entrega aquí (cola de Agregar) en vez de usar la primera. */
  onPickFiles?: (files: File[]) => void
  /** Foto ya elegida (cola de Agregar): se reduce y se procesa al abrir el formulario. */
  initialFile?: File
}

export function GarmentForm({ initial, submitLabel, onSubmit, onPhotoChange, suggestion, aiSlot, fixedStatus, onPickFiles, initialFile }: Props) {
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
  const [status, setStatus] = useState<string>(fixedStatus ?? initial?.status ?? 'active')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const [photo, setPhoto] = useState<{ blob: Blob; url: string; cutout: Blob | null; cutoutUrl: string | null } | null>(null)
  const newPhoto = photo?.blob ?? null
  const previewUrl = photo?.cutoutUrl ?? photo?.url ?? null
  const [removePhoto, setRemovePhoto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [aiFields, setAiFields] = useState(false)
  const [appliedSuggestion, setAppliedSuggestion] = useState<number | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  // Rellena con la sugerencia de la IA al recibir una nueva (patrón "ajustar estado al renderizar").
  if (suggestion && suggestion.id !== appliedSuggestion) {
    const v = suggestion.values
    setAppliedSuggestion(suggestion.id)
    setAiFields(true)
    setCategory(v.category)
    setSubcategory(v.subcategory)
    setColors(v.colors.join(', '))
    setPattern(v.pattern)
    setMaterial(v.material)
    setFit(v.fit)
    setFormality(String(v.formality))
    setWarmth(String(v.warmth))
    setOccasions(v.occasions)
    setIsStatement(v.is_statement)
    setNotes(v.notes)
  }

  useEffect(() => {
    if (!photo) return
    return () => {
      URL.revokeObjectURL(photo.url)
      if (photo.cutoutUrl) URL.revokeObjectURL(photo.cutoutUrl)
    }
  }, [photo])

  useEffect(() => {
    if (initialFile) void onFile(initialFile)
    // Solo al abrir: cada foto de la cola monta su propio formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onGallery(files: FileList | null) {
    const list = files ? [...files] : []
    if (list.length > 1 && onPickFiles) onPickFiles(list)
    else void onFile(list[0])
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const { photo: blob, providedCutout } = await preparePhoto(file)
      setPhoto({
        blob,
        url: URL.createObjectURL(blob),
        cutout: providedCutout,
        cutoutUrl: providedCutout ? URL.createObjectURL(providedCutout) : null,
      })
      setRemovePhoto(false)
      onPhotoChange?.(blob)
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
      status: fixedStatus ?? status,
      notes,
    })
    if (!parsed.success) return setError('Revisa los datos de la prenda.')
    setSaving(true)
    try {
      await onSubmit({ data: parsed.data, newPhoto, removePhoto, providedCutout: photo?.cutout ?? null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.')
      setSaving(false)
    }
  }

  const hasExisting = !!initial?.photo_path && !removePhoto && !newPhoto

  return (
    <form className="garment-form" onSubmit={handleSubmit} noValidate>
      <div className={`photo-box${previewUrl || hasExisting ? '' : ' photo-box-empty'}`}>
        {previewUrl ? (
          <>
            <img
              className="garment-img"
              src={previewUrl}
              alt={photo?.cutoutUrl ? 'Vista previa de la prenda sin fondo' : 'Vista previa de la foto'}
            />
            {photo?.cutoutUrl && <span className="badge photo-badge">Sin fondo (del iPhone)</span>}
          </>
        ) : hasExisting ? (
          <GarmentPhoto photoPath={initial.photo_path} alt="Foto de la prenda" />
        ) : (
          <div className="photo-empty">
            <Camera size={40} strokeWidth={1.4} aria-hidden="true" />
            <p>{onPickFiles ? 'Toma una foto o elige varias de la galería.' : 'Agrega una foto de la prenda.'}</p>
          </div>
        )}
      </div>
      <div className="photo-actions">
        <button type="button" className="btn" onClick={() => cameraRef.current?.click()}>
          <Camera size={18} aria-hidden="true" />
          Tomar foto
        </button>
        <button type="button" className="btn" onClick={() => galleryRef.current?.click()}>
          <Images size={18} aria-hidden="true" />
          Elegir de la galería
        </button>
        <PasteCutoutButton onFile={(f) => void onFile(f)} />
        {(hasExisting || newPhoto) && (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setPhoto(null)
              setRemovePhoto(true)
              onPhotoChange?.(null)
            }}
          >
            Quitar foto
          </button>
        )}
      </div>
      {!initial && <CutoutGuideButton />}
      {aiSlot}
      {aiFields && (
        <p className="ai-note" data-testid="ai-suggested">
          <Sparkles size={16} className="icon" aria-hidden="true" />
          <span>Sugeridos por IA: revisa y corrige los campos antes de guardar.</span>
        </p>
      )}
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
        multiple={!!onPickFiles}
        onChange={(e) => {
          onGallery(e.target.files)
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
      {!fixedStatus && (
        <label className="field">
          <span>Estado</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
      )}
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
