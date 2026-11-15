import { Route, Routes } from 'react-router-dom'
import { TabBar } from './components/TabBar'
import AgregarPage from './pages/Agregar'
import AjustesPage from './pages/Ajustes'
import ArmarioPage from './pages/Armario'
import ComprarPage from './pages/Comprar'
import HoyPage from './pages/Hoy'
import UsoPage from './pages/Uso'

export default function App() {
  return (
    <div className="app">
      <main className="app-content">
        <Routes>
          <Route index element={<HoyPage />} />
          <Route path="armario" element={<ArmarioPage />} />
          <Route path="agregar" element={<AgregarPage />} />
          <Route path="comprar" element={<ComprarPage />} />
          <Route path="uso" element={<UsoPage />} />
          <Route path="ajustes" element={<AjustesPage />} />
          <Route path="*" element={<HoyPage />} />
        </Routes>
      </main>
      <TabBar />
    </div>
  )
}
