import { createContext, useContext, useState, useEffect } from 'react'
import { login as apiLogin, logout as apiLogout, me as apiMe } from '../api/auth'
import { cerrarCanalPersonal } from '../utils/liveEvents'
import { applyDefaultBrand, applyTiendaBrand } from '../utils/theme'

const AuthContext = createContext(null)

// SUPER_ADMIN no pertenece a ninguna tienda → siempre azul Nexora fijo.
// El resto sigue el color que su tienda haya elegido (o Nexora si no eligió ninguno).
/**
 * Decide y aplica el color de marca (branding/theming) que corresponde al usuario dado.
 *
 * Los usuarios `SUPER_ADMIN` (que no pertenecen a ninguna tienda) y cualquier usuario
 * sin `tienda.primaryColor` definido siempre ven el azul fijo "Nexora" por defecto.
 * El resto de usuarios ve el color elegido por el administrador de su tienda
 * (pantalla de Apariencia). Es una función interna, no se expone en el contexto.
 *
 * @param {object|null} userData - Usuario en sesión (o `null` si no hay ninguno).
 * @returns {void}
 */
function applyBrandFor(userData) {
  if (!userData || userData.role === 'SUPER_ADMIN' || !userData.tienda?.primaryColor) {
    applyDefaultBrand()
  } else {
    applyTiendaBrand(userData.tienda.primaryColor)
  }
}

/**
 * Proveedor del contexto de autenticación/sesión de la aplicación.
 *
 * Es la fuente central de verdad sobre "quién es el usuario actual": mantiene el
 * `user` en memoria (sincronizado con `localStorage`, claves `pos_user`/`pos_token`)
 * y expone `login`/`logout`, los flags derivados `isAdmin`/`hasSection` (RBAC), y
 * `patchTienda` para reflejar en caliente cambios en los datos de la tienda.
 *
 * Al montar, si hay una sesión guardada en `localStorage` la restaura de inmediato
 * (para evitar parpadeos de UI) y en paralelo llama a `apiMe()` para refrescar
 * rol/secciones/tienda por si cambiaron desde el último login (p. ej. el admin
 * quitó un permiso o cambió el color de marca), fusionando el resultado sobre el
 * usuario ya cargado.
 *
 * @param {{ children: import('react').ReactNode }} props
 */
