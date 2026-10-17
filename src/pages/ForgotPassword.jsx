import { useState } from 'react'
import { Link } from 'react-router-dom'
import { forgotPassword } from '../api/auth'
import AuthLayout, { AuthAviso, authInput, authBoton, authLink } from '../components/AuthLayout'

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
    <AuthLayout titulo="¿Olvidaste tu contraseña?" subtitulo="Escribe tu correo y te mandamos un enlace para elegir una nueva.">
      {sent ? (
        <div className="space-y-4">
          <AuthAviso tipo="ok">{message}</AuthAviso>
          <Link to="/login" className={`${authBoton} flex items-center justify-center`}>Volver a iniciar sesión</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="forgot-email" className="block text-sm font-bold text-gray-900">Correo electrónico</label>
            <input id="forgot-email" type="email" autoComplete="email" className={authInput} placeholder="tu@correo.com"
              value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} />
            {error && <p className="text-red-700 text-xs mt-1">{error}</p>}
          </div>
          <button type="submit" className={authBoton} disabled={loading}>
            {loading ? 'Enviando...' : 'Enviar enlace'}
          </button>
          <Link to="/login" className={authLink}>Volver a iniciar sesión</Link>
        </form>
      )}
    </AuthLayout>
  )
}
