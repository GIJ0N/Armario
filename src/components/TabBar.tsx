import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/', label: 'Hoy', icon: '☀️', end: true },
  { to: '/armario', label: 'Armario', icon: '👔', end: false },
  { to: '/agregar', label: 'Agregar', icon: '➕', end: false },
  { to: '/comprar', label: 'Comprar', icon: '🛍️', end: false },
  { to: '/uso', label: 'Uso', icon: '📊', end: false },
  { to: '/ajustes', label: 'Ajustes', icon: '⚙️', end: false },
] as const

export function TabBar() {
  return (
    <nav className="tab-bar" aria-label="Navegación principal">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => (isActive ? 'tab-link active' : 'tab-link')}
        >
          <span className="tab-icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
