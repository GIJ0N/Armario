import { CATEGORY_LABELS, OCCASION_LABELS, OCCASIONS, type Garment, type PurchaseEvaluation } from '../db'
import { VERDICT_LABELS } from '../purchase'
import { GarmentPhoto } from './GarmentPhoto'

const nameOf = (g: Garment) => g.subcategory || CATEGORY_LABELS[g.category]
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function VerdictBadge({ verdict, small }: { verdict: PurchaseEvaluation['verdict']; small?: boolean }) {
  return (
    <span className={`verdict verdict-${verdict}${small ? ' verdict-small' : ''}`} data-testid="verdict-badge">
      {VERDICT_LABELS[verdict]}
    </span>
  )
}

function Thumb({ g, label }: { g: Garment; label?: string }) {
  return (
    <li className="outfit-item" title={nameOf(g)}>
      <div className="outfit-thumb">
        <GarmentPhoto photoPath={g.photo_path} cutoutPath={g.cutout_path} alt={nameOf(g)} />
      </div>
      <span>{label ?? nameOf(g)}</span>
    </li>
  )
}

interface Props {
  garment: Garment
  evaluation: PurchaseEvaluation
  /** Todas las prendas (para miniaturas de duplicados y ejemplos). */
  wardrobe: Garment[]
  fromWishlist: boolean
  busy: boolean
  onBought: () => void
  onWishlist: () => void
  onDiscard: () => void
  onReevaluate: () => void
}

/** Resultado de la evaluación de una prenda candidata (veredicto, outfits, huecos y complementos). */
export function PurchaseResult({ garment, evaluation, wardrobe, fromWishlist, busy, onBought, onWishlist, onDiscard, onReevaluate }: Props) {
  const byId = new Map(wardrobe.map((g) => [g.id, g]))
  const d = evaluation.details
  const duplicates = d.duplicateIds.map((id) => byId.get(id)).filter((g): g is Garment => !!g)

  // Un ejemplo por ocasión (la de más outfits primero), hasta 3.
  const perOccasion = OCCASIONS.filter((o) => (d.perOccasion[o] ?? 0) > 0).sort((a, b) => (d.perOccasion[b] ?? 0) - (d.perOccasion[a] ?? 0))
  const examples = perOccasion
    .map((o) => d.examples.find((e) => e.occasion === o))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .slice(0, 3)

  return (
    <div className="purchase-result" data-testid="purchase-result">
      <div className="purchase-head">
        <div className="usage-thumb purchase-thumb">
          <GarmentPhoto photoPath={garment.photo_path} cutoutPath={garment.cutout_path} alt={nameOf(garment)} />
        </div>
        <div>
          <h2 className="section-title">{nameOf(garment)}</h2>
          <p className="muted purchase-sub">
            {[garment.colors[0], `formalidad ${garment.formality}`].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      <div className="verdict-box">
        <VerdictBadge verdict={evaluation.verdict} />
        <p className="verdict-summary" data-testid="outfit-summary">
          {evaluation.outfitCount === 0
            ? 'No formaría ningún outfit con tu armario actual.'
            : `Formaría ${plural(evaluation.outfitCount, 'outfit', 'outfits')} en ${plural(d.occasionCount, 'ocasión', 'ocasiones')}.`}
        </p>
        {perOccasion.length > 0 && (
          <ul className="chips verdict-chips" aria-label="Outfits por ocasión">
            {perOccasion.map((o) => (
              <li key={o} className="chip chip-static" data-testid="occasion-chip">
                {OCCASION_LABELS[o]} · {d.perOccasion[o]}
              </li>
            ))}
          </ul>
        )}
      </div>

      {duplicates.length > 0 && (
        <div className="duplicate-warning" role="alert" data-testid="duplicate-warning">
          <strong>Ya tienes {plural(duplicates.length, 'prenda parecida', 'prendas parecidas')}</strong>
          <span> (misma subcategoría, color y formalidad).</span>
          <ul className="history-thumbs">
            {duplicates.map((g) => (
              <li key={g.id} title={nameOf(g)}>
                <div className="usage-thumb">
                  <GarmentPhoto photoPath={g.photo_path} cutoutPath={g.cutout_path} alt={nameOf(g)} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {examples.length > 0 && (
        <>
          <h3 className="section-title">Ejemplos de outfits</h3>
          <ul className="example-list" aria-label="Ejemplos de outfits">
            {examples.map((e) => (
              <li key={e.occasion} className="outfit-card" data-testid="example-outfit">
                <div className="outfit-head">
                  <span className="badge badge-source">{OCCASION_LABELS[e.occasion]}</span>
                </div>
                <ul className="outfit-items">
                  {e.garmentIds
                    .map((id) => byId.get(id))
                    .filter((g): g is Garment => !!g)
                    .map((g) => (
                      <Thumb key={g.id} g={g} label={g.id === garment.id ? `${nameOf(g)} (nueva)` : undefined} />
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="section-title">Qué le falta</h3>
      {d.explanation && <p className="purchase-explanation" data-testid="explanation">{d.explanation}</p>}
      {evaluation.gaps.length > 0 && (
        <ul className="gap-list" aria-label="Huecos detectados">
          {evaluation.gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      )}
      {d.note && <p className="page-hint">{d.note}</p>}

      {evaluation.complements.length > 0 && (
        <>
          <h3 className="section-title">Complementos que ayudarían</h3>
          <ul className="complement-list" aria-label="Complementos sugeridos">
            {evaluation.complements.map((c) => (
              <li key={c.label} className="complement-card" data-testid="complement-card">
                <strong>{c.label}</strong>
                {c.reason && <span className="muted complement-reason">{c.reason}</span>}
                <span className="complement-unlocks" data-testid="complement-unlocks">
                  desbloquea {plural(c.unlocks, 'outfit más', 'outfits más')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="purchase-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onBought}>
          Lo compré
        </button>
        {fromWishlist ? (
          <button type="button" className="btn" disabled={busy} onClick={onWishlist}>
            Volver a la lista
          </button>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={onWishlist}>
            Guardar en lista de deseos
          </button>
        )}
        {fromWishlist && (
          <button type="button" className="btn" disabled={busy} onClick={onReevaluate}>
            {busy ? 'Evaluando…' : 'Reevaluar'}
          </button>
        )}
        <button type="button" className="btn btn-danger" disabled={busy} onClick={onDiscard}>
          Descartar
        </button>
      </div>
    </div>
  )
}
