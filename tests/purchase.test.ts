import { describe, expect, it } from 'vitest'
import { MockAiProvider } from '../src/ai/mock'
import { AiNetworkError } from '../src/ai/errors'
import { sanitizeText } from '../src/ai/prompts/purchaseGaps'
import { OCCASIONS, type Category, type Garment, type Occasion } from '../src/db/types'
import {
  analyzeGaps,
  computeVerdict,
  computeWardrobeGaps,
  evaluatePurchase,
  findDuplicates,
  hypotheticalGarment,
  isValidExample,
  phraseWardrobeGaps,
  simulateWithGarment,
  suggestComplements,
  toStoredEvaluation,
  unlockedByComplement,
  type ComplementDescriptor,
} from '../src/purchase'
import { wardrobe30 } from './fixtures/wardrobe30'

let n = 0
function item(category: Category, subcategory: string, colors: string[], formality: number, o: Partial<Garment> = {}): Garment {
  n++
  return {
    id: `t${n}`,
    photo_path: null,
    category,
    subcategory,
    colors,
    pattern: 'liso',
    material: '',
    fit: 'regular',
    formality,
    warmth: 2,
    occasions: [],
    is_statement: false,
    status: 'candidate',
    notes: '',
    created_at: '2026-06-01T00:00:00.000Z',
    ...o,
  }
}

const navyChinos = () => item('bottom', 'Chinos', ['azul marino'], 3)
const statementTop = () => item('top', 'camisa de gala', ['rojo'], 5, { is_statement: true, occasions: ['formal_event'] })

describe('duplicados', () => {
  const white = (id: string, o: Partial<Garment> = {}): Garment => ({ ...wardrobe30[0], id, ...o })

  it('2 prendas activas con misma categoría, subcategoría, color principal y formalidad = duplicado', () => {
    const wardrobe = [...wardrobe30, white('dup-2')]
    const cand = item('top', '  PLAYERA ', ['Blanco', 'gris'], 2)
    const r = findDuplicates(cand, wardrobe)
    expect(r.isDuplicate).toBe(true)
    expect(r.matches.map((g) => g.id).sort()).toEqual(['dup-2', 'top-playera-blanca'])
  })

  it('ignora mayúsculas, acentos y espacios', () => {
    const wardrobe = [item('shoes', 'Mocasín', ['café'], 3, { status: 'active' }), item('shoes', 'mocasin ', ['CAFE'], 3, { status: 'active' })]
    expect(findDuplicates(item('shoes', 'MOCASÍN', ['Café'], 3), wardrobe).isDuplicate).toBe(true)
  })

  it('una sola coincidencia no basta y devuelve la prenda parecida', () => {
    const r = findDuplicates(item('top', 'playera', ['blanco'], 2), wardrobe30)
    expect(r.isDuplicate).toBe(false)
    expect(r.matches).toHaveLength(1)
  })

  it('otro color principal, otra formalidad o prendas no activas no cuentan', () => {
    const wardrobe = [white('a'), white('b', { status: 'laundry' }), white('c', { status: 'retired' }), white('d', { formality: 3 }), white('e', { colors: ['negro', 'blanco'] })]
    expect(findDuplicates(item('top', 'playera', ['blanco'], 2), wardrobe).isDuplicate).toBe(false)
  })

  it('sin subcategoría no se afirma que sea duplicado', () => {
    const blank = [item('top', '', ['blanco'], 2, { status: 'active' }), item('top', '', ['blanco'], 2, { status: 'active' })]
    expect(findDuplicates(item('top', '', ['blanco'], 2), blank).isDuplicate).toBe(false)
  })
})

describe('veredicto', () => {
  it('buy: total >= 5 y >= 2 ocasiones', () => {
    expect(computeVerdict({ total: 5, occasionCount: 2, isDuplicate: false })).toBe('buy')
    expect(computeVerdict({ total: 4, occasionCount: 3, isDuplicate: false })).toBe('with_complements')
    expect(computeVerdict({ total: 30, occasionCount: 1, isDuplicate: false })).toBe('with_complements')
    expect(computeVerdict({ total: 1, occasionCount: 1, isDuplicate: false })).toBe('with_complements')
  })
  it('skip: 0 outfits o duplicado', () => {
    expect(computeVerdict({ total: 0, occasionCount: 0, isDuplicate: false })).toBe('skip')
    expect(computeVerdict({ total: 50, occasionCount: 4, isDuplicate: true })).toBe('skip')
  })
  it('los umbrales son configurables', () => {
    expect(computeVerdict({ total: 5, occasionCount: 2, isDuplicate: false }, { buyMinOutfits: 10, buyMinOccasions: 2 })).toBe('with_complements')
    expect(computeVerdict({ total: 5, occasionCount: 1, isDuplicate: false }, { buyMinOutfits: 3, buyMinOccasions: 1 })).toBe('buy')
  })
})

