export function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <h1 className="page-title">{title}</h1>
      <p className="page-hint">Próximamente.</p>
    </section>
  )
}
