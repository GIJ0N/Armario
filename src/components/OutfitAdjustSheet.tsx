import type { AdjustChange, OutfitLayout } from '../canvas/adjust'
import type { Garment } from '../db'
import { BottomSheet } from './BottomSheet'
import { OutfitCanvas } from './OutfitCanvas'

interface Props {
  items: Garment[]
  layout: OutfitLayout | null | undefined
  /** «Listo» con cambios. El anfitrión guarda y cierra. */
  onSave: (change: AdjustChange) => void | Promise<void>
  /** «Cancelar» o «Listo» sin cambios. */
  onClose: () => void
}

/** Lienzo grande en modo «Ajustar» dentro de una hoja; lo usan los lienzos pequeños (Outfits guardados). */
export function OutfitAdjustSheet({ items, layout, onSave, onClose }: Props) {
  return (
    <BottomSheet title="Ajustar outfit" onClose={onClose}>
      <OutfitCanvas items={items} layout={layout} chips={false} startAdjusting onAdjustSave={onSave} onAdjustCancel={onClose} />
    </BottomSheet>
  )
}
