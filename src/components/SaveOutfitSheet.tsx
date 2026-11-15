import { useRef, useState } from 'react'
import { BottomSheet } from './BottomSheet'

interface Props {
  onSave: (name: string) => Promise<void> | void
  onClose: () => void
  initialName?: string
}

/** Hoja «Guardar outfit» con nombre opcional. */
export function SaveOutfitSheet({ onSave, onClose, initialName = '' }: Props) {
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await onSave(name.trim())
    } catch {
      setError('No se pudo guardar el outfit.')
      setBusy(false)
    }
  }

  return (
    <BottomSheet title="Guardar outfit" onClose={onClose} initialFocus={inputRef}>
      <p>Lo verás en Armario › Outfits y nunca se borra solo.</p>
      <label className="field">
        <span>Nombre (opcional)</span>
        <input ref={inputRef} value={name} maxLength={60} placeholder="Ej. Viernes en la oficina" onChange={(e) => setName(e.target.value)} />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="sheet-actions sheet-gap">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          Guardar
        </button>
      </div>
    </BottomSheet>
  )
}
