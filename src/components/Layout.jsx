import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { WEB_ONLY_SECTIONS } from '../config/sections'
import defaultLogo from '../assets/logo.png'
import NotificationCenter from './NotificationCenter'
import Icon from './Icon'
import { resolveMediaUrl } from '../utils/media'
import { useEscapeKey } from '../hooks/useEscapeKey'

/**
 * Clase de cada link del menú: claro, con el activo resaltado en el color de marca de la
 * tienda (purple-* = variables de marca, ver tailwind.config.js). En modo contraído solo
 * se ve el ícono, centrado.
 */
const navLinkClass = (collapsed) => ({ isActive }) =>
  `flex items-center gap-3 min-h-[40px] px-3 rounded-xl text-sm font-semibold transition-colors ${
    collapsed ? 'justify-center' : ''
  } ${
    isActive ? 'bg-purple-50 text-purple-800' : 'text-gray-700 hover:bg-[#EFEDE7] hover:text-gray-900'
  }`

// Rutas agrupadas bajo el submenú colapsable "Configuración" del sidebar.
const CONFIG_ROUTES = ['/users', '/roles', '/categories', '/appearance', '/store-info', '/web-config', '/cash-cut-schedule']

/**
 * Grupos del menú principal: cada entrada aparece solo si el usuario tiene su sección
 * (`section`). Reservaciones va con Mesas y Opiniones con Reportes (mismos permisos).
 */
const GRUPOS = [
  { titulo: null, items: [{ section: 'DASHBOARD', to: '/', label: 'Inicio', icon: 'inicio' }] },
  {
    titulo: 'Servicio',
    items: [
      { section: 'TABLES', to: '/tables', label: 'Mesas', icon: 'mesas' },
      { section: 'TABLES', to: '/reservaciones', label: 'Reservaciones', icon: 'reservas' },
      { section: 'TAKEAWAY', to: '/takeaway', label: 'Para llevar', icon: 'llevar' },
      { section: 'KITCHEN', to: '/kitchen', label: 'Cocina', icon: 'cocina' },
      { section: 'ORDERS', to: '/orders', label: 'Órdenes', icon: 'ordenes' },
    ],
  },
  {
    titulo: 'Caja',
    items: [
      { section: 'SALES', to: '/sales', label: 'Ventas', icon: 'ventas' },
      { section: 'CASH_CUTS', to: '/cash-cuts', label: 'Cortes de caja', icon: 'corte' },
    ],
  },
  {
    titulo: 'Gestión',
    items: [
      { section: 'MENU', to: '/menu', label: 'Menú', icon: 'menu' },
      { section: 'INVENTORY', to: '/inventory', label: 'Inventario', icon: 'inventario' },
      { section: 'REPORTS', to: '/reports', label: 'Reportes', icon: 'reportes' },
      { section: 'REPORTS', to: '/opiniones', label: 'Opiniones', icon: 'opiniones' },
    ],
  },
]

const ROL_LABEL = {
  SUPER_ADMIN: 'Super admin',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Administrador',
  MESERO: 'Mesero',
  CAJERO: 'Cajero',
  COCINERO: 'Cocina',
  REPARTIDOR: 'Repartidor',
}

const iniciales = (nombre = '') => nombre.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?'

/**
 * Shell de toda la app autenticada: menú lateral claro agrupado (Servicio / Caja / Gestión /
 * Configuración) con el logo y nombre de la tienda, y el contenido de la ruta (`children`).
 *
 * Multi-tienda: el SUPER_ADMIN y el SUPERVISOR (actores de plataforma) ven arriba la tienda
 * sobre la que están actuando y abajo "Cambiar tienda", que los regresa a /select-tienda. El
 * resto de usuarios solo ve su tienda. El menú solo muestra las secciones del rol.
 *
 * El estado contraído del menú y el de "Configuración" persisten en `localStorage`.
 */
