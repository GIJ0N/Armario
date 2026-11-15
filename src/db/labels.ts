import type { Category, Fit, Occasion, Status } from './types'

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
