import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { landingPath, esSoloRepartidor } from '../config/sections'

/**
 * Guard de rutas: controla si `children` se renderiza o si el usuario es
 * redirigido, según el estado de sesión y (opcionalmente) sus permisos.
 *
 * Orden de chequeos:
 * 1. Si `loading` (la sesión aún se está restaurando desde `localStorage`), muestra un spinner de texto.
 * 2. Si no hay `user` en sesión, redirige a `/login`.
 * 3. Si `user.mustChangePassword` (un admin lo dio de alta, o le reseteó la contraseña, con
 *    una temporal generada por el sistema), redirige a `/change-password` (salvo que la
 *    ruta actual ya sea esa) — hasta que la cambie, el resto de la app no tiene sentido.
 * 4. Si el usuario es un actor de plataforma (`SUPER_ADMIN`/`SUPERVISOR`) sin tienda elegida
 *    todavía, redirige a `/select-tienda` (salvo que la ruta actual ya sea esa) — hasta que
 *    elige una, el resto de la app no tiene sentido para él.
 * 5. Si se pasa `platformOnly` y el usuario no es un actor de plataforma, redirige a `/`.
 *    Se usa para la pantalla de Tiendas (`/select-tienda`), reservada a `SUPER_ADMIN`/`SUPERVISOR`.
 * 6. Si se pasa `section` (código de `AppSection`, o un arreglo de códigos — basta con
 *    tener habilitada UNA de ellas) y el usuario no la tiene habilitada (`hasSection`),
 *    redirige a `/`.
 * 7. Si se pasa `adminOnly` y el usuario no es `ADMIN` (ni un actor de plataforma ya
 *    actuando sobre una tienda, ver `isAdmin` en `AuthContext`), redirige a `/`. Se usa
 *    para pantallas de configuración de tienda (Apariencia, Datos de la tienda) que no
 *    son una `AppSection` del catálogo RBAC sino un nivel de acceso aparte.
 * 8. Si se pasa `superAdminOnly` y el usuario no es `SUPER_ADMIN` (ni siquiera un
 *    SUPERVISOR), redirige a `/`. Se usa para configuración global del sistema (ej. el
 *    horario de cierre automático de cortes de caja) que aplica a TODAS las tiendas por
 *    igual — más estricto que `platformOnly`, que sí deja pasar a SUPERVISOR.
 *
 * @param {{ children: import('react').ReactNode, section?: string|string[], adminOnly?: boolean, platformOnly?: boolean, superAdminOnly?: boolean }} props
 */
export default function PrivateRoute({ children, section, adminOnly, platformOnly, superAdminOnly }) {
  const { user, loading, hasSection, isAdmin, isPlatformActor, isSuperAdmin } = useAuth()
  const location = useLocation()
  if (loading) return <div className="flex items-center justify-center h-screen">Cargando...</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  // El repartidor trabaja solo desde la página web de la tienda (ver PublicSite.jsx).
  if (esSoloRepartidor(user) && location.pathname !== '/change-password') {
    return <RepartidorEnWeb />
  }
  if (isPlatformActor && !user.tienda && location.pathname !== '/select-tienda') {
    return <Navigate to="/select-tienda" replace />
  }
  if (platformOnly && !isPlatformActor) return <Navigate to="/" replace />
  if (section) {
    const required = Array.isArray(section) ? section : [section]
    // Sin la sección pedida: a su pantalla de inicio (no siempre "/", que también podría
    // estarle prohibida — ej. un repartidor sin DASHBOARD — y rebotaría en ciclo).
    if (!required.some(hasSection)) {
      const home = landingPath(user)
      return home === location.pathname ? <p className="p-8 text-gray-400">Sin acceso a esta sección.</p> : <Navigate to={home} replace />
    }
  }
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  if (superAdminOnly && !isSuperAdmin) return <Navigate to="/" replace />
  return children
}

/** Aviso para un repartidor que abre el punto de venta: su lugar de trabajo es la página web. */
function RepartidorEnWeb() {
  const { user, logout } = useAuth()
  const link = user?.webSlug ? `/sitio/${user.webSlug}` : null
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm text-center">
        <p className="text-5xl">🛵</p>
        <h1 className="text-xl font-bold text-gray-900 mt-3">Los repartidores trabajan desde la página web</h1>
        <p className="text-sm text-gray-500 mt-2">
          Entra a la página web del restaurante con este mismo correo y contraseña para ver tus entregas.
        </p>
        {link ? (
          <a href={link} className="btn-primary inline-block mt-5 w-full">Ir a la página web</a>
        ) : (
          <p className="text-sm text-orange-700 bg-orange-50 rounded-lg px-3 py-2 mt-4">Pide al administrador el link de la página web del restaurante.</p>
        )}
        <button className="mt-3 text-sm text-gray-500 hover:text-gray-700" onClick={() => logout().then(() => { window.location.href = '/login' })}>
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
