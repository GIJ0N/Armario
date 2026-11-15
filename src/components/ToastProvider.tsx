import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'

type ShowToast = (message: string) => void

const ToastContext = createContext<ShowToast>(() => {})

const TOAST_MS = 2600

/** Confirmaciones breves ("Prenda guardada"). Sin proveedor, `useToast` no hace nada. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([])
  const nextId = useRef(0)

  const show = useCallback<ShowToast>((message) => {
    const id = ++nextId.current
    setToasts((cur) => [...cur.slice(-2), { id, message }])
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), TOAST_MS)
  }, [])

  const value = useMemo(() => show, [show])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-testid="toast">
            <Check className="icon" size={16} aria-hidden="true" />
            {t.message}
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
