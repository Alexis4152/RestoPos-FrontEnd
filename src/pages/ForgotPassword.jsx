import { useState } from 'react'
import { Link } from 'react-router-dom'
import { forgotPassword } from '../api/auth'
import logo from '../assets/logo.png'

// Mismo patrón que el resto del formulario de auth: solo valida formato al enviar, no en
// vivo (no reemplaza al @Email real del backend, solo adelanta el error más común).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Pantalla pública "Olvidé mi contraseña" — sin sesión, mismo tratamiento visual que
 * Login.jsx/ChangePasswordRequired.jsx. El backend SIEMPRE responde el mismo mensaje
 * genérico exista o no ese correo (evita que este formulario sirva para enumerar cuentas),
 * así que aquí tampoco se distingue: éxito significa "la solicitud se mandó", no "el correo
 * existía".
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) { setError('Captura tu correo'); return }
    if (!EMAIL_RE.test(email.trim())) { setError('El correo no tiene un formato válido'); return }
    setError('')
    setLoading(true)
    try {
      const res = await forgotPassword(email.trim())
      setMessage(res.data?.message ?? 'Si el correo está registrado, te enviamos un enlace para recuperar tu contraseña')
      setSent(true)
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo procesar la solicitud')
    } finally {
      setLoading(false)
    }
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
          <h1 className="text-2xl font-bold text-gray-900">¿Olvidaste tu contraseña?</h1>
          <p className="text-gray-500 text-sm mt-1">
            Captura tu correo y te mandamos un enlace para recuperarla.
          </p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
              {message}
            </div>
            <Link to="/login" className="btn-primary w-full py-3 block text-center">Volver a iniciar sesión</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
              <input
                type="email"
                className="input"
                placeholder="admin@restopos.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
            </div>

            <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
            </button>
            <Link to="/login" className="block w-full text-center text-sm text-gray-400 hover:text-gray-600">
              Volver a iniciar sesión
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}
