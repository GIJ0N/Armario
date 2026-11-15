import { beforeEach, describe, expect, it } from 'vitest'
import { OnnxBackgroundRemover, type RemoverDeps, type WorkerLike } from '../src/cutout/onnxRemover'
import type { WorkerRequest, WorkerResponse } from '../src/cutout/protocol'

class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: WorkerResponse }) => void) | null = null
  onerror: ((e: { message?: string }) => void) | null = null
  terminated = false
  requests: WorkerRequest[] = []
  private behavior: (req: WorkerRequest, w: FakeWorker) => WorkerResponse | null
  constructor(behavior: (req: WorkerRequest, w: FakeWorker) => WorkerResponse | null) {
    this.behavior = behavior
  }
  postMessage(msg: WorkerRequest) {
    this.requests.push(msg)
    const res = this.behavior(msg, this)
    if (res) queueMicrotask(() => this.onmessage?.({ data: res }))
  }
  terminate() {
    this.terminated = true
  }
}

const okBehavior = (req: WorkerRequest): WorkerResponse =>
  req.type === 'init'
    ? { type: 'ready', engine: req.preference }
    : { type: 'result', id: req.id, alpha: new Uint8ClampedArray(4), size: 2, engine: 'wasm' }

function setup(behavior: (req: WorkerRequest, w: FakeWorker) => WorkerResponse | null = okBehavior, extra: Partial<RemoverDeps> = {}) {
  const workers: FakeWorker[] = []
  const pauses: number[] = []
  let pref: 'wasm' | 'webgpu' = 'wasm'
  const remover = new OnnxBackgroundRemover({
    createWorker: () => {
      const w = new FakeWorker(behavior)
      workers.push(w)
      return w
    },
    isCached: async () => true,
    toInput: async () => ({ data: new Float32Array(3), size: 2 }),
    toCutout: async () => new Blob(['cut'], { type: 'image/png' }),
    getPreference: () => pref,
    setPreference: (p) => {
      pref = p
    },
    pause: async (ms) => {
      pauses.push(ms)
    },
    ...extra,
  })
  return { remover, workers, pauses, getPref: () => pref, setPref: (p: 'wasm' | 'webgpu') => (pref = p) }
}

const img = new Blob(['x'])

beforeEach(() => localStorage.clear())

describe('reciclaje del worker', () => {
  it('termina el worker cada 2 inferencias y lo recarga solo, sin errores para quien llama', async () => {
    const { remover, workers, pauses } = setup()
    for (let i = 0; i < 5; i++) await expect(remover.remove(img)).resolves.toBeInstanceOf(Blob)
    // Inferencias 1-2 → worker 1 (reciclado), 3-4 → worker 2 (reciclado), 5 → worker 3 (vivo).
    expect(workers).toHaveLength(3)
    expect(workers.map((w) => w.terminated)).toEqual([true, true, false])
    expect(remover.recycleCount).toBe(2)
    // Cada reciclaje cede un macrotask para que corra el GC.
    expect(pauses).toEqual([80, 80])
    // Cada worker nuevo solo recibe 'init' (lee el modelo de Cache Storage) y sus corridas.
    expect(workers[1].requests.map((r) => r.type)).toEqual(['init', 'run', 'run'])
  })

  it('ready() sigue funcionando después de un reciclaje', async () => {
    const { remover, workers } = setup()
    await remover.remove(img)
    await remover.remove(img)
    expect(workers[0].terminated).toBe(true)
    await expect(remover.ready()).resolves.toBeUndefined()
    expect(workers).toHaveLength(2)
    await expect(remover.remove(img)).resolves.toBeInstanceOf(Blob)
    expect(workers).toHaveLength(2)
  })

  it('tras un fallo recicla de inmediato y la siguiente llamada usa un worker nuevo', async () => {
    let fail = true
    const { remover, workers } = setup((req) =>
      req.type === 'run' && fail ? { type: 'error', id: req.id, message: 'sin memoria' } : okBehavior(req),
    )
    await expect(remover.remove(img)).rejects.toThrow(/sin memoria/)
    expect(workers[0].terminated).toBe(true)
    fail = false
    await expect(remover.remove(img)).resolves.toBeInstanceOf(Blob)
    expect(workers).toHaveLength(2)
    expect(workers[1].terminated).toBe(false)
  })

  it('tras un tiempo agotado (dispose desde fuera) el worker se descarta y no quedan pendientes', async () => {
    const { remover, workers } = setup((req) => (req.type === 'run' ? null : okBehavior(req)))
    const p = remover.remove(img)
    await new Promise((r) => setTimeout(r, 5))
    remover.dispose()
    await expect(p).rejects.toMatchObject({ code: 'cancelled' })
    expect(workers[0].terminated).toBe(true)
    const ok = setup()
    await expect(ok.remover.remove(img)).resolves.toBeInstanceOf(Blob)
  })

  it('las llamadas simultáneas se atienden de una en una', async () => {
    const { remover, workers } = setup()
    await Promise.all([remover.remove(img), remover.remove(img), remover.remove(img)])
    expect(workers).toHaveLength(2)
    expect(remover.recycleCount).toBe(1)
  })

  it('un modelo no descargado no crea ningún worker', async () => {
    const { remover, workers } = setup(okBehavior, { isCached: async () => false })
    await expect(remover.remove(img)).rejects.toMatchObject({ code: 'not-downloaded' })
    expect(workers).toHaveLength(0)
  })
})

describe('WebGPU explícito: caída a WASM con un worker nuevo', () => {
  it('si WebGPU falla al cargar, guarda WASM y reintenta una vez en un worker nuevo', async () => {
    const { remover, workers, getPref, setPref } = setup((req) => {
      if (req.type === 'init' && req.preference === 'webgpu') return { type: 'error', message: 'no gpu', fallback: true }
      return okBehavior(req)
    })
    setPref('webgpu')
    await expect(remover.remove(img)).resolves.toBeInstanceOf(Blob)
    expect(getPref()).toBe('wasm')
    expect(workers).toHaveLength(2)
    expect(workers[0].terminated).toBe(true)
    expect(remover.lastEngine).toBe('wasm')
  })

  it('si WebGPU devuelve una máscara vacía en la inferencia, reintenta con WASM y no hay más de un reintento', async () => {
    let calls = 0
    const { remover, workers, getPref, setPref } = setup((req) => {
      if (req.type === 'init') return { type: 'ready', engine: req.preference }
      calls++
      return calls === 1
        ? { type: 'error', id: req.id, message: 'máscara vacía', fallback: true }
        : { type: 'result', id: req.id, alpha: new Uint8ClampedArray(4), size: 2, engine: 'wasm' }
    })
    setPref('webgpu')
    await expect(remover.remove(img)).resolves.toBeInstanceOf(Blob)
    expect(getPref()).toBe('wasm')
    expect(workers).toHaveLength(2)
    expect(workers[1].requests[0]).toMatchObject({ type: 'init', preference: 'wasm' })
  })

  it('si el reintento también falla, el error llega a quien llama (sin bucle)', async () => {
    const { remover, workers, setPref } = setup((req) =>
      req.type === 'init' ? { type: 'ready', engine: 'wasm' } : { type: 'error', id: req.id, message: 'x', fallback: true },
    )
    setPref('webgpu')
    await expect(remover.remove(img)).rejects.toThrow()
    expect(workers).toHaveLength(2)
  })
})
