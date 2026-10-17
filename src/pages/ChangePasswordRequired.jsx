import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { changePassword } from '../api/auth'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import AuthLayout, { AuthAviso, authInput, authBoton } from '../components/AuthLayout'
import PasswordInput from '../components/PasswordInput'

/**
 * Pantalla obligatoria "Cambia tu contraseña" — la ve un usuario YA AUTENTICADO al que un
 * admin le dio de alta la cuenta (o le reseteó la contraseña) con una temporal generada
 * por el sistema (`user.mustChangePassword`, ver `PrivateRoute.jsx`, que rebota aquí
 * cualquier otra ruta mientras el flag siga prendido). Exige la contraseña actual (la
 * temporal que recibió por correo) como comprobante de identidad.
 *
 * Vive fuera del `Layout` (sin sidebar) a propósito, para que se sienta un paso obligatorio
 * y no "otra pantalla más" del sistema — mismo tratamiento visual que Login.jsx.
 */
export default function ChangePasswordRequired() {
  const { user, logout, clearMustChangePassword } = useAuth()
  const { notify } = useNotify()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Solo al dar clic en "Cambiar contraseña y continuar" — mismo patrón que el resto de la app.
  const [fieldErrors, setFieldErrors] = useState({})

  async function handleSubmit(e) {
    e.preventDefault()
    // Sin `required`/`minLength` nativos en los inputs (ver el JSX de abajo) — esto es lo
    // único que valida antes de mandar la solicitud. Mismo límite que ChangePasswordRequest
    // en el backend (6-72 caracteres, 72 por el truncado silencioso de BCrypt).
    const errors = {}
    if (!currentPassword) errors.currentPassword = 'La contraseña temporal es obligatoria'
    if (!newPassword) errors.newPassword = 'La contraseña es obligatoria'
    else if (newPassword.length < 6) errors.newPassword = 'La contraseña debe tener al menos 6 caracteres'
    else if (newPassword.length > 72) errors.newPassword = 'La contraseña no puede tener más de 72 caracteres'
    else if (newPassword === currentPassword) errors.newPassword = 'La nueva contraseña debe ser distinta a la temporal'
    if (!confirmPassword) errors.confirmPassword = 'Confirma la contraseña'
    else if (newPassword && !errors.newPassword && confirmPassword !== newPassword) errors.confirmPassword = 'Las contraseñas no coinciden'
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('')
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    setFieldErrors({})
    setError('')
    setLoading(true)
    try {
      await changePassword(currentPassword, newPassword)
      clearMustChangePassword()
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo cambiar la contraseña')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout titulo="Cambia tu contraseña"
      subtitulo={`${user?.name ? `Hola ${user.name}, por` : 'Por'} seguridad, antes de continuar elige una contraseña propia distinta a la temporal que recibiste por correo.`}>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="cp-actual" className="block text-sm font-bold text-gray-900">Contraseña temporal</label>
          {/* Sin required/minLength nativos a propósito (ver handleSubmit). */}
          <PasswordInput id="cp-actual" autoComplete="current-password" className={authInput} placeholder="La que recibiste por correo"
            value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          {fieldErrors.currentPassword && <p className="text-red-700 text-xs mt-1">{fieldErrors.currentPassword}</p>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cp-nueva" className="block text-sm font-bold text-gray-900">Nueva contraseña</label>
          <PasswordInput id="cp-nueva" autoComplete="new-password" className={authInput} placeholder="Tu nueva contraseña"
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          {fieldErrors.newPassword && <p className="text-red-700 text-xs mt-1">{fieldErrors.newPassword}</p>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cp-confirmar" className="block text-sm font-bold text-gray-900">Confirmar contraseña</label>
          <PasswordInput id="cp-confirmar" autoComplete="new-password" className={authInput} placeholder="Escríbela otra vez"
            value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          {fieldErrors.confirmPassword && <p className="text-red-700 text-xs mt-1">{fieldErrors.confirmPassword}</p>}
        </div>
        {error && <AuthAviso>{error}</AuthAviso>}
        <button type="submit" className={authBoton} disabled={loading}>
          {loading ? 'Guardando...' : 'Cambiar contraseña y continuar'}
        </button>
        <button type="button" className="block w-full text-center text-sm font-bold text-gray-600 hover:underline py-2" onClick={logout}>
          Cerrar sesión
        </button>
      </form>
    </AuthLayout>
  )
}
