import { describe, expect, it, vi } from 'vitest'
import {
  EngineFallbackError,
  SESSION_OPTIONS,
  SessionManager,
  type OrtLike,
  type SessionLike,
  type TensorLike,
} from '../src/cutout/engineSession'

function makeOrt(outputFor: (engine: string) => Float32Array) {
  const sessions: { released: boolean; options: Record<string, unknown>; engine: string }[] = []
  let live = 0
  let maxLive = 0
  const ort: OrtLike = {
    env: { wasm: {} },
    Tensor: class implements TensorLike {
      data: Float32Array
      constructor(_type: string, data: Float32Array, ...rest: unknown[]) {
        void rest
        this.data = data
      }
      async getData() {
        return this.data
      }
      dispose() {}
    } as unknown as OrtLike['Tensor'],
    InferenceSession: {
      async create(_model, options) {
        const rec = { released: false, options, engine: (options.executionProviders as string[])[0] }
        sessions.push(rec)
        live++
        maxLive = Math.max(maxLive, live)
        const session: SessionLike = {
          inputNames: ['in'],
          outputNames: ['out'],
          async run() {
            const data = outputFor(rec.engine)
            return { out: { getData: async () => data, dispose() {} } }
          },
          async release() {
            if (!rec.released) live--
            rec.released = true
          },
        }
        return session
      },
    },
  }
  return { ort, sessions, maxLive: () => maxLive }
}

const model = () => new Uint8Array(8).buffer
const good = (n = 16) => Float32Array.from({ length: n }, (_, i) => (i < n / 2 ? 0 : 1))

function manager(ort: OrtLike) {
  return new SessionManager({ readModel: async () => model(), loadOrt: async () => ort, wasmUrl: () => '/x.wasm' })
}

describe('SessionManager', () => {
  it('crea la sesión con opciones de poca memoria', async () => {
    const { ort, sessions } = makeOrt(() => good())
    await manager(ort).init('wasm')
    expect(sessions[0].options).toMatchObject({ ...SESSION_OPTIONS, executionProviders: ['wasm'] })
    expect(SESSION_OPTIONS).toMatchObject({
      graphOptimizationLevel: 'basic',
      enableCpuMemArena: false,
      enableMemPattern: false,
      executionMode: 'sequential',
    })
    expect(ort.env.wasm.numThreads).toBe(1)
  })

  it('reutiliza la sesión y devuelve el alfa en bytes (no el Float32)', async () => {
    const { ort, sessions } = makeOrt(() => good())
    const m = manager(ort)
    const a = await m.run('wasm', new Float32Array(3), 4)
    const b = await m.run('wasm', new Float32Array(3), 4)
    expect(a.alpha).toBeInstanceOf(Uint8ClampedArray)
    expect(Array.from(b.alpha.slice(0, 2))).toEqual([0, 0])
    expect(sessions).toHaveLength(1)
  })

  it('no suelta los pesos dos veces: tras crear la sesión no retiene el búfer del modelo', async () => {
    const read = vi.fn(async () => model())
    const { ort } = makeOrt(() => good())
    const m = new SessionManager({ readModel: read, loadOrt: async () => ort, wasmUrl: () => '' })
    await m.init('wasm')
    expect((m as unknown as { modelBytes: unknown }).modelBytes).toBeNull()
  })

  it('WebGPU con máscara vacía: libera la sesión y avisa para reintentar; nunca hay dos sesiones vivas', async () => {
    const { ort, sessions, maxLive } = makeOrt((engine) => (engine === 'webgpu' ? new Float32Array(16) : good()))
    const m = manager(ort)
    await expect(m.run('webgpu', new Float32Array(3), 4)).rejects.toBeInstanceOf(EngineFallbackError)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].released).toBe(true)
    expect(m.engine).toBeNull()
    // No hay segunda sesión automática: solo una nueva petición explícita en WASM la crea.
    await m.run('wasm', new Float32Array(3), 4)
    expect(sessions).toHaveLength(2)
    expect(maxLive()).toBe(1)
  })

  it('WebGPU que falla al crear la sesión: error de reintento, sin sesión viva', async () => {
    const { ort } = makeOrt(() => good())
    ort.InferenceSession.create = async () => {
      throw new Error('sin gpu')
    }
    await expect(manager(ort).init('webgpu')).rejects.toBeInstanceOf(EngineFallbackError)
  })

  it('un fallo en WASM no se disfraza de reintento', async () => {
    const { ort } = makeOrt(() => good())
    ort.InferenceSession.create = async () => {
      throw new Error('oom')
    }
    await expect(manager(ort).init('wasm')).rejects.toThrow('oom')
  })

  it('cambiar de motor libera la sesión anterior antes de crear la nueva', async () => {
    const { ort, sessions, maxLive } = makeOrt(() => good())
    const m = manager(ort)
    await m.init('wasm')
    await m.init('webgpu')
    expect(sessions[0].released).toBe(true)
    expect(maxLive()).toBe(1)
    await m.release()
    expect(sessions[1].released).toBe(true)
  })
})
