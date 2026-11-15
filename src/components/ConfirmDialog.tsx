import { useRef } from 'react'
import { BottomSheet } from './BottomSheet'

interface Props {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/** Confirmación propia (no usa window.confirm), presentada como hoja inferior. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <BottomSheet title={title} role="alertdialog" descriptionId="confirm-msg" onClose={onCancel} initialFocus={cancelRef}>
      <p id="confirm-msg">{message}</p>
      <div className="sheet-actions">
        <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>Cancelar</button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </BottomSheet>
  )
}
