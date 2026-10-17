import { useState, useEffect } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { applyDefaultBrand } from '../utils/theme'
import { landingPath, esSoloRepartidor } from '../config/sections'
import PasswordInput from '../components/PasswordInput'
import AuthLayout, { AuthAviso, authInput, authBoton } from '../components/AuthLayout'

/**
 * Pantalla de login. Es la puerta de entrada a la app: no hay sesión ni tienda todavía,
 * por lo que siempre se muestra con el color de marca azul fijo "Nexora" (nunca el color
 * personalizado de ninguna tienda, ya que aún no se sabe a qué tienda pertenece el usuario).
 *
 * Sirve a todos los roles por igual (`SUPER_ADMIN`, `ADMIN`, `MESERO`): tras
 * autenticarse, `AuthContext` decide a dónde redirigir y qué color de marca aplicar según
 * el usuario y su tienda.
 */
export default function Login() {
  const { login, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // El login siempre es azul Nexora fijo, sin importar el color que haya quedado
  // aplicado de una sesión anterior con una tienda con color propio.
  // (Si ya hay sesión no se toca: se va a redirigir a su pantalla, con el color de su tienda.)
  useEffect(() => {
    if (!user) applyDefaultBrand()
  }, [])

  /**
   * Envía las credenciales al backend vía `AuthContext.login`. Si la autenticación
   * es exitosa, `AuthContext` guarda el usuario/token y aplica el color de marca que
   * corresponda (Nexora o el de la tienda del usuario); aquí solo se navega a la raíz.
   */
  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const u = await login(form.email, form.password)
      // El repartidor no usa el punto de venta: se va directo a la página web de su tienda
      // (su sesión ya sirve ahí); si la tienda no la tiene activa, PrivateRoute le avisa.
      // replace: el login NO queda en el historial, así que "atrás" no regresa a él.
      if (esSoloRepartidor(u) && u.webSlug && !u.mustChangePassword) { window.location.replace(`/sitio/${u.webSlug}`); return }
      navigate(landingPath(u), { replace: true })
    } catch (err) {
      setError(err.response?.data?.message || 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  // Con sesión ya iniciada no tiene caso mostrar el login (ej. llegaste con "atrás", un
  // marcador o escribiendo /login): se manda directo a su pantalla de inicio.
  if (!authLoading && user) {
    if (esSoloRepartidor(user) && user.webSlug) { window.location.replace(`/sitio/${user.webSlug}`); return null }
    return <Navigate to={user.mustChangePassword ? '/change-password' : landingPath(user)} replace />
  }

  return (
    <AuthLayout titulo="Inicia sesión" subtitulo="Entra con tu correo y contraseña.">
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <AuthAviso>{error}</AuthAviso>}

        <div className="space-y-1.5">
          <label htmlFor="login-email" className="block text-sm font-bold text-gray-900">Correo electrónico</label>
          <input id="login-email" type="email" autoComplete="username" className={authInput} placeholder="tu@correo.com"
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="login-pass" className="block text-sm font-bold text-gray-900">Contraseña</label>
            <Link to="/forgot-password" className="text-[13px] font-bold text-purple-700 hover:underline">¿La olvidaste?</Link>
          </div>
          <PasswordInput id="login-pass" autoComplete="current-password" className={authInput} placeholder="Tu contraseña"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </div>

        <button type="submit" className={authBoton} disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </AuthLayout>
  )
}
