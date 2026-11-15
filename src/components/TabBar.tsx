import { CalendarCheck2, ShoppingBag, Shirt, Plus, UserRound } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'

const ME_PATHS = ['/yo', '/uso', '/ajustes']

export function TabBar() {
  const { pathname } = useLocation()
  const meActive = ME_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'tab-link active' : 'tab-link')
  return (
    <nav className="tab-bar" aria-label="Navegación principal">
      <NavLink to="/" end className={cls}>
        <CalendarCheck2 className="icon" size={24} strokeWidth={1.9} aria-hidden="true" />
        <span>Hoy</span>
      </NavLink>
      <NavLink to="/armario" className={cls}>
        <Shirt className="icon" size={24} strokeWidth={1.9} aria-hidden="true" />
        <span>Armario</span>
      </NavLink>
      <NavLink to="/agregar" aria-label="Agregar" className={({ isActive }) => `tab-link tab-add${isActive ? ' active' : ''}`}>
        <span className="tab-add-disc">
          <Plus size={28} strokeWidth={2.4} aria-hidden="true" />
        </span>
      </NavLink>
      <NavLink to="/comprar" className={cls}>
        <ShoppingBag className="icon" size={24} strokeWidth={1.9} aria-hidden="true" />
        <span>Comprar</span>
      </NavLink>
      <NavLink to="/yo" className={() => (meActive ? 'tab-link active' : 'tab-link')} aria-current={meActive ? 'page' : undefined}>
        <UserRound className="icon" size={24} strokeWidth={1.9} aria-hidden="true" />
        <span>Yo</span>
      </NavLink>
    </nav>
  )
}
