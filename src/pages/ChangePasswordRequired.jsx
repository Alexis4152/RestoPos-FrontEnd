import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { changePassword } from '../api/auth'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import logo from '../assets/logo.png'

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
          <h1 className="text-2xl font-bold text-gray-900">Cambia tu contraseña</h1>
          <p className="text-gray-500 text-sm mt-1">
            {user?.name ? `Hola ${user.name}, por` : 'Por'} seguridad, antes de continuar elige una contraseña propia distinta a la temporal que recibiste por correo.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña temporal</label>
            {/* Sin required/minLength nativos a propósito (ver handleSubmit). */}
            <input
              type="password"
              className="input"
              placeholder="La que recibiste por correo"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            {fieldErrors.currentPassword && <p className="text-red-600 text-xs mt-1">{fieldErrors.currentPassword}</p>}
          </div>
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
            {loading ? 'Guardando...' : 'Cambiar contraseña y continuar'}
          </button>
          <button type="button" className="w-full text-sm text-gray-400 hover:text-gray-600" onClick={logout}>
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  )
}
