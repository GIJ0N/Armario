import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { RepositoryProvider } from './components/RepositoryContext'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <RepositoryProvider>
        <App />
      </RepositoryProvider>
    </HashRouter>
  </StrictMode>,
)
