import { beforeEach, describe, expect, it } from 'vitest'
import {
  CRASHED_KEY,
  IN_FLIGHT_KEY,
  SKIP_KEY,
  addSkip,
  checkPreviousCrash,
  clearInFlight,
  getSkipList,
  markInFlight,
  resetCrashGuardForTests,
  withInFlight,
} from '../src/cutout/crashGuard'
import { getEnginePreference, setEnginePreference } from '../src/cutout/enginePref'
import { MockBackgroundRemover } from '../src/cutout/mock'
import { generateCutout, queueCutout } from '../src/cutout/pipeline'
import { fakeRepo } from './fixtures/fakeRepo'

beforeEach(() => {
  localStorage.clear()
  resetCrashGuardForTests()
})

describe('motor preferido', () => {
  it("migra 'auto' (y valores desconocidos o ausentes) a 'wasm'", () => {
    expect(getEnginePreference()).toBe('wasm')
    localStorage.setItem('armario.cutoutEngine', 'auto')
    expect(getEnginePreference()).toBe('wasm')
    expect(localStorage.getItem('armario.cutoutEngine')).toBe('wasm')
  })

  it('WebGPU solo si se eligió a mano', () => {
    setEnginePreference('webgpu')
    expect(getEnginePreference()).toBe('webgpu')
  })
})

describe('marca de recorte en curso', () => {
  it('se escribe antes y se borra al terminar, también si falla', async () => {
    await withInFlight('g1', async () => {
      expect(JSON.parse(localStorage.getItem(IN_FLIGHT_KEY)!)).toMatchObject({ garmentId: 'g1' })
    })
    expect(localStorage.getItem(IN_FLIGHT_KEY)).toBeNull()
    await expect(withInFlight('g1', async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(localStorage.getItem(IN_FLIGHT_KEY)).toBeNull()
  })

  it('una marca de una sesión anterior = cierre: avisa, fuerza WASM y omite la prenda', () => {
    setEnginePreference('webgpu')
    localStorage.setItem(IN_FLIGHT_KEY, JSON.stringify({ garmentId: 'g9', startedAt: 1 }))
    expect(checkPreviousCrash()).toBe(true)
    expect(localStorage.getItem(IN_FLIGHT_KEY)).toBeNull()
    expect(localStorage.getItem(CRASHED_KEY)).not.toBeNull()
    expect(getEnginePreference()).toBe('wasm')
    expect(getSkipList()).toEqual(['g9'])
    expect(JSON.parse(localStorage.getItem(SKIP_KEY)!)).toEqual(['g9'])
    expect(checkPreviousCrash()).toBe(false)
  })

  it('la marca de un recorte en curso en esta misma sesión no es un cierre', () => {
    markInFlight('g1')
    expect(checkPreviousCrash()).toBe(false)
    expect(localStorage.getItem(CRASHED_KEY)).toBeNull()
    clearInFlight()
  })

  it('sin prenda en la marca igual se detecta el cierre, sin omitir nada', () => {
    localStorage.setItem(IN_FLIGHT_KEY, JSON.stringify({ startedAt: 1 }))
    expect(checkPreviousCrash()).toBe(true)
    expect(getSkipList()).toEqual([])
  })
})

describe('el pipeline respeta la protección', () => {
  const photo = new Blob(['p'], { type: 'image/jpeg' })
  const bbox = { x: 0, y: 0, w: 0.5, h: 0.5 }
  const crop = async () => new Blob(['crop'])

  it('una prenda omitida no usa el modelo: va al plan B y no se reintenta sola', async () => {
    addSkip('g1')
    const remover = new MockBackgroundRemover()
    const out = await generateCutout(photo, { remover, garmentId: 'g1', bbox, cropBBox: crop })
    expect(remover.removeCalls).toHaveLength(0)
    expect(out.result).toMatchObject({ kind: 'bbox' })
  })

  it('generateCutout anota la marca durante el recorte y la limpia después', async () => {
    let seen: string | null = null
    const remover = new MockBackgroundRemover()
    const orig = remover.remove.bind(remover)
    remover.remove = async (b) => {
      seen = localStorage.getItem(IN_FLIGHT_KEY)
      return orig(b)
    }
    await generateCutout(photo, { remover, garmentId: 'g2' })
    expect(JSON.parse(seen!)).toMatchObject({ garmentId: 'g2' })
    expect(localStorage.getItem(IN_FLIGHT_KEY)).toBeNull()
  })

  it('al primer uso detecta el cierre anterior y omite esa prenda', async () => {
    localStorage.setItem(IN_FLIGHT_KEY, JSON.stringify({ garmentId: 'g3', startedAt: 1 }))
    const remover = new MockBackgroundRemover()
    await generateCutout(photo, { remover, garmentId: 'g3', bbox, cropBBox: crop })
    expect(remover.removeCalls).toHaveLength(0)
    expect(localStorage.getItem(CRASHED_KEY)).not.toBeNull()
  })

  it('queueCutout no usa el modelo mientras el aviso de cierre siga sin confirmar', async () => {
    localStorage.setItem(CRASHED_KEY, '1')
    const repo = fakeRepo([])
    repo.getPhoto = async () => photo
    const g = await repo.create({ category: 'top', formality: 3, warmth: 2, photo_path: 'photo:1' })
    const remover = new MockBackgroundRemover()
    await queueCutout(repo, remover, g)
    expect(remover.removeCalls).toHaveLength(0)
  })
})