describe('simulación con prenda obligatoria', () => {
  it('es determinista y todo ejemplo incluye la candidata y es válido para el validador del motor', () => {
    const cand = navyChinos()
    const a = simulateWithGarment(cand, { garments: wardrobe30 })
    const b = simulateWithGarment(cand, { garments: [...wardrobe30].reverse() })
    expect(b.perOccasion).toEqual(a.perOccasion)
    expect(a.total).toBe(OCCASIONS.reduce((s, o) => s + a.perOccasion[o], 0))
    for (const o of OCCASIONS) {
      expect(a.examples[o].length).toBeLessThanOrEqual(3)
      expect(a.examples[o].length).toBe(Math.min(3, a.perOccasion[o]))
      for (const ex of a.examples[o]) {
        expect(ex.garmentIds).toContain(cand.id)
        expect(isValidExample(ex, [...wardrobe30, cand])).toBe(true)
      }
    }
    expect(a.partnerIds).not.toContain(cand.id)
  })

  it('trata a la candidata como activa y no cuenta prendas candidatas ni retiradas del armario', () => {
    const cand = navyChinos()
    const base = simulateWithGarment(cand, { garments: wardrobe30 })
    const noisy = [...wardrobe30, item('shoes', 'tenis', ['negro'], 3), item('top', 'polo', ['negro'], 3, { status: 'retired' })]
    expect(simulateWithGarment(cand, { garments: noisy }).total).toBe(base.total)
  })

  it('una prenda fuera de rango de formalidad no forma outfits en esa ocasión', () => {
    const r = simulateWithGarment(navyChinos(), { garments: wardrobe30 })
    expect(r.perOccasion.gym).toBe(0)
    expect(r.perOccasion.formal_event).toBe(0)
    expect(r.perOccasion.office).toBeGreaterThan(0)
  })

  it('un accesorio candidato también se simula', () => {
    const belt = item('accessory', 'cinturón', ['negro'], 4)
    const r = simulateWithGarment(belt, { garments: wardrobe30 })
    expect(r.total).toBeGreaterThan(0)
    for (const ex of Object.values(r.examples).flat()) expect(ex.garmentIds).toContain(belt.id)
  })
})

describe('(a) duplicado -> No te conviene', () => {
  it('una tercera playera blanca idéntica', async () => {
    const wardrobe = [...wardrobe30, { ...wardrobe30[0], id: 'playera-blanca-2' }]
    const cand = item('top', 'playera', ['blanco'], 2, { warmth: 1 })
    const r = await evaluatePurchase(cand, wardrobe)
    expect(r.verdict).toBe('skip')
    expect(r.duplicate.isDuplicate).toBe(true)
    expect(r.duplicate.matches).toHaveLength(2)
    expect(r.simulation.total).toBeGreaterThan(0) // forma outfits, pero es repetida
    expect(r.explanation).toMatch(/Ya tienes 2 prendas casi iguales/)
    expect(r.complements).toEqual([])
  })
})

describe('(b) prenda versátil -> Cómprala', () => {
  it('chinos azul marino de formalidad 3', async () => {
    const t = performance.now()
    const r = await evaluatePurchase(navyChinos(), wardrobe30)
    const ms = performance.now() - t
    console.info(`[medido] (b) chinos marino: ${r.simulation.total} outfits en ${r.simulation.occasionCount} ocasiones ${JSON.stringify(r.simulation.perOccasion)}, ${ms.toFixed(1)} ms`)
    expect(r.verdict).toBe('buy')
    expect(r.simulation.total).toBeGreaterThanOrEqual(5)
    expect(r.simulation.occasionCount).toBeGreaterThanOrEqual(2)
    expect(r.duplicate.isDuplicate).toBe(false)
  })
})

