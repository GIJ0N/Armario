/// <reference lib="webworker" />
// Worker de inferencia: solo ejecuta el modelo ONNX (todo el trabajo con canvas queda en el hilo principal).
// Un solo hilo de WASM: GitHub Pages no envía COOP/COEP, así que no hay SharedArrayBuffer.
// El heap de WASM nunca se encoge: el hilo principal recicla (termina) este worker cada pocas inferencias.
import { EngineFallbackError, SessionManager, type OrtLike } from './engineSession'
import { ORT_WASM_URL, ORT_WEBGPU_WASM_URL } from './runtimeAssets'
import { readCachedModel } from './modelStore'
import type { EnginePreference, WorkerEngine, WorkerRequest, WorkerResponse } from './protocol'

const manager = new SessionManager({
  readModel: readCachedModel,
  loadOrt: async (engine) =>
    (engine === 'webgpu' ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm')) as unknown as OrtLike,
  wasmUrl: (engine) => (engine === 'webgpu' ? ORT_WEBGPU_WASM_URL : ORT_WASM_URL),
})
let preference: EnginePreference = 'wasm'

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer)
const fail = (err: unknown, id?: number): WorkerResponse => ({
  type: 'error',
  id,
  message: err instanceof Error ? err.message : String(err),
  fallback: err instanceof EngineFallbackError || undefined,
})

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  const engine = (): WorkerEngine => (preference === 'webgpu' ? 'webgpu' : 'wasm')
  if (msg.type === 'init') {
    preference = msg.preference
    try {
      post({ type: 'ready', engine: await manager.init(engine()) })
    } catch (err) {
      post(fail(err))
    }
    return
  }
  try {
    const { alpha, engine: used } = await manager.run(engine(), msg.data, msg.size)
    post({ type: 'result', id: msg.id, alpha, size: msg.size, engine: used }, [alpha.buffer])
  } catch (err) {
    post(fail(err, msg.id))
  }
}
