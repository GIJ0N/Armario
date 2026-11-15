import type { Category, Fit, Garment, Occasion } from '../../src/db/types'
import type { Weather } from '../../src/engine/types'

let n = 0
function g(
  id: string,
  category: Category,
  subcategory: string,
  colors: string[],
  o: {
    pattern?: string
    material?: string
    fit?: Fit
    formality: number
    warmth: number
    occasions: Occasion[]
    is_statement?: boolean
  },
): Garment {
  n++
  return {
    id,
    photo_path: null,
    category,
    subcategory,
    colors,
    pattern: o.pattern ?? 'liso',
    material: o.material ?? 'algodón',
    fit: o.fit ?? 'regular',
    formality: o.formality,
    warmth: o.warmth,
    occasions: o.occasions,
    is_statement: o.is_statement ?? false,
    status: 'active',
    notes: '',
    created_at: new Date(Date.UTC(2026, 0, n)).toISOString(),
  }
}

/** Armario realista de 30 prendas para un hombre en Monterrey. */
export const wardrobe30: Garment[] = [
  // Superiores (10)
  g('top-playera-blanca', 'top', 'playera', ['blanco'], { formality: 2, warmth: 1, occasions: ['casual', 'plant_work'] }),
  g('top-playera-dryfit', 'top', 'playera deportiva', ['gris'], { material: 'poliéster', fit: 'fitted', formality: 1, warmth: 1, occasions: ['gym', 'plant_work'] }),
  g('top-playera-dryfit-ml', 'top', 'playera deportiva manga larga', ['azul marino'], { material: 'poliéster', formality: 1, warmth: 2, occasions: ['gym'] }),
  g('top-polo-marino', 'top', 'polo', ['azul marino'], { fit: 'fitted', formality: 3, warmth: 2, occasions: ['casual', 'plant_work', 'office'] }),
  g('top-oxford-azul', 'top', 'camisa oxford', ['azul'], { fit: 'regular', formality: 3, warmth: 2, occasions: ['casual', 'office', 'date'] }),
  g('top-oxford-blanca', 'top', 'camisa oxford', ['blanco'], { fit: 'fitted', formality: 4, warmth: 2, occasions: ['office', 'date', 'formal_event'] }),
  g('top-camisa-vestir', 'top', 'camisa de vestir', ['blanco'], { fit: 'fitted', formality: 4, warmth: 2, occasions: ['office', 'date', 'formal_event'] }),
  g('top-sudadera-gris', 'top', 'sudadera', ['gris'], { fit: 'loose', formality: 2, warmth: 4, occasions: ['casual', 'gym'] }),
  g('top-sueter-cafe', 'top', 'suéter', ['café'], { material: 'lana', formality: 3, warmth: 4, occasions: ['casual', 'office', 'date'] }),
  g('top-playera-estampada', 'top', 'playera estampada', ['rojo', 'negro'], { pattern: 'estampado', fit: 'loose', formality: 2, warmth: 1, occasions: ['casual'], is_statement: true }),
  // Inferiores (8)
  g('bot-jeans-azul', 'bottom', 'jeans', ['azul'], { material: 'mezclilla', formality: 2, warmth: 3, occasions: ['casual', 'plant_work'] }),
  g('bot-jeans-negros', 'bottom', 'jeans', ['negro'], { material: 'mezclilla', fit: 'fitted', formality: 3, warmth: 3, occasions: ['casual', 'date'] }),
  g('bot-chinos-beige', 'bottom', 'chinos', ['beige'], { formality: 3, warmth: 2, occasions: ['casual', 'office', 'date', 'plant_work'] }),
  g('bot-vestir-gris', 'bottom', 'pantalón de vestir', ['gris'], { material: 'lana', formality: 4, warmth: 2, occasions: ['office', 'date', 'formal_event'] }),
  g('bot-vestir-negro', 'bottom', 'pantalón de vestir', ['negro'], { material: 'lana', fit: 'fitted', formality: 4, warmth: 2, occasions: ['office', 'date', 'formal_event'] }),
  g('bot-shorts-caqui', 'bottom', 'shorts', ['beige'], { formality: 2, warmth: 1, occasions: ['casual'] }),
  g('bot-shorts-dep', 'bottom', 'shorts deportivos', ['negro'], { material: 'poliéster', formality: 1, warmth: 1, occasions: ['gym'] }),
  g('bot-joggers', 'bottom', 'joggers', ['gris'], { fit: 'loose', formality: 1, warmth: 3, occasions: ['gym', 'casual'] }),
  // Calzado (5)
  g('sho-tenis-blancos', 'shoes', 'tenis blancos', ['blanco'], { material: 'piel', formality: 2, warmth: 2, occasions: ['casual', 'plant_work'] }),
  g('sho-tenis-correr', 'shoes', 'tenis de correr', ['negro', 'gris'], { material: 'malla', formality: 1, warmth: 2, occasions: ['gym'] }),
  g('sho-botas-trabajo', 'shoes', 'botas de trabajo', ['café'], { material: 'piel', formality: 2, warmth: 4, occasions: ['plant_work'] }),
  g('sho-mocasines', 'shoes', 'mocasines', ['café'], { material: 'piel', formality: 3, warmth: 2, occasions: ['casual', 'office', 'date'] }),
  g('sho-zapatos-vestir', 'shoes', 'zapatos de vestir', ['negro'], { material: 'piel', formality: 4, warmth: 2, occasions: ['office', 'date', 'formal_event'] }),
  // Capa exterior (3)
  g('out-chamarra-mezclilla', 'outerwear', 'chamarra de mezclilla', ['azul'], { material: 'mezclilla', formality: 2, warmth: 3, occasions: ['casual', 'plant_work'] }),
  g('out-blazer', 'outerwear', 'blazer', ['azul marino'], { material: 'lana', fit: 'fitted', formality: 4, warmth: 3, occasions: ['office', 'date', 'formal_event'] }),
  g('out-rompevientos', 'outerwear', 'rompevientos', ['amarillo'], { material: 'nailon', formality: 2, warmth: 3, occasions: ['gym', 'casual', 'plant_work'], is_statement: true }),
  // Accesorios (4)
  g('acc-reloj', 'accessory', 'reloj', ['gris'], { material: 'acero', formality: 3, warmth: 1, occasions: ['office', 'date', 'formal_event', 'casual'] }),
  g('acc-cinturon-cafe', 'accessory', 'cinturón', ['café'], { material: 'piel', formality: 3, warmth: 1, occasions: ['casual', 'office', 'date'] }),
  g('acc-cinturon-negro', 'accessory', 'cinturón', ['negro'], { material: 'piel', formality: 4, warmth: 1, occasions: ['office', 'date', 'formal_event'] }),
  g('acc-gorra', 'accessory', 'gorra', ['negro'], { formality: 1, warmth: 1, occasions: ['gym', 'casual', 'plant_work'] }),
]

const w = (tempC: number, tempMinC: number, tempMaxC: number): Weather => ({
  tempC,
  precipProbability: 5,
  isRaining: false,
  tempMinC,
  tempMaxC,
})

export const HOT = w(33, 26, 36)
export const MILD = w(22, 17, 25)
export const COLD = w(10, 6, 14)
export const RAINY: Weather = { tempC: 20, precipProbability: 90, isRaining: true, tempMinC: 17, tempMaxC: 22 }

export const TODAY = '2026-11-14'