describe('(c) prenda difícil -> Solo con complementos', () => {
  it('camisa de formalidad 5 y protagonista: cada complemento desbloquea N > 0 y la re-simulación lo confirma', async () => {
    const cand = statementTop()
    const r = await evaluatePurchase(cand, wardrobe30)
    expect(r.verdict).toBe('with_complements')
    expect(r.simulation.total).toBeGreaterThanOrEqual(1)
    expect(r.simulation.total).toBeLessThan(5)
    expect(r.complements.length).toBeGreaterThan(0)
    expect(r.complements.length).toBeLessThanOrEqual(3)
    expect(r.gaps.length).toBeGreaterThan(0)
    const base = r.simulation.total
    // Orden descendente y cada «desbloquea» coincide con la diferencia real al agregar la prenda al armario.
    for (let i = 0; i < r.complements.length; i++) {
      const c = r.complements[i]
      expect(c.unlocks).toBeGreaterThan(0)
      if (i > 0) expect(c.unlocks).toBeLessThanOrEqual(r.complements[i - 1].unlocks)
      const hyp = hypotheticalGarment({ ...c })
      const after = simulateWithGarment(cand, { garments: [...wardrobe30, hyp] })
      expect(after.total - base).toBe(c.unlocks)
    }
    const top = r.complements[0]
    console.info(`[medido] (c) camisa f5: base ${base} outfits; complemento «${top.label}» desbloquea ${top.unlocks} (todos: ${r.complements.map((c) => `${c.label}=${c.unlocks}`).join('; ')})`)
  })

  it('analyzeGaps explica el espacio que falta (calzado sin formalidad compatible)', () => {
    const cand = item('top', 'camisa', ['blanco'], 5)
    const wardrobe = wardrobe30.filter((g) => g.id !== 'sho-zapatos-vestir')
    const gaps = analyzeGaps(cand, wardrobe)
    expect(gaps.some((g) => g.kind === 'missing_slot' && g.slot === 'shoes' && /formalidad 4–5/.test(g.message))).toBe(true)
  })

  it('analyzeGaps avisa de climas sin outfits y de colores sin neutros', () => {
    const noOuter = wardrobe30.filter((g) => g.category !== 'outerwear')
    const gaps = analyzeGaps(navyChinos(), noOuter)
    expect(gaps.some((g) => g.kind === 'weather' && /frío/.test(g.message))).toBe(true)
    const loud = item('top', 'playera', ['rojo'], 2)
    const loudWardrobe = [item('bottom', 'jeans', ['verde'], 2, { status: 'active' }), item('shoes', 'tenis', ['rosa'], 2, { status: 'active' })]
    expect(analyzeGaps(loud, loudWardrobe).filter((g) => g.kind === 'color')).toHaveLength(2)
  })
})

