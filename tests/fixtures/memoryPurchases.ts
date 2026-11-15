import type { PurchaseEvaluation, PurchaseEvaluationRepository, Garment } from '../../src/db'

/** Evaluaciones de compra en memoria para pruebas de UI. */
export function memoryPurchases(garments: () => Garment[]): { purchases: PurchaseEvaluationRepository; rows: PurchaseEvaluation[] } {
  const rows: PurchaseEvaluation[] = []
  let tick = 0
  const purchases: PurchaseEvaluationRepository = {
    save: async (e) => {
      const saved = { ...e, createdAt: e.createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString() }
      rows.push(saved)
      return saved
    },
    latestFor: async (id) => [...rows].reverse().find((r) => r.garmentId === id) ?? null,
    listCandidates: async () =>
      garments()
        .filter((g) => g.status === 'candidate')
        .reverse()
        .map((garment) => ({ garment, evaluation: [...rows].reverse().find((r) => r.garmentId === garment.id) ?? null })),
  }
  return { purchases, rows }
}
