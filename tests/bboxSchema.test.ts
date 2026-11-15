import { describe, expect, it } from 'vitest'
import { DEFAULT_MOCK_GARMENT } from '../src/ai/mock'
import { bboxSchema, taggedGarmentSchema } from '../src/ai/provider'
import { TAG_GARMENT_JSON_SCHEMA } from '../src/ai/prompts/tagGarment'

const tag = (bbox?: unknown) => taggedGarmentSchema.parse({ ...DEFAULT_MOCK_GARMENT, ...(bbox === undefined ? {} : { bbox }) })

describe('bbox opcional de la IA', () => {
  it('acepta un cuadro válido', () => {
    expect(tag({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 }).bbox).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 })
    expect(tag({ x: 0, y: 0, w: 1, h: 1 }).bbox).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('sin bbox el etiquetado sigue siendo válido (compatibilidad)', () => {
    const parsed = tag()
    expect(parsed.bbox).toBeUndefined()
    expect(parsed.category).toBe('top')
  })

  it.each([
    ['negativo', { x: -0.1, y: 0, w: 0.5, h: 0.5 }],
    ['se sale por la derecha', { x: 0.6, y: 0, w: 0.6, h: 0.5 }],
    ['se sale por abajo', { x: 0, y: 0.7, w: 0.5, h: 0.5 }],
    ['ancho cero', { x: 0.2, y: 0.2, w: 0, h: 0.5 }],
    ['demasiado pequeño', { x: 0.2, y: 0.2, w: 0.01, h: 0.5 }],
    ['en píxeles, no normalizado', { x: 100, y: 50, w: 300, h: 400 }],
    ['faltan campos', { x: 0.1, y: 0.1 }],
    ['no es un objeto', 'todo'],
    ['texto en vez de número', { x: '0.1', y: 0.1, w: 0.5, h: 0.5 }],
    ['nulo', null],
  ])('un bbox inválido (%s) se ignora sin hacer fallar el etiquetado', (_name, bbox) => {
    const parsed = tag(bbox)
    expect(parsed.bbox).toBeUndefined()
    expect(parsed.formality).toBe(DEFAULT_MOCK_GARMENT.formality)
  })

  it('bboxSchema valida directamente', () => {
    expect(bboxSchema.safeParse({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }).success).toBe(true)
    expect(bboxSchema.safeParse({ x: 0.5, y: 0.5, w: 0.6, h: 0.5 }).success).toBe(false)
  })

  it('el responseSchema de Gemini declara bbox como opcional', () => {
    expect(TAG_GARMENT_JSON_SCHEMA.properties.bbox.required).toEqual(['x', 'y', 'w', 'h'])
    expect(TAG_GARMENT_JSON_SCHEMA.required).not.toContain('bbox')
  })
})
