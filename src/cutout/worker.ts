/// <reference lib="webworker" />
// Worker de inferencia: solo ejecuta el modelo ONNX (todo el trabajo con canvas queda en el hilo principal).
// Un solo hilo de WASM: GitHub Pages no envía COOP/COEP, así que no hay SharedArrayBuffer.
import { alphaCoverage, maskToAlpha } from './geometry'
import { MIN_MASK_COVERAGE } from './modelConfig'
import { ORT_WASM_URL, ORT_WEBGPU_WASM_URL } from './runtimeAssets'
import { webGpuAvailable } from './enginePref'
import { readCachedModel } from './modelStore'
import type { EnginePreference, WorkerEngine, WorkerRequest, WorkerResponse } from './protocol'

type Ort = typeof import('onnxruntime-web/wasm')
type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>

interface Loaded {
  ort: Ort
  session: Session
  engine: WorkerEngine
}

let modelBytes: Uint8Array | null = null
let loaded: Loaded | null = null
let preference: EnginePreference = 'auto'

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer)

async function loadEngine(engine: WorkerEngine): Promise<Loaded> {
  if (!modelBytes) {
    const buf = await readCachedModel()
    if (!buf) throw new Error('El modelo no está descargado.')
    modelBytes = new Uint8Array(buf)
  }
  const ort =
    engine === 'webgpu'
      ? ((await import('onnxruntime-web/webgpu')) as unknown as Ort)
      : await import('onnxruntime-web/wasm')
  ort.env.wasm.wasmPaths = { wasm: engine === 'webgpu' ? ORT_WEBGPU_WASM_URL : ORT_WASM_URL }
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  const session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: [engine],
    graphOptimizationLevel: 'all',
  })
  return { ort, session, engine }
}

async function init(): Promise<Loaded> {
  if (loaded) return loaded
  if (preference === 'auto' && webGpuAvailable()) {
    try {
      loaded = await loadEngine('webgpu')
      return loaded
    } catch {
      /* sin WebGPU utilizable: se sigue con WASM */
    }
  }
  loaded = await loadEngine('wasm')
  return loaded
}

async function infer(l: Loaded, data: Float32Array, size: number): Promise<Float32Array> {
  const input = new l.ort.Tensor('float32', data, [1, 3, size, size])
  const outputs = await l.session.run({ [l.session.inputNames[0]]: input })
  const out = outputs[l.session.outputNames[0]]
  return Float32Array.from((await out.getData()) as Float32Array)
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'init') {
    preference = msg.preference
    try {
      const l = await init()
      post({ type: 'ready', engine: l.engine })
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  try {
    let l = await init()
    let mask = await infer(l, msg.data, msg.size)
    // WebGPU con pesos int8 puede devolver una máscara vacía o con NaN: se repite una vez con WASM.
    if (l.engine === 'webgpu' && alphaCoverage(maskToAlpha(mask)) < MIN_MASK_COVERAGE) {
      loaded = await loadEngine('wasm')
      l = loaded
      mask = await infer(l, msg.data, msg.size)
    }
    post({ type: 'result', id: msg.id, mask, size: msg.size, engine: l.engine }, [mask.buffer])
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
  }
}
