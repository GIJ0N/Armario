import { ClipboardPaste } from 'lucide-react'
import type { ClipboardEvent } from 'react'
import {
  NO_CLIPBOARD_IMAGE_MESSAGE,
  clipboardReadSupported,
  imageFromPasteEvent,
  readClipboardImage,
  type ClipboardReader,
} from '../lib/clipboardImage'
import { useToast } from './ToastProvider'

interface Props {
  /** Recibe la imagen pegada; pasa por el mismo camino que una foto elegida (se detecta la transparencia). */
  onFile: (file: File) => void
  label?: string
  /** Solo pruebas: lector del portapapeles. Si se da, se considera que la API existe. */
  reader?: ClipboardReader
  className?: string
}

/** «Pegar foto»: lee la imagen del portapapeles (p. ej. lo que se copió en Fotos). Sin la API, ofrece un destino de pegado. */
export function PasteCutoutButton({ onFile, label = 'Pegar foto', reader, className = 'btn' }: Props) {
  const toast = useToast()
  const supported = !!reader || clipboardReadSupported()

  function onClick() {
    // `readClipboardImage` invoca el lector de inmediato: sigue dentro del gesto del usuario.
    void readClipboardImage(reader).then((res) => {
      if (res.ok) onFile(res.file)
      else toast(NO_CLIPBOARD_IMAGE_MESSAGE)
    })
  }

  function onPaste(e: ClipboardEvent<HTMLElement>) {
    e.preventDefault()
    const file = imageFromPasteEvent(e)
    if (file) onFile(file)
    else toast(NO_CLIPBOARD_IMAGE_MESSAGE)
  }

  if (supported) {
    return (
      <button type="button" className={className} onClick={onClick}>
        <ClipboardPaste size={18} aria-hidden="true" />
        {label}
      </button>
    )
  }
  return (
    <div
      className="paste-target"
      contentEditable
      suppressContentEditableWarning
      tabIndex={0}
      role="textbox"
      aria-label={`${label}: mantén presionado aquí y toca Pegar`}
      data-testid="paste-target"
      onPaste={onPaste}
      onBeforeInput={(e) => e.preventDefault()}
    >
      <ClipboardPaste size={16} aria-hidden="true" />
      <span>{label}: mantén presionado aquí y toca Pegar</span>
    </div>
  )
}