describe('(d) mejora con IA: nunca se confían sus números ni enlaces', () => {
  const aiJson = {
    explanation: 'Te falta calzado formal. Mira https://tienda.example.com/zapato por $1,299 MXN o www.zapatos.mx/oferta',
    complements: [
      {
        category: 'shoes',
        subcategory: 'zapato de vestir',
        colors: ['negro'],
        formality: 5,
        warmth: 2,
        fit: 'regular',
        reason: 'Compra en https://tienda.example.com/x por $999',
        unlocks: 999,
        outfits_unlocked: 777,
      },
      // No desbloquea nada: se descarta.
      { category: 'top', subcategory: 'playera', colors: ['blanco'], formality: 1, warmth: 1, fit: 'regular', reason: '', unlocks: 50 },
    ],
  }

  it('recalcula "desbloquea N" con el motor y elimina enlaces y precios', async () => {
    const cand = statementTop()
    const ai = new MockAiProvider({ json: aiJson })
    const r = await evaluatePurchase(cand, wardrobe30, { ai })
    expect(r.usedAi).toBe(true)
    expect(ai.jsonCalls).toHaveLength(1)
    // Solo atributos: sin fotos.
    expect(ai.jsonCalls[0].images).toBeUndefined()
    expect(ai.jsonCalls[0].user).not.toMatch(/photo/i)
    expect(r.complements).toHaveLength(1)
    const c = r.complements[0]
    expect(c.source).toBe('ai')
    const real = unlockedByComplement(cand, wardrobe30, simulateWithGarment(cand, { garments: wardrobe30 }), {
      category: 'shoes', subcategory: 'zapato de vestir', colors: ['negro'], formality: 5, warmth: 2, fit: 'regular',
    })
    expect(real).toBeGreaterThan(0)
    expect(c.unlocks).toBe(real)
    expect(c.unlocks).not.toBe(999)
    expect(JSON.stringify(r)).not.toMatch(/https?:|www\.|\.example\.com|\$\s?\d|MXN/)
    expect(r.explanation).toContain('Te falta calzado formal')
    expect(r.explanation.length).toBeLessThanOrEqual(400)
  })

  it('si ningún complemento de la IA sirve, usa las reglas con un aviso', async () => {
    const ai = new MockAiProvider({ json: { explanation: 'x', complements: [aiJson.complements[1]] } })
    const r = await evaluatePurchase(statementTop(), wardrobe30, { ai })
    expect(r.complements.length).toBeGreaterThan(0)
    expect(r.complements.every((c) => c.source === 'rules')).toBe(true)
    expect(r.note).toMatch(/reglas/)
  })

  it('error de la IA: resultado por reglas con nota en español', async () => {
    const ai = new MockAiProvider({ error: new AiNetworkError('sin red') })
    const r = await evaluatePurchase(statementTop(), wardrobe30, { ai })
    expect(r.usedAi).toBe(false)
    expect(r.complements.length).toBeGreaterThan(0)
    expect(r.note).toMatch(/Se usó el análisis por reglas/)
  })

  it('respuesta inválida (categoría desconocida): también cae a reglas', async () => {
    const ai = new MockAiProvider({ json: { explanation: 'x', complements: [{ ...aiJson.complements[0], category: 'sombrero' }] } })
    const r = await evaluatePurchase(statementTop(), wardrobe30, { ai })
    expect(r.usedAi).toBe(false)
    expect(r.complements.length).toBeGreaterThan(0)
  })

  it('sin IA configurada: nota de reglas', async () => {
    const r = await evaluatePurchase(statementTop(), wardrobe30)
    expect(r.note).toMatch(/Sin IA/)
  })

  it('sanitizeText quita URLs, dominios y precios', () => {
    expect(sanitizeText('Visita www.tienda.com.mx/ropa y https://a.b/c, cuesta $1,200.50 MXN.')).toBe('Visita y cuesta.')
  })

  it('toStoredEvaluation produce el resumen guardable', async () => {
    const cand = navyChinos()
    const r = await evaluatePurchase(cand, wardrobe30)
    const s = toStoredEvaluation(cand.id, r)
    expect(s).toMatchObject({ garmentId: cand.id, verdict: 'buy', outfitCount: r.simulation.total })
    expect(s.details.occasionCount).toBe(r.simulation.occasionCount)
    expect(s.details.examples.length).toBeGreaterThan(0)
    expect(() => JSON.stringify(s)).not.toThrow()
  })
})

function bigWardrobe(count: number): Garment[] {
  const plan: [Category, string[], number[]][] = [
    ['top', ['playera', 'polo', 'camisa', 'suéter'], [1, 2, 3, 4, 5]],
    ['bottom', ['jeans', 'chinos', 'pantalón de vestir', 'shorts'], [1, 2, 3, 4, 5]],
    ['shoes', ['tenis', 'mocasines', 'zapatos de vestir', 'botas'], [1, 2, 3, 4, 5]],
    ['outerwear', ['chamarra', 'blazer', 'abrigo'], [2, 3, 4, 5]],
    ['accessory', ['reloj', 'cinturón', 'gorra'], [1, 3, 4]],
  ]
  const weights: Category[] = ['top', 'top', 'top', 'bottom', 'bottom', 'shoes', 'shoes', 'outerwear', 'accessory']
  const colors = ['negro', 'blanco', 'gris', 'azul marino', 'beige', 'café', 'rojo', 'verde']
  const out: Garment[] = []
  for (let i = 0; i < count; i++) {
    const cat = weights[i % weights.length]
    const [, subs, forms] = plan.find((p) => p[0] === cat)!
    out.push(item(cat, subs[i % subs.length], [colors[(i * 3) % colors.length]], forms[(i * 7) % forms.length], {
      id: `big-${i}`, status: 'active', warmth: 1 + ((i * 5) % 5), is_statement: i % 17 === 0,
      occasions: [OCCASIONS[i % 6] as Occasion],
    }))
  }
  return out
}

