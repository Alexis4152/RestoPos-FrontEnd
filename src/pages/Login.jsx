import { useState, useEffect } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { applyDefaultBrand } from '../utils/theme'
import { landingPath, esSoloRepartidor } from '../config/sections'
import PasswordInput from '../components/PasswordInput'
import logo from '../assets/logo.png'

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
    <div className="min-h-screen bg-gradient-to-br from-[#03050c] via-[#050b18] to-[#0d1b3d] flex items-center justify-center p-4 relative overflow-hidden">
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        className="pointer-events-none select-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] max-w-none opacity-[0.05]"
      />
      <div className="bg-white rounded-2xl shadow-2xl shadow-[#155dea]/30 w-full max-w-md p-6 sm:p-8 relative z-10">
        <div className="text-center mb-8">
          <img src={logo} alt="Nexora Systems" className="w-24 h-24 rounded-full mx-auto mb-3 shadow-[0_0_24px_rgba(43,132,245,0.5)]" />
          <h1 className="text-2xl font-bold text-gray-900">RestoPOS</h1>
          <p className="text-gray-500 text-sm mt-1">Punto de Venta para Restaurantes</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
            <input
              type="email"
              className="input"
              placeholder="admin@restopos.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
            <PasswordInput
              className="input"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
            {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
          </button>
          <Link to="/forgot-password" className="block w-full text-center text-sm text-gray-400 hover:text-gray-600">
            ¿Olvidaste tu contraseña?
          </Link>
        </form>
      </div>
    </div>
  )
}
