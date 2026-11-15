/** Días entre dos fechas YYYY-MM-DD (o ISO); positivo si `to` es posterior a `from`. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}
