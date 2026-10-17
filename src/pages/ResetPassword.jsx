import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { resetPassword, validateResetToken } from '../api/auth'
import AuthLayout, { AuthAviso, authInput, authBoton, authLink } from '../components/AuthLayout'
import PasswordInput from '../components/PasswordInput'

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

  const subtitulo = tokenStatus === 'valid' && !success ? 'Elige tu nueva contraseña (mínimo 6 caracteres).' : undefined
  return (
    <AuthLayout titulo="Restablecer contraseña" subtitulo={subtitulo}>
      {tokenStatus === 'checking' ? (
        <p className="text-sm text-gray-600">Revisando el enlace...</p>
      ) : tokenStatus !== 'valid' ? (
        <div className="space-y-4">
          <AuthAviso>{tokenStatus}</AuthAviso>
          <Link to="/forgot-password" className={`${authBoton} flex items-center justify-center`}>Solicitar enlace nuevo</Link>
          <Link to="/login" className={authLink}>Volver a iniciar sesión</Link>
        </div>
      ) : success ? (
        <AuthAviso tipo="ok">Contraseña actualizada, ya puedes iniciar sesión. Redirigiendo...</AuthAviso>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="reset-new" className="block text-sm font-bold text-gray-900">Nueva contraseña</label>
            <PasswordInput id="reset-new" autoComplete="new-password" className={authInput} placeholder="Tu nueva contraseña"
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            {fieldErrors.newPassword && <p className="text-red-700 text-xs mt-1">{fieldErrors.newPassword}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="reset-confirm" className="block text-sm font-bold text-gray-900">Confirmar contraseña</label>
            <PasswordInput id="reset-confirm" autoComplete="new-password" className={authInput} placeholder="Escríbela otra vez"
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            {fieldErrors.confirmPassword && <p className="text-red-700 text-xs mt-1">{fieldErrors.confirmPassword}</p>}
          </div>
          {error && <AuthAviso>{error}</AuthAviso>}
          <button type="submit" className={authBoton} disabled={loading}>
            {loading ? 'Guardando...' : 'Restablecer contraseña'}
          </button>
          <Link to="/login" className={authLink}>Volver a iniciar sesión</Link>
        </form>
      )}
    </AuthLayout>
  )
}