// El login responde `userId` y /auth/me `id`: el usuario en memoria lleva siempre los dos
// (hay pantallas que usan uno u otro, p. ej. Entregas `userId`, caja y Mis mesas `id`).
const conId = (u) => (u ? { ...u, id: u.id ?? u.userId, userId: u.userId ?? u.id } : u)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('pos_user')
    const token = localStorage.getItem('pos_token')
    if (stored && token) {
      try {
        const parsed = conId(JSON.parse(stored))
        setUser(parsed)
        applyBrandFor(parsed)
        // refresca secciones/rol/tienda por si el admin cambió permisos o color desde el último login
        apiMe()
          .then((r) => {
            const fresh = r.data.data
            const merged = {
              ...parsed,
              role: fresh.role?.name ?? parsed.role,
              sections: fresh.role?.sections ?? parsed.sections,
              tienda: fresh.tienda ?? parsed.tienda,
              mustChangePassword: !!fresh.mustChangePassword,
            }
            localStorage.setItem('pos_user', JSON.stringify(merged))
            setUser(merged)
            applyBrandFor(merged)
          })
          .catch(() => {})
      } catch { logout() }
    } else {
      applyDefaultBrand()
    }
    setLoading(false)
  }, [])

  /**
   * Inicia sesión contra el backend, persiste el token y los datos del usuario en
   * `localStorage`, actualiza el estado en memoria y aplica el color de marca que
   * corresponda al usuario recién autenticado.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<object>} Los datos del usuario autenticado (sin el token).
   */
  async function login(email, password) {
    const res = await apiLogin({ email, password })
    const { token, ...datos } = res.data.data
    const userData = conId(datos)
    localStorage.setItem('pos_token', token)
    localStorage.setItem('pos_user', JSON.stringify(userData))
    setUser(userData)
    applyBrandFor(userData)
    return userData
  }

  /**
   * Cierra la sesión actual: revoca el refresh token del lado servidor (para que la
   * cookie httpOnly no sirva ni siquiera si alguien la conservara), limpia `localStorage`
   * (token y usuario), resetea el estado `user` y vuelve a aplicar el color de marca por
   * defecto ("Nexora"). La limpieza local ocurre siempre, aunque la llamada al backend
   * falle (p. ej. sin red) — cerrar sesión localmente no debe depender de esa respuesta.
   */
  async function logout() {
    // Primero la sesión local, AL INSTANTE: si se esperaba al servidor, la pantalla de login
    // veía todavía al usuario y lo regresaba a su pantalla (parpadeo), y con el servidor lento
    // o sin respuesta la sesión nunca se cerraba. El aviso al servidor (revocar el refresh
    // token de la cookie) va después, con tiempo límite, y si falla no importa.
    localStorage.removeItem('pos_token')
    localStorage.removeItem('pos_user')
    setUser(null)
    applyDefaultBrand()
    cerrarCanalPersonal()
    try {
      await apiLogout()
    } catch {
      // sin red o backend caído: la sesión local ya quedó cerrada
    }
  }

  /** `true` si el usuario en sesión tiene el rol `SUPER_ADMIN` (plataforma, ve todas las tiendas). */
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  /** `true` si el usuario en sesión tiene el rol `SUPERVISOR` (plataforma, tiendas a su cargo). */
  const isSupervisor = user?.role === 'SUPERVISOR'
  /** `true` si el usuario es un actor de plataforma sin tienda propia (SUPER_ADMIN o SUPERVISOR). */
  const isPlatformActor = isSuperAdmin || isSupervisor
  /**
   * `true` si el usuario en sesión tiene el rol `ADMIN`, o es un actor de plataforma que ya
   * eligió una tienda sobre la que actuar (a partir de ahí se comporta como el ADMIN de esa
   * tienda para efectos de la UI).
   */
  const isAdmin = user?.role === 'ADMIN' || (isPlatformActor && !!user?.tienda)
  /** `true` si el usuario en sesión tiene el rol `MESERO`. */
  const isMesero = user?.role === 'MESERO'
  /** Indica si el usuario en sesión tiene habilitada la `AppSection` con el código dado (RBAC). */
  const hasSection = (code) => !!user?.sections?.includes(code)

  // Actualiza campos de user.tienda en memoria + localStorage al instante, sin
  // recargar ni volver a loguear. Usado por Apariencia (color) y Datos de la
  // tienda (nombre, logo) justo después de guardar en el backend.
  /**
   * Fusiona `partial` sobre `user.tienda` (en memoria y en `localStorage`) sin
   * necesidad de recargar la página ni volver a autenticar. Si `partial` incluye
   * `primaryColor`, también reaplica el color de marca para reflejar el cambio
   * de inmediato (p. ej. en el logo/sidebar).
   *
   * No hace nada si el usuario actual no tiene `tienda` asociada (caso `SUPER_ADMIN`).
   *
   * @param {object} partial - Campos parciales de `tienda` a fusionar (p. ej. `{ primaryColor }` o `{ name, logoPath }`).
   * @returns {void}
   */
  function patchTienda(partial) {
    if (!user?.tienda) return
    const merged = { ...user, tienda: { ...user.tienda, ...partial } }
    localStorage.setItem('pos_user', JSON.stringify(merged))
    setUser(merged)
    if ('primaryColor' in partial) applyBrandFor(merged)
  }

  /**
   * Usado por un actor de plataforma (SUPER_ADMIN/SUPERVISOR) tras elegir, en
   * `/select-tienda`, sobre cuál tienda quiere actuar. Guarda esa tienda en `user.tienda`
   * (memoria + `localStorage`) para que el resto de la app lo trate como el ADMIN de esa
   * tienda, y aplica de inmediato el color de marca correspondiente. El axios interceptor
   * (`src/api/axios.js`) manda esa misma tienda como header `X-Acting-Tienda-Id` en cada
   * petición siguiente.
   *
   * @param {object} tienda - Tienda elegida (debe incluir al menos `id`, `name`, `primaryColor`, `logoPath`).
   * @returns {void}
   */
  function selectTienda(tienda) {
    const merged = { ...user, tienda }
    localStorage.setItem('pos_user', JSON.stringify(merged))
    setUser(merged)
    applyBrandFor(merged)
  }

  /**
   * Regresa a un actor de plataforma al estado "sin tienda elegida" (botón "Cambiar
   * tienda"), lo que fuerza de nuevo la pantalla `/select-tienda` vía `PrivateRoute`.
   * No tiene efecto para un usuario normal (con tienda propia fija).
   *
   * @returns {void}
   */
  function clearSelectedTienda() {
    if (!isPlatformActor) return
    const merged = { ...user, tienda: null }
    localStorage.setItem('pos_user', JSON.stringify(merged))
    setUser(merged)
    applyBrandFor(merged)
  }

  /**
   * Apaga el flag `mustChangePassword` en memoria/`localStorage` tras un cambio de
   * contraseña exitoso (ver `pages/ChangePasswordRequired.jsx`), sin necesidad de volver a
   * iniciar sesión — a partir de aquí `PrivateRoute` deja de rebotar a esa pantalla.
   *
   * @returns {void}
   */
  function clearMustChangePassword() {
    const merged = { ...user, mustChangePassword: false }
    localStorage.setItem('pos_user', JSON.stringify(merged))
    setUser(merged)
  }

  return (
    <AuthContext.Provider value={{
      user, login, logout, isAdmin, isSuperAdmin, isSupervisor, isPlatformActor, isMesero,
      hasSection, loading, patchTienda, selectTienda, clearSelectedTienda, clearMustChangePassword,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

/**
 * Hook de acceso al contexto de autenticación (`user`, `login`, `logout`, `isAdmin`,
 * `isSuperAdmin`, `isSupervisor`, `isPlatformActor`, `hasSection`, `patchTienda`,
 * `selectTienda`, `clearSelectedTienda`, `clearMustChangePassword`, `loading`).
 */
export const useAuth = () => useContext(AuthContext)
