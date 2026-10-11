import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { resetPassword, validateResetToken } from '../api/auth'
import logo from '../assets/logo.png'

/**
 * Pantalla pública "Restablecer contraseña" — a la que llega el link del correo de "olvidé
 * mi contraseña" (`/reset-password?token=...`), sin sesión. Mismo tratamiento visual que
 * Login.jsx/ForgotPassword.jsx.
 */
export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [success, setSuccess] = useState(false)
  // Se revisa el link al abrir la pantalla: si ya venció o ya se usó, se avisa antes de
  // mostrar el formulario. 'checking' | 'valid' | mensaje de error.
  const [tokenStatus, setTokenStatus] = useState(token ? 'checking' : 'Este enlace no es válido. Solicita uno nuevo.')

  useEffect(() => {
    if (!token) return
    let cancelled = false
    validateResetToken(token)
      .then(() => { if (!cancelled) setTokenStatus('valid') })
      .catch((err) => {
        if (cancelled) return
        // Solo un 400 significa que el link ya no sirve; lo demás (sin conexión, 429, error del
        // servidor) no debe decirle al usuario que su link venció.
        if (err.response?.status === 400) {
          setTokenStatus(err.response.data?.message || 'El enlace no es válido o ya venció, solicita uno nuevo')
        } else {
          setTokenStatus(err.response?.status === 429
            ? (err.response.data?.message || 'Demasiados intentos. Espera un momento y recarga la página.')
            :'No se pudo revisar el enlace. Revisa tu conexión y recarga la página.')
        }
      })
    return () => { cancelled = true }
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    // Sin required/minLength nativos a propósito — mismo patrón que ChangePasswordRequired.jsx.
    // Mismo límite que ResetPasswordRequest en el backend (6-72, 72 por el truncado de BCrypt).
    const errors = {}
    if (!newPassword) errors.newPassword = 'La contraseña es obligatoria'
    else if (newPassword.length < 6) errors.newPassword = 'La contraseña debe tener al menos 6 caracteres'
    else if (newPassword.length > 72) errors.newPassword = 'La contraseña no puede tener más de 72 caracteres'
    if (!confirmPassword) errors.confirmPassword = 'Confirma la contraseña'
    else if (newPassword && !errors.newPassword && confirmPassword !== newPassword) errors.confirmPassword = 'Las contraseñas no coinciden'
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('')
      return
    }
    setFieldErrors({})
    setError('')
    setLoading(true)
    try {
      await resetPassword(token, newPassword)
      setSuccess(true)
      setTimeout(() => navigate('/login'), 2000)
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo actualizar la contraseña')
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
          <h1 className="text-2xl font-bold text-gray-900">Restablecer contraseña</h1>
          {tokenStatus === 'valid' && !success && (
            <p className="text-gray-500 text-sm mt-1">Elige tu nueva contraseña.</p>
          )}
        </div>

        {tokenStatus === 'checking' ? (
          <p className="text-center text-sm text-gray-400">Revisando el enlace...</p>
        ) : tokenStatus !== 'valid' ? (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {tokenStatus}
            </div>
            <Link to="/forgot-password" className="btn-primary w-full py-3 block text-center">Solicitar enlace nuevo</Link>
          </div>
        ) : success ? (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
            Contraseña actualizada, ya puedes iniciar sesión. Redirigiendo...
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nueva contraseña</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              {fieldErrors.newPassword && <p className="text-red-600 text-xs mt-1">{fieldErrors.newPassword}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar contraseña</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {fieldErrors.confirmPassword && <p className="text-red-600 text-xs mt-1">{fieldErrors.confirmPassword}</p>}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
              {loading ? 'Guardando...' : 'Restablecer contraseña'}
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
