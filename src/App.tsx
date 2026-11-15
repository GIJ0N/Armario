import { Route, Routes } from 'react-router-dom'
import { ShellBanners } from './components/ShellBanners'
import type { PlatformEnv } from './lib/platform'
import { TabBar } from './components/TabBar'
import { ToastProvider } from './components/ToastProvider'
import { useApplyTheme } from './settings/theme'
import AgregarPage from './pages/Agregar'
import AjustesPage from './pages/Ajustes'
import ArmarioPage from './pages/Armario'
import ComprarPage from './pages/Comprar'
import GarmentDetailPage from './pages/GarmentDetail'
import HoyPage from './pages/Hoy'
import UsoPage from './pages/Uso'
import YoPage from './pages/Yo'

export default function App({ platformEnv }: { platformEnv?: PlatformEnv } = {}) {
  useApplyTheme()
  return (
    <ToastProvider>
    <div className="app">
      <main className="app-content">
        <ShellBanners platformEnv={platformEnv} />
        <Routes>
          <Route index element={<HoyPage />} />
          <Route path="armario" element={<ArmarioPage />} />
          <Route path="armario/:id" element={<GarmentDetailPage />} />
          <Route path="agregar" element={<AgregarPage />} />
          <Route path="comprar" element={<ComprarPage />} />
          <Route path="yo" element={<YoPage />} />
          <Route path="uso" element={<UsoPage />} />
          <Route path="ajustes" element={<AjustesPage />} />
          <Route path="*" element={<HoyPage />} />
        </Routes>
      </main>
      <TabBar />
    </div>
    </ToastProvider>
  )
}
