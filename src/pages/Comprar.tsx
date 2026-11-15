import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAi } from '../ai/AiProviderContext'
import { useToast } from '../components/ToastProvider'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SkeletonRows } from '../components/Skeleton'
import { GarmentForm, type GarmentFormSubmit } from '../components/GarmentForm'
import { GarmentPhoto } from '../components/GarmentPhoto'
import { PurchaseResult, VerdictBadge } from '../components/PurchaseResult'
import { useRepository } from '../components/RepositoryContext'
import { useAiTagging } from '../components/useAiTagging'
import { finishCutoutAfterSave, useBackgroundRemover } from '../cutout'
import { CATEGORY_LABELS, type CandidateEntry, type Garment, type PurchaseEvaluation } from '../db'
import { evaluatePurchase, toStoredEvaluation } from '../purchase'
import { useSettings } from '../settings'

type Tab = 'evaluar' | 'lista'
interface Viewing {
  garment: Garment
  evaluation: PurchaseEvaluation
  fromWishlist: boolean
}

const nameOf = (g: Garment) => g.subcategory || CATEGORY_LABELS[g.category]

export default function ComprarPage() {
  const toast = useToast()
  const repo = useRepository()
  const remover = useBackgroundRemover()
  const navigate = useNavigate()
  const ai = useAi()
  const [settings] = useSettings()
  const { onPhotoChange, suggestion, aiSlot } = useAiTagging()

  const [tab, setTab] = useState<Tab>('evaluar')
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const [wardrobe, setWardrobe] = useState<Garment[]>([])
  const [candidates, setCandidates] = useState<CandidateEntry[] | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const refresh = useCallback(async () => {
    const [all, list] = await Promise.all([repo.list(), repo.purchases.listCandidates()])
    setWardrobe(all)
    setCandidates(list)
    return all
  }, [repo])

  useEffect(() => {
    let cancelled = false
    Promise.all([repo.list(), repo.purchases.listCandidates()]).then(
      ([all, list]) => {
        if (cancelled) return
        setWardrobe(all)
        setCandidates(list)
      },
      (e: unknown) => !cancelled && setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'No se pudo cargar la lista.' }),
    )
    return () => {
      cancelled = true
    }
  }, [repo])

  async function runEvaluation(garment: Garment): Promise<PurchaseEvaluation> {
    const all = await repo.list()
    const report = await evaluatePurchase(garment, all, {
      ai: ai.configured ? ai.getProvider() : undefined,
      thresholds: { buyMinOutfits: settings.buyMinOutfits, buyMinOccasions: settings.buyMinOccasions },
    })
    const evaluation = await repo.purchases.save(toStoredEvaluation(garment.id, report))
    await refresh()
    return evaluation
  }

  async function submitCandidate({ data, newPhoto, providedCutout }: GarmentFormSubmit) {
    const photo_path = newPhoto ? await repo.savePhoto(newPhoto) : null
    let garment: Garment
    try {
      garment = await repo.create({ ...data, photo_path, status: 'candidate' })
    } catch (e) {
      if (photo_path) await repo.deletePhoto(photo_path)
      throw e
    }
    setMessage(null)
    if (photo_path) await finishCutoutAfterSave(repo, remover, garment, { providedCutout, bbox: suggestion?.values.bbox })
    try {
      const evaluation = await runEvaluation(garment)
      setViewing({ garment, evaluation, fromWishlist: false })
    } catch (e) {
      // La prenda ya quedó en la lista de deseos; se puede reevaluar desde ahí.
      await refresh().catch(() => undefined)
      setFormKey((k) => k + 1)
      setTab('lista')
      setMessage({
        kind: 'error',
        text: `La prenda se guardó en tu lista de deseos, pero no se pudo evaluar${e instanceof Error ? `: ${e.message}` : '.'} Toca la prenda y elige «Reevaluar».`,
      })
    }
  }

  async function reevaluate() {
    if (!viewing) return
    setBusy(true)
    setMessage(null)
    try {
      const evaluation = await runEvaluation(viewing.garment)
      setViewing({ ...viewing, evaluation })
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'No se pudo reevaluar.' })
    } finally {
      setBusy(false)
    }
  }

  async function bought() {
    if (!viewing) return
    setBusy(true)
    try {
      await repo.setStatus(viewing.garment.id, 'active')
      toast('Prenda agregada a tu armario')
      navigate('/armario')
    } catch (e) {
      setBusy(false)
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'No se pudo actualizar la prenda.' })
    }
  }

  async function discard() {
    if (!viewing) return
    setDiscarding(false)
    setBusy(true)
    try {
      await repo.delete(viewing.garment.id)
      await refresh()
      setViewing(null)
      setFormKey((k) => k + 1)
      setMessage({ kind: 'ok', text: 'Prenda descartada.' })
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'No se pudo descartar la prenda.' })
    } finally {
      setBusy(false)
    }
  }

  function goToWishlist() {
    setViewing(null)
    setFormKey((k) => k + 1)
    setTab('lista')
    setMessage(null)
  }

  function openFromWishlist(entry: CandidateEntry) {
    setMessage(null)
    if (entry.evaluation) setViewing({ garment: entry.garment, evaluation: entry.evaluation, fromWishlist: true })
    else {
      setBusy(true)
      runEvaluation(entry.garment)
        .then((evaluation) => setViewing({ garment: entry.garment, evaluation, fromWishlist: true }))
        .catch((e: unknown) => setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'No se pudo evaluar.' }))
        .finally(() => setBusy(false))
    }
  }

  const wishlistCount = candidates?.length ?? 0

  return (
    <section>
      <h1 className="page-title">Comprar</h1>
      <div className="chips" role="tablist" aria-label="Secciones de Comprar">
        {(
          [
            ['evaluar', 'Evaluar una prenda'],
            ['lista', `Lista de deseos${candidates ? ` (${wishlistCount})` : ''}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`chip${tab === key ? ' chip-active' : ''}`}
            onClick={() => {
              setTab(key)
              setViewing(null)
              setMessage(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {message?.kind === 'ok' && <p className="ok-msg">{message.text}</p>}
        {message?.kind === 'error' && (
          <p role="alert" className="form-error">
            {message.text}
          </p>
        )}
      </div>

      {viewing ? (
        <PurchaseResult
          garment={viewing.garment}
          evaluation={viewing.evaluation}
          wardrobe={wardrobe}
          fromWishlist={viewing.fromWishlist}
          busy={busy}
          onBought={() => void bought()}
          onWishlist={goToWishlist}
          onDiscard={() => setDiscarding(true)}
          onReevaluate={() => void reevaluate()}
        />
      ) : tab === 'evaluar' ? (
        <>
          <p className="page-hint">
            Sube una foto o captura de la prenda que piensas comprar. Se evalúa contra tu armario y queda en tu lista de
            deseos.
          </p>
          <GarmentForm
            key={formKey}
            submitLabel="Guardar y evaluar"
            fixedStatus="candidate"
            onSubmit={submitCandidate}
            onPhotoChange={onPhotoChange}
            suggestion={suggestion}
            aiSlot={aiSlot}
          />
        </>
      ) : candidates === null ? (
        <SkeletonRows count={3} />
      ) : candidates.length === 0 ? (
        <p className="page-hint">Tu lista de deseos está vacía. Evalúa una prenda para guardarla aquí.</p>
      ) : (
        <ul className="usage-list" aria-label="Lista de deseos">
          {candidates.map((entry) => (
            <li key={entry.garment.id}>
              <button type="button" className="usage-row wish-row" disabled={busy} onClick={() => openFromWishlist(entry)} aria-label={`Ver evaluación de ${nameOf(entry.garment)}`}>
                <span className="usage-thumb">
                  <GarmentPhoto photoPath={entry.garment.photo_path} cutoutPath={entry.garment.cutout_path} alt={nameOf(entry.garment)} />
                </span>
                <span className="usage-name">{nameOf(entry.garment)}</span>
                {entry.evaluation ? (
                  <span className="wish-meta">
                    <VerdictBadge verdict={entry.evaluation.verdict} small />
                    <span className="muted usage-meta">{entry.evaluation.outfitCount} outfits</span>
                  </span>
                ) : (
                  <span className="muted usage-meta">Sin evaluar</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {discarding && viewing && (
        <ConfirmDialog
          title="¿Descartar esta prenda?"
          message="Se eliminará de tu lista de deseos junto con su foto y sus evaluaciones."
          confirmLabel="Descartar"
          onConfirm={() => void discard()}
          onCancel={() => setDiscarding(false)}
        />
      )}
    </section>
  )
}
