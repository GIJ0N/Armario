import type { Category, DislikeTag, Fit, LikeTag, Occasion, Status } from './types'

export const CATEGORY_LABELS: Record<Category, string> = {
  top: 'Superior',
  bottom: 'Inferior',
  shoes: 'Calzado',
  outerwear: 'Capa exterior',
  accessory: 'Accesorio',
}

export const STATUS_LABELS: Record<Status, string> = {
  active: 'Activa',
  laundry: 'Lavandería',
  retired: 'Retirada',
  candidate: 'Candidata',
}

export const FIT_LABELS: Record<Fit, string> = {
  fitted: 'Ajustado',
  regular: 'Regular',
  loose: 'Holgado',
}

export const OCCASION_LABELS: Record<Occasion, string> = {
  plant_work: 'Trabajo en planta',
  office: 'Oficina',
  gym: 'Gym',
  casual: 'Casual',
  date: 'Cita',
  formal_event: 'Evento formal',
}

export const FORMALITY_LABELS = ['Muy informal', 'Informal', 'Intermedio', 'Formal', 'Muy formal']
export const WARMTH_LABELS = ['Muy fresca', 'Fresca', 'Media', 'Abrigadora', 'Muy abrigadora']

export const DISLIKE_TAG_LABELS: Record<DislikeTag, string> = {
  too_formal: 'Muy formal',
  too_casual: 'Muy casual',
  colors: 'No me gustan los colores',
  fit: 'La silueta no me convence',
  weather: 'No va con el clima',
  repetitive: 'Muy repetido',
  uncomfortable: 'Incómodo',
}

export const LIKE_TAG_LABELS: Record<LikeTag, string> = {
  perfect_occasion: 'Perfecto para la ocasión',
  colors: 'Buenos colores',
  comfortable: 'Cómodo',
  new_combo: 'Combinación nueva',
}

/** Etiqueta en español de un motivo; si no se conoce devuelve el código. */
export function tagLabel(rating: 'like' | 'dislike', tag: string): string {
  const labels: Record<string, string> = rating === 'like' ? LIKE_TAG_LABELS : DISLIKE_TAG_LABELS
  return labels[tag] ?? tag
}
