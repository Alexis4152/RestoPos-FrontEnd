/**
 * Catálogo de módulos/secciones de la aplicación disponibles para RBAC.
 *
 * Debe reflejar uno a uno el enum `AppSection` del backend: el campo `code` de cada
 * entrada es el mismo string que el backend usa para identificar la sección dentro
 * de un rol (`role.sections`) y dentro de `user.sections` (las secciones habilitadas
 * para el usuario autenticado, derivadas de su rol).
 *
 * Cada entrada define, además del `code`, cómo se representa esa sección en la UI:
 * - `label`: texto mostrado en la navegación.
 * - `icon`: emoji usado como ícono en la navegación.
 * - `to`: ruta de React Router a la que enlaza.
 *
 * Consumido principalmente por:
 * - `Layout.jsx`, para construir el menú de navegación filtrando estas entradas
 *   contra `user.sections` (vía `hasSection` de `AuthContext`).
 * - `PrivateRoute.jsx`, para bloquear el acceso directo por URL a una ruta cuya
 *   sección no esté habilitada para el usuario.
 *
 * Si el backend agrega/renombra un valor de `AppSection`, este arreglo debe
 * actualizarse en conjunto para mantener el RBAC del frontend sincronizado.
 */
export const SECTIONS = [
  { code: 'DASHBOARD', label: 'Dashboard', icon: '📊', to: '/' },
  { code: 'TABLES', label: 'Mesas', icon: '🍽️', to: '/tables' },
  { code: 'TAKEAWAY', label: 'Para llevar', icon: '🥡', to: '/takeaway' },
  { code: 'ORDERS', label: 'Órdenes', icon: '📋', to: '/orders' },
  { code: 'KITCHEN', label: 'Cocina', icon: '🍳', to: '/kitchen' },
  { code: 'DELIVERY', label: 'Entregas', icon: '🛵', to: '/entregas' },
  { code: 'MENU', label: 'Menú', icon: '📖', to: '/menu' },
  { code: 'INVENTORY', label: 'Inventario', icon: '📦', to: '/inventory' },
  { code: 'CASH_CUTS', label: 'Cortes de Caja', icon: '💰', to: '/cash-cuts' },
  { code: 'SALES', label: 'Ventas', icon: '💵', to: '/sales' },
  { code: 'REPORTS', label: 'Reportes', icon: '📈', to: '/reports' },
  { code: 'USERS', label: 'Usuarios', icon: '👥', to: '/users' },
  { code: 'ROLES', label: 'Roles y Permisos', icon: '🔑', to: '/roles' },
]

/**
 * Pantalla de inicio de un usuario según sus secciones: el Dashboard si lo tiene; si no, la
 * primera sección habilitada (ej. un REPARTIDOR cae directo en Entregas, un cocinero en
 * Cocina). Evita mandar a "/" a quien no tiene DASHBOARD, que rebotaría en un ciclo.
 * @param {{ sections?: string[] }} user
 */
export function landingPath(user) {
  const sections = user?.sections ?? []
  if (sections.includes('DASHBOARD')) return '/'
  return SECTIONS.find((s) => sections.includes(s.code) && !WEB_ONLY_SECTIONS.includes(s.code))?.to ?? '/'
}

/**
 * Secciones que se trabajan SOLO desde la página web de la tienda (`/sitio/{slug}`), nunca
 * desde el punto de venta: siguen en SECTIONS para poder asignarlas en Roles, pero el menú y
 * las rutas del punto de venta las omiten.
 */
export const WEB_ONLY_SECTIONS = ['DELIVERY']

/**
 * ¿Es un usuario que solo reparte? (tiene Entregas y, aparte, como mucho su corte de caja).
 * Ese usuario no entra al punto de venta: trabaja desde la página web de la tienda.
 */
export function esSoloRepartidor(user) {
  const sections = user?.sections ?? []
  return sections.includes('DELIVERY') && sections.every((s) => s === 'DELIVERY' || s === 'CASH_CUTS')
}
