/** Bus mínimo: avisa a las pantallas abiertas que el recorte de una prenda cambió (p. ej. terminó en segundo plano). */
type Listener = (garmentId: string) => void

const listeners = new Set<Listener>()

export function notifyCutoutChanged(garmentId: string): void {
  for (const cb of [...listeners]) {
    try {
      cb(garmentId)
    } catch {
      /* un suscriptor con error no debe afectar al resto */
    }
  }
}

/** Devuelve la función para cancelar la suscripción. */
export function subscribeCutoutChanged(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