export default function Layout({ children }) {
  const { user, logout, hasSection, isAdmin, isSuperAdmin, isPlatformActor, clearSelectedTienda } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('pos_sidebar_collapsed') === '1')
  const [configOpen, setConfigOpen] = useState(
    () => localStorage.getItem('pos_config_menu_open') !== '0' || CONFIG_ROUTES.includes(location.pathname)
  )
  // Drawer del menú en mobile/tablet (< lg), independiente de `collapsed` (solo escritorio).
  const [mobileOpen, setMobileOpen] = useState(false)
  useEscapeKey(() => setMobileOpen(false), !!mobileOpen)

  function handleLogout() {
    logout()
    navigate('/login')
  }

  /** Regresa a un actor de plataforma (SUPER_ADMIN/SUPERVISOR) a la pantalla de tiendas. */
  function handleChangeTienda() {
    clearSelectedTienda()
    navigate('/select-tienda')
  }

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem('pos_sidebar_collapsed', next ? '1' : '0')
      return next
    })
  }

  function toggleConfig() {
    setConfigOpen((c) => {
      const next = !c
      localStorage.setItem('pos_config_menu_open', next ? '1' : '0')
      return next
    })
  }

  const grupos = GRUPOS
    .map((g) => ({ ...g, items: g.items.filter((it) => hasSection(it.section) && !WEB_ONLY_SECTIONS.includes(it.section)) }))
    .filter((g) => g.items.length > 0)

  const configItems = [
    hasSection('USERS') && { to: '/users', label: 'Usuarios' },
    hasSection('ROLES') && { to: '/roles', label: 'Roles y permisos' },
    isAdmin && { to: '/categories', label: 'Categorías' },
    isAdmin && { to: '/appearance', label: 'Apariencia' },
    isAdmin && { to: '/store-info', label: 'Datos de la tienda' },
    isAdmin && { to: '/web-config', label: 'Página web' },
    isSuperAdmin && { to: '/cash-cut-schedule', label: 'Cierre automático de cortes' },
  ].filter(Boolean)
  const configActive = CONFIG_ROUTES.includes(location.pathname)
  const sidebarLogo = resolveMediaUrl(user?.tienda?.logoPath) || defaultLogo
  const tiendaNombre = user?.tienda?.name || (isPlatformActor ? 'Sin tienda elegida' : 'RestoPOS')

  function renderSidebarBody(isCollapsed, onNavigate) {
    return (
      <>
        {/* Tienda */}
        <div className={`px-4 pt-5 pb-4 ${isCollapsed ? 'flex justify-center' : ''}`}>
          <div className="flex items-center gap-3 min-w-0">
            <img src={sidebarLogo} alt="" className="w-10 h-10 rounded-xl object-cover border border-[#E4E1DA] bg-white shrink-0" />
            {!isCollapsed && (
              <div className="min-w-0 leading-tight">
                <p className="font-extrabold text-[15px] text-gray-900">RestoPOS</p>
                <p className="text-xs text-gray-600 truncate" title={tiendaNombre}>{tiendaNombre}</p>
              </div>
            )}
          </div>
        </div>

        <nav aria-label="Menú principal" className="sidebar-scroll flex-1 px-3 pb-3 overflow-y-auto overflow-x-hidden space-y-4">
          {grupos.map((g) => (
            <div key={g.titulo ?? 'inicio'}>
              {g.titulo && !isCollapsed && (
                <p className="px-3 mb-1 text-[11px] font-bold uppercase tracking-wider text-gray-600">{g.titulo}</p>
              )}
              <div className="space-y-0.5">
                {g.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'} title={isCollapsed ? n.label : undefined}
                    className={navLinkClass(isCollapsed)} onClick={onNavigate}>
                    <Icon name={n.icon} className="w-[18px] h-[18px] shrink-0" />
                    {!isCollapsed && <span className="whitespace-nowrap">{n.label}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}

          {configItems.length > 0 && (
            isCollapsed ? (
              <NavLink to={configItems[0].to} title="Configuración" className={navLinkClass(true)} onClick={onNavigate}>
                <Icon name="config" className="w-[18px] h-[18px]" />
              </NavLink>
            ) : (
              <div>
                <button type="button" onClick={toggleConfig} aria-expanded={configOpen}
                  className={`w-full flex items-center gap-3 min-h-[40px] px-3 rounded-xl text-sm font-semibold transition-colors ${
                    configActive ? 'text-purple-800' : 'text-gray-700 hover:bg-[#EFEDE7]'}`}>
                  <Icon name="config" className="w-[18px] h-[18px] shrink-0" />
                  <span className="flex-1 text-left">Configuración</span>
                  <span className={`text-xs transition-transform ${configOpen ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
                </button>
                {configOpen && (
                  <div className="mt-0.5 ml-5 pl-3 border-l border-[#E4E1DA] space-y-0.5">
                    {configItems.map((n) => (
                      <NavLink key={n.to} to={n.to} onClick={onNavigate}
                        className={({ isActive }) => `block px-3 py-2 rounded-lg text-sm font-semibold ${
                          isActive ? 'bg-purple-50 text-purple-800' : 'text-gray-600 hover:bg-[#EFEDE7] hover:text-gray-900'}`}>
                        {n.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
        </nav>

        {/* Usuario, cambio de tienda (plataforma) y salida */}
        <div className="p-3 border-t border-[#E4E1DA] space-y-1">
          {!isCollapsed && (
            <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-[#F1EFEA]">
              <span className="w-9 h-9 rounded-full bg-purple-100 text-purple-800 flex items-center justify-center text-xs font-extrabold shrink-0">
                {iniciales(user?.name)}
              </span>
              <div className="min-w-0 leading-tight">
                <p className="text-sm font-bold truncate">{user?.name}</p>
                <p className="text-xs text-gray-600">{ROL_LABEL[user?.role] ?? user?.role}</p>
              </div>
            </div>
          )}
          {isPlatformActor && (
            <button type="button" onClick={handleChangeTienda} title={isCollapsed ? 'Cambiar tienda' : undefined}
              className={`w-full flex items-center gap-3 min-h-[40px] px-3 rounded-xl text-sm font-semibold text-gray-700 hover:bg-[#EFEDE7] ${isCollapsed ? 'justify-center' : ''}`}>
              <Icon name="cambiar" className="w-[18px] h-[18px] shrink-0" /> {!isCollapsed && 'Cambiar tienda'}
            </button>
          )}
          <button type="button" onClick={handleLogout} title={isCollapsed ? 'Cerrar sesión' : undefined}
            className={`w-full flex items-center gap-3 min-h-[40px] px-3 rounded-xl text-sm font-semibold text-red-700 hover:bg-red-50 ${isCollapsed ? 'justify-center' : ''}`}>
            <Icon name="salir" className="w-[18px] h-[18px] shrink-0" /> {!isCollapsed && 'Cerrar sesión'}
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="flex h-screen bg-[#F4F3EF]">
      {/* Menú fijo — desde `lg:` */}
      <aside className={`hidden lg:flex ${collapsed ? 'w-20' : 'w-60'} bg-[#FBFAF7] border-r border-[#E4E1DA] flex-col relative shrink-0`}>
        <button type="button" onClick={toggleCollapsed} aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
          className="absolute -right-3 top-7 w-6 h-6 rounded-full bg-white border border-[#D9D5CC] shadow-sm flex items-center justify-center text-xs text-gray-600 hover:text-purple-700 z-10">
          {collapsed ? '›' : '‹'}
        </button>
        {renderSidebarBody(collapsed, undefined)}
      </aside>

      {/* Drawer — antes de `lg:` */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-72 max-w-[85vw] bg-[#FBFAF7] flex flex-col h-full">
            {renderSidebarBody(false, () => setMobileOpen(false))}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Barra superior: en móvil, menú y tienda; en todas, la campana de notificaciones. */}
        <header className="flex items-center gap-3 bg-[#FBFAF7] lg:bg-[#F4F3EF] border-b border-[#E4E1DA] lg:border-b-0 px-4 lg:px-8 py-2 lg:pt-4 lg:pb-0 shrink-0">
          <button type="button" onClick={() => setMobileOpen(true)} className="lg:hidden w-11 h-11 -ml-2 flex items-center justify-center text-gray-700" aria-label="Abrir menú">
            <Icon name="menuHamb" className="w-6 h-6" />
          </button>
          <img src={sidebarLogo} alt="" className="lg:hidden w-8 h-8 rounded-lg object-cover" />
          <span className="lg:hidden font-bold text-gray-900 truncate flex-1">{tiendaNombre}</span>
          <span className="hidden lg:block flex-1 text-[13px] text-gray-600 capitalize">
            {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
            {isPlatformActor && user?.tienda?.name ? ` · ${user.tienda.name}` : ''}
          </span>
          <NotificationCenter />
        </header>
        <main className="flex-1 overflow-y-auto flex flex-col">
          <div className="p-4 sm:p-6 lg:px-8 lg:py-7 flex-1">{children}</div>
          <footer className="px-4 sm:px-6 lg:px-8 py-4 text-center text-xs text-gray-500 border-t border-[#E4E1DA]">
            © {new Date().getFullYear()} Nexora Systems. Todos los derechos reservados.
          </footer>
        </main>
      </div>

    </div>
  )
}
