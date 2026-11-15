import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getRepository, type Repository } from '../db'

const RepositoryContext = createContext<Repository | null>(null)

/** Abre la base una vez y la comparte; en pruebas se puede pasar un repositorio ya creado. */
export function RepositoryProvider({
  repository,
  children,
}: {
  repository?: Repository
  children: ReactNode
}) {
  const [repo, setRepo] = useState<Repository | null>(repository ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (repository) return
    getRepository().then(setRepo, (e: unknown) =>
      setError(e instanceof Error ? e.message : 'No se pudo abrir la base de datos'),
    )
  }, [repository])

  if (error) return <p role="alert" className="form-error">No se pudo abrir tu armario: {error}</p>
  if (!repo) return <p className="page-hint">Abriendo tu armario…</p>
  return <RepositoryContext.Provider value={repo}>{children}</RepositoryContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRepository(): Repository {
  const repo = useContext(RepositoryContext)
  if (!repo) throw new Error('useRepository fuera de RepositoryProvider')
  return repo
}
