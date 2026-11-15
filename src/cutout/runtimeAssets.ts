// Vite empaqueta estos .wasm con la app (mismo origen): así no dependen de un CDN. No se precachean (pesan
// 15 y 29 MB): el service worker los guarda en tiempo de ejecución (CacheFirst) la primera vez que se usan.
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import webgpuWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'

export const ORT_WASM_URL: string = wasmUrl
export const ORT_WEBGPU_WASM_URL: string = webgpuWasmUrl
