import { describe, expect, it } from 'vitest'
import { AI_MAX_EDGE, MAX_EDGE, downscaleForAi, fitWithin } from '../src/lib/image'

describe('tamaños de imagen', () => {
  it('la foto guardada llega a 1600 px y la de la IA a 1024 px', () => {
    expect(MAX_EDGE).toBe(1600)
    expect(AI_MAX_EDGE).toBe(1024)
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(1600, 1200, AI_MAX_EDGE)).toEqual({ width: 1024, height: 768 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('downscaleForAi devuelve la original si no se puede decodificar', async () => {
    const photo = new Blob(['x'], { type: 'image/jpeg' })
    expect(await downscaleForAi(photo)).toBe(photo)
  })
})
