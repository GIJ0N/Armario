import { useCallback, useEffect, useRef, useState } from 'react'
import { createCutoutFor, runExclusive, useBackgroundRemover } from '../cutout'
import { getEnginePreference, setEnginePreference, webGpuAvailable } from '../cutout/enginePref'
import { CUTOUT_MODEL } from '../cutout/modelConfig'
import { cachedModelBytes } from '../cutout/modelStore'
import type { EnginePreference } from '../cutout/protocol'
import type { Garment } from '../db'
import { useRepository } from './RepositoryContext'

function megabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(0)} MB`
}

function nameOf(g: Garment) {
  return g.subcategory || g.category
}

interface Diagnostic {
  text: string
  previewUrl: string | null
  error: boolean
}

/** Ajustes › «Recorte de fondo»: modelo, motor, procesar prendas sin recorte y diagnóstico de rendimiento. */
export function CutoutSettings() {
  const repo = useRepository()
  const remover = useBackgroundRemover()
  const [downloaded, setDownloaded] = useState<boolean | null>(null)
  const [sizeBytes, setSizeBytes] = useState<number | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [engine, setEngine] = useState<EnginePreference>(getEnginePreference)
  const [garments, setGarments] = useState<Garment[]>([])
  const [batch, setBatch] = useState<{ done: number; total: number; cancelling: boolean } | null>(null)
  const [batchMessage, setBatchMessage] = useState<string | null>(null)
  const cancelRef = useRef(false)
  const [testId, setTestId] = useState('')
  const [testing, setTesting] = useState(false)
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null)

  const withPhoto = garments.filter((g) => !!g.photo_path)
  const pending = withPhoto.filter((g) => !g.cutout_path)
  const selected = withPhoto.find((g) => g.id === testId) ?? withPhoto[0]

  const refresh = useCallback(async () => {
    const [isDown, list] = await Promise.all([remover.isDownloaded().catch(() => false), repo.list().catch(() => [])])
    setDownloaded(isDown)
    setGarments(list)
    setSizeBytes(isDown ? await cachedModelBytes().catch(() => null) : null)
  }, [remover, repo])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  useEffect(() => {
    const url = diagnostic?.previewUrl
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [diagnostic?.previewUrl])

  async function download() {
    setDownloadError(null)
    setProgress(0)
    try {
      await remover.ready((p) => setProgress(p.fraction))
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'No se pudo descargar el modelo.')
    } finally {
      setProgress(null)
      await refresh()
    }
  }

  function changeEngine(pref: EnginePreference) {
    setEngine(pref)
    setEnginePreference(pref)
    remover.dispose?.()
  }

  async function processBatch(queue: Garment[]) {
    cancelRef.current = false
    setBatchMessage(null)
    setBatch({ done: 0, total: queue.length, cancelling: false })
    let ok = 0
    let failed = 0
    let done = 0
    for (const g of queue) {
      if (cancelRef.current) break
      try {
        const out = await runExclusive(() => createCutoutFor(repo, g, { remover }))
        if (out.result) ok++
        else failed++
      } catch {
        failed++
      }
      done++
      setBatch({ done, total: queue.length, cancelling: cancelRef.current })
    }
    const cancelled = cancelRef.current
    setBatch(null)
    setBatchMessage(
      `${cancelled ? 'Cancelado. ' : ''}${ok} prenda${ok === 1 ? '' : 's'} con recorte${failed ? `, ${failed} sin resultado` : ''}.`,
    )
    await refresh()
  }

  async function runTest() {
    if (!selected?.photo_path) return
    setTesting(true)
    setDiagnostic(null)
    const gpu = webGpuAvailable() ? 'sí' : 'no'
    try {
      const photo = await repo.getPhoto(selected.photo_path)
      if (!photo) throw new Error('No se encontró la foto de la prenda.')
      const result = await runExclusive(async () => {
        const t0 = performance.now()
        await remover.ready()
        const t1 = performance.now()
        const blob = await remover.remove(photo)
        const t2 = performance.now()
        return { blob, loadMs: Math.round(t1 - t0), cutMs: Math.round(t2 - t1) }
      })
      setDiagnostic({
        error: false,
        previewUrl: URL.createObjectURL(result.blob),
        text: [
          `Motor usado: ${remover.lastEngine ?? 'desconocido'}`,
          `Recorte: ${result.cutMs} ms`,
          `Carga del modelo: ${result.loadMs} ms (alta solo la primera vez)`,
          `Foto original: ${Math.round(photo.size / 1024)} KB`,
          `WebGPU disponible: ${gpu} · Preferencia: ${engine === 'auto' ? 'automático' : 'solo WASM'}`,
        ].join('\n'),
      })
    } catch (e) {
      setDiagnostic({
        error: true,
        previewUrl: null,
        text: `No se pudo recortar: ${e instanceof Error ? e.message : String(e)}\nWebGPU disponible: ${gpu} · Preferencia: ${engine === 'auto' ? 'automático' : 'solo WASM'}`,
      })
    } finally {
      setTesting(false)
    }
  }

  const modelState =
    progress !== null
      ? `Descargando ${Math.round(progress * 100)} %`
      : downloaded === null
        ? 'Comprobando…'
        : downloaded
          ? `Listo (${megabytes(sizeBytes ?? CUTOUT_MODEL.approxBytes)})`
          : `No descargado (≈ ${megabytes(CUTOUT_MODEL.approxBytes)})`

  return (
    <>
      <h2 className="section-title">Recorte de fondo</h2>
      <p className="page-hint">
        Quita el fondo de las fotos en tu teléfono con el modelo {CUTOUT_MODEL.name}. Se descarga una sola vez
        (conviene con Wi-Fi) y después funciona sin conexión. La foto original siempre se conserva.
      </p>
      <p className="page-hint" data-testid="cutout-model-state">
        Modelo: {modelState}
      </p>
      {progress !== null && <progress className="cutout-progress" max={1} value={progress} aria-label="Avance de la descarga" />}
      {downloadError && (
        <p role="alert" className="form-error">
          {downloadError}
        </p>
      )}
      <button type="button" className="btn" disabled={progress !== null || downloaded === true} onClick={() => void download()}>
        {downloaded ? 'Modelo descargado' : 'Descargar modelo'}
      </button>

      <label className="field">
        <span>Motor de recorte</span>
        <select value={engine} onChange={(e) => changeEngine(e.target.value as EnginePreference)}>
          <option value="auto">Automático (WebGPU si está disponible)</option>
          <option value="wasm">Solo WASM (más compatible)</option>
        </select>
      </label>

      <button
        type="button"
        className="btn"
        disabled={!downloaded || batch !== null || pending.length === 0}
        onClick={() => void processBatch(pending)}
      >
        Procesar prendas sin recorte ({pending.length})
      </button>
      <button
        type="button"
        className="btn"
        disabled={!downloaded || batch !== null || withPhoto.length === 0}
        onClick={() => void processBatch(withPhoto)}
      >
        Rehacer todos los recortes ({withPhoto.length})
      </button>
      <p className="page-hint">Útil tras una mejora de la limpieza: vuelve a recortar cada foto con el modelo. Si una falla, se conserva su recorte actual.</p>
      {batch && (
        <>
          <p className="page-hint" role="status">
            Procesando {Math.min(batch.done + 1, batch.total)} de {batch.total}…
          </p>
          <progress className="cutout-progress" max={batch.total} value={batch.done} aria-label="Avance del procesamiento" />
          <button
            type="button"
            className="btn btn-quiet"
            disabled={batch.cancelling}
            onClick={() => {
              cancelRef.current = true
              setBatch({ ...batch, cancelling: true })
            }}
          >
            {batch.cancelling ? 'Cancelando…' : 'Cancelar'}
          </button>
        </>
      )}
      {batchMessage && (
        <p className="page-hint" role="status">
          {batchMessage}
        </p>
      )}

      <h3 className="section-title">Diagnóstico</h3>
      <p className="page-hint">
        Recorta una prenda sin guardar el resultado y muestra cuánto tarda y qué motor se usó. Copia o fotografía el
        resultado para compartir cómo rinde en tu iPhone.
      </p>
      {withPhoto.length > 0 && (
        <label className="field">
          <span>Prenda de prueba</span>
          <select value={selected?.id ?? ''} onChange={(e) => setTestId(e.target.value)}>
            {withPhoto.map((g) => (
              <option key={g.id} value={g.id}>
                {nameOf(g)}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className="btn" disabled={!downloaded || testing || !selected} onClick={() => void runTest()}>
        {testing ? 'Probando…' : 'Probar recorte'}
      </button>
      {!downloaded && downloaded !== null && <p className="page-hint">Descarga el modelo para poder probar el recorte.</p>}
      {diagnostic && (
        <>
          <pre className="cutout-diagnostic" data-testid="cutout-diagnostic" role={diagnostic.error ? 'alert' : 'status'}>
            {diagnostic.text}
          </pre>
          {diagnostic.previewUrl && (
            <div className="cutout-preview">
              <img className="garment-img garment-img-cutout" src={diagnostic.previewUrl} alt="Resultado de la prueba de recorte" />
            </div>
          )}
        </>
      )}
    </>
  )
}
