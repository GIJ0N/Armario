import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAi } from '../ai/AiProviderContext'
import { describeAiError } from '../ai/errors'
import type { TaggedGarment } from '../ai/provider'
import { downscaleForAi } from '../lib/image'

type AiState = 'idle' | 'loading' | 'done' | 'error'

export interface AiTagging {
  /** Pásalo a `GarmentForm.onPhotoChange`. */
  onPhotoChange: (blob: Blob | null) => void
  suggestion: { id: number; values: TaggedGarment } | null
  /** Estado de la IA para mostrar bajo la foto (`GarmentForm.aiSlot`). */
  aiSlot: ReactNode
}

/** Etiquetado con IA al elegir una foto (Agregar y Comprar): sin API key o con error se llena a mano. */
export function useAiTagging(): AiTagging {
  const ai = useAi()
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [aiState, setAiState] = useState<AiState>('idle')
  const [aiError, setAiError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<{ id: number; values: TaggedGarment } | null>(null)
  const runId = useRef(0)

  async function analyze(blob: Blob) {
    const id = ++runId.current
    setAiError(null)
    if (!ai.configured) {
      setAiState('idle')
      return
    }
    setAiState('loading')
    try {
      const values = await ai.getProvider().tagGarment(await downscaleForAi(blob))
      if (id !== runId.current) return
      setSuggestion({ id, values })
      setAiState('done')
    } catch (e) {
      if (id !== runId.current) return
      setAiError(describeAiError(e))
      setAiState('error')
    }
  }

  function onPhotoChange(blob: Blob | null) {
    setPhoto(blob)
    if (blob) void analyze(blob)
    else {
      runId.current++
      setAiState('idle')
      setAiError(null)
    }
  }

  const aiSlot = (
    <div className="ai-status" aria-live="polite">
      {photo && !ai.configured && (
        <p className="page-hint">
          Para que la IA llene la ficha, agrega tu API key en <Link to="/ajustes">Ajustes</Link>. Mientras tanto
          puedes llenarla a mano.
        </p>
      )}
      {aiState === 'loading' && <p className="page-hint">Analizando la prenda…</p>}
      {aiState === 'error' && aiError && (
        <p role="alert" className="form-error">
          {aiError} Puedes llenar la ficha a mano.
        </p>
      )}
      {photo && ai.configured && aiState !== 'loading' && (
        <button type="button" className="btn btn-small" onClick={() => void analyze(photo)}>
          Volver a analizar
        </button>
      )}
    </div>
  )

  return { onPhotoChange, suggestion, aiSlot }
}
