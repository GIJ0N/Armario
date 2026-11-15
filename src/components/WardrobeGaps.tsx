import { useState } from 'react'
import { useAi } from '../ai/AiProviderContext'
import type { Garment } from '../db'
import { computeWardrobeGaps, phraseWardrobeGaps, type WardrobeGapSuggestion } from '../purchase'

/** «Qué le falta a mi armario»: se calcula solo al tocar «Calcular» para no gastar CPU en cada render. */
export function WardrobeGaps({ garments }: { garments: Garment[] }) {
  const ai = useAi()
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [suggestions, setSuggestions] = useState<WardrobeGapSuggestion[]>([])

  async function calculate() {
    setState('running')
    // Deja pintar «Calculando…» antes del trabajo síncrono del motor.
    await new Promise((r) => setTimeout(r, 0))
    try {
      let found = computeWardrobeGaps(garments)
      if (found.length > 0 && ai.configured) found = await phraseWardrobeGaps(ai.getProvider(), found)
      setSuggestions(found)
      setState('done')
    } catch {
      setState('error')
    }
  }

  return (
    <div data-testid="wardrobe-gaps">
      <h2 className="section-title">Qué le falta a mi armario</h2>
      <p className="page-hint">Las 3 prendas que más outfits nuevos desbloquearían con lo que ya tienes.</p>
      <button type="button" className="btn" onClick={() => void calculate()} disabled={state === 'running'}>
        {state === 'running' ? 'Calculando…' : state === 'done' ? 'Volver a calcular' : 'Calcular'}
      </button>
      {state === 'error' && (
        <p role="alert" className="form-error">
          No se pudo calcular. Inténtalo de nuevo.
        </p>
      )}
      {state === 'done' &&
        (suggestions.length === 0 ? (
          <p className="page-hint">Agrega prendas activas (superior, inferior y calzado) para ver sugerencias.</p>
        ) : (
          <ol className="gap-suggestions" aria-label="Prendas que le faltan a tu armario">
            {suggestions.map((s) => (
              <li key={s.label} className="complement-card" data-testid="wardrobe-gap">
                <strong>{s.label}</strong>
                {s.phrase && <span className="muted complement-reason">{s.phrase}</span>}
                <span className="complement-unlocks">
                  desbloquearía {s.unlocks} {s.unlocks === 1 ? 'outfit nuevo' : 'outfits nuevos'}
                </span>
              </li>
            ))}
          </ol>
        ))}
    </div>
  )
}
