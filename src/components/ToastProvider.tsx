import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'

export interface ToastAction {
  label: string
  onAction: () => void
}

type ShowToast = (message: string, action?: ToastAction) => void

const ToastContext = createContext<ShowToast>(() => {})

const TOAST_MS = 2600
/** Un aviso con botón dura más para dar tiempo de tocarlo. */
const TOAST_ACTION_MS = 7000

/** Confirmaciones breves ("Prenda guardada"). Sin proveedor, `useToast` no hace nada. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; action?: ToastAction }[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((cur) => cur.filter((t) => t.id !== id)), [])
  const show = useCallback<ShowToast>(
    (message, action) => {
      const id = ++nextId.current
      setToasts((cur) => [...cur.slice(-2), { id, message, action }])
      setTimeout(() => dismiss(id), action ? TOAST_ACTION_MS : TOAST_MS)
    },
    [dismiss],
  )

  const value = useMemo(() => show, [show])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-testid="toast">
            <Check className="icon" size={16} aria-hidden="true" />
            {t.message}
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id)
                  t.action!.onAction()
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ShowToast {
  return useContext(ToastContext)
}