describe('rendimiento con 120 prendas', () => {
  const wardrobe = bigWardrobe(120)

  it('simulateWithGarment < 500 ms', () => {
    const cands = [navyChinos(), statementTop(), item('shoes', 'zapatos', ['negro'], 4), item('outerwear', 'blazer', ['gris'], 4)]
    const times = cands.map((c) => {
      const t = performance.now()
      const r = simulateWithGarment(c, { garments: wardrobe })
      const ms = performance.now() - t
      expect(r.total).toBeGreaterThanOrEqual(0)
      return ms
    })
    console.info(`[medido] simulateWithGarment 120 prendas: ${times.map((x) => x.toFixed(1)).join(', ')} ms`)
    expect(Math.max(...times)).toBeLessThan(500)
  })

  it('evaluatePurchase completo (con complementos) en tiempo razonable', async () => {
    const t = performance.now()
    await evaluatePurchase(navyChinos(), wardrobe)
    const ms = performance.now() - t
    console.info(`[medido] evaluatePurchase 120 prendas: ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(5000)
  })
})

describe('(e) Qué le falta a mi armario', () => {
  it('3 sugerencias que desbloquean > 0 outfits nuevos, sin repetir espacio + formalidad', () => {
    const t = performance.now()
    const s = computeWardrobeGaps(wardrobe30)
    const ms = performance.now() - t
    console.info(`[medido] (e) wardrobe30: ${s.map((x) => `${x.label}=${x.unlocks}`).join('; ')} en ${ms.toFixed(1)} ms`)
    expect(s).toHaveLength(3)
    for (const x of s) expect(x.unlocks).toBeGreaterThan(0)
    expect(new Set(s.map((x) => `${x.descriptor.category}-${x.descriptor.formality}`)).size).toBe(3)
    expect([...s].sort((a, b) => b.unlocks - a.unlocks)).toEqual(s)
    expect(ms).toBeLessThan(2000)
  })

  it('el número coincide con simular la prenda hipotética en el armario', () => {
    const [top] = computeWardrobeGaps(wardrobe30)
    const sim = simulateWithGarment(hypotheticalGarment(top.descriptor), { garments: wardrobe30 })
    expect(sim.total).toBe(top.unlocks)
  })

  it('con 120 prendas termina en < 2 s', () => {
    const wardrobe = bigWardrobe(120)
    const t = performance.now()
    const s = computeWardrobeGaps(wardrobe)
    const ms = performance.now() - t
    console.info(`[medido] (e) 120 prendas: ${s.map((x) => `${x.label}=${x.unlocks}`).join('; ')} en ${ms.toFixed(1)} ms`)
    expect(s).toHaveLength(3)
    expect(ms).toBeLessThan(2000)
  })

  it('con un armario vacío no hay sugerencias que desbloqueen nada', () => {
    expect(computeWardrobeGaps([])).toEqual([])
  })

  it('la IA solo agrega frases; los números no cambian y se quitan enlaces', async () => {
    const s = computeWardrobeGaps(wardrobe30)
    const ai = new MockAiProvider({ json: { phrases: ['Te ayuda mucho https://x.com', 'Otra', 'Y otra'], unlocks: [1, 2, 3] } })
    const phrased = await phraseWardrobeGaps(ai, s)
    expect(phrased.map((x) => x.unlocks)).toEqual(s.map((x) => x.unlocks))
    expect(phrased[0].phrase).toBe('Te ayuda mucho')
    const failed = await phraseWardrobeGaps(new MockAiProvider({ error: new AiNetworkError('x') }), s)
    expect(failed).toEqual(s)
  })
})

describe('suggestComplements', () => {
  it('descripciones en español y concordancia de género', () => {
    const list = suggestComplements(statementTop(), wardrobe30)
    expect(list.length).toBeGreaterThan(0)
    for (const c of list) expect(c.label).toMatch(/^[A-ZÁÉÍÓÚ].*, formalidad [1-5]$/)
  })
  it('es determinista', () => {
    const a = suggestComplements(statementTop(), wardrobe30)
    const b = suggestComplements(statementTop(), [...wardrobe30].reverse())
    expect(b.map((c) => [c.label, c.unlocks])).toEqual(a.map((c) => [c.label, c.unlocks]))
  })
  it('no sugiere el mismo espacio que la candidata', () => {
    expect(suggestComplements(navyChinos(), wardrobe30).every((c) => c.category !== 'bottom')).toBe(true)
  })
  it('descriptor de ejemplo del enunciado', () => {
    const d: ComplementDescriptor = { category: 'shoes', subcategory: 'zapato de vestir', colors: ['negro'], formality: 4, warmth: 2, fit: 'regular' }
    expect(hypotheticalGarment(d).status).toBe('active')
  })
})
