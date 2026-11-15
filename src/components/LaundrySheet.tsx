import { useState } from 'react'
import { CATEGORY_LABELS, type Garment } from '../db'
import { BottomSheet } from './BottomSheet'

interface Props {
  items: Garment[]
  onConfirm: (garmentIds: string[]) => Promise<void> | void
  onClose: () => void
}

/** Prendas que van primero a la lavandería por defecto: la de arriba. */
function defaultLaundryIds(items: Garment[]): string[] {
  return items.filter((g) => g.category === 'top').map((g) => g.id)
}

/** Hoja «Mandar a lavandería»: casillas con las prendas del outfit (la de arriba marcada). */
export function LaundrySheet({ items, onConfirm, onClose }: Props) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(defaultLaundryIds(items)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm([...checked])
    } catch {
      setError('No se pudo actualizar la lavandería.')
      setBusy(false)
    }
  }

  return (
    <BottomSheet title="Mandar a lavandería" onClose={onClose}>
      <p>Elige las prendas que quedaron para lavar.</p>
      <ul className="laundry-list">
        {items.map((g) => {
          const label = g.subcategory || CATEGORY_LABELS[g.category]
          return (
            <li key={g.id}>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={checked.has(g.id)}
                  onChange={() =>
                    setChecked((cur) => {
                      const next = new Set(cur)
                      if (next.has(g.id)) next.delete(g.id)
                      else next.add(g.id)
                      return next
                    })
                  }
                />
                <span>{label}</span>
                <span className="muted">{CATEGORY_LABELS[g.category]}</span>
              </label>
            </li>
          )
        })}
      </ul>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="sheet-actions sheet-gap">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || checked.size === 0} onClick={() => void confirm()}>
          Mandar a lavandería
        </button>
      </div>
    </BottomSheet>
  )
}
