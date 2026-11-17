import { useEffect, useState } from 'react'
import { getMailConfig, updateMailConfig } from '../api/mailConfig'
import { useNotify } from '../context/NotifyContext'
import PasswordInput from '../components/PasswordInput'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Atajos para no tener que recordar host/puerto de los proveedores más comunes.
const PRESETS = [
  { label: 'Gmail', smtpHost: 'smtp.gmail.com', smtpPort: 587 },
  { label: 'Outlook / Office 365', smtpHost: 'smtp.office365.com', smtpPort: 587 },
  { label: 'Hostinger', smtpHost: 'smtp.hostinger.com', smtpPort: 465 },
]

/**
 * Pantalla "Correo del sistema" (Configuración → solo SUPER_ADMIN): administra la ÚNICA
 * cuenta SMTP con la que el backend manda todos los correos de la plataforma (tickets,
 * reportes de cierre de caja, contraseñas temporales, recuperación de contraseña, avisos a
 * clientes de la página web y reservaciones). Se guarda en la tabla `mail_config` y se puede
 * cambiar sin redeploy.
 *
 * `smtpPassword` es de solo escritura: nunca se precarga con la contraseña real (el backend
 * jamás la manda de vuelta), solo se manda si se escribe una nueva — dejar el campo en
 * blanco conserva la que ya está guardada.
 */
export default function MailSettings() {
  const { notify, confirmDialog } = useNotify()
  const [form, setForm] = useState(null)
  const [passwordConfigured, setPasswordConfigured] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')

  function applyResponse(cfg) {
    setForm({ enabled: cfg.enabled, smtpHost: cfg.smtpHost ?? '', smtpPort: cfg.smtpPort ?? 587, smtpUsername: cfg.smtpUsername ?? '' })
    setPasswordConfigured(cfg.passwordConfigured)
  }

  useEffect(() => {
    getMailConfig()
      .then((r) => applyResponse(r.data.data))
      .catch((err) => setError(err.response?.data?.message ?? 'No se pudo cargar la configuración de correo'))
      .finally(() => setLoading(false))
  }, [])

  function validate() {
    const errors = {}
    if (!form.smtpHost.trim()) errors.smtpHost = 'El host SMTP es obligatorio'
    const port = Number(form.smtpPort)
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.smtpPort = 'El puerto debe estar entre 1 y 65535'
    if (!form.smtpUsername.trim()) errors.smtpUsername = 'La cuenta es obligatoria'
    else if (!EMAIL_RE.test(form.smtpUsername.trim())) errors.smtpUsername = 'La cuenta debe ser un correo válido'
    if (form.enabled && !passwordConfigured && !newPassword.trim()) errors.smtpPassword = 'Captura la contraseña para poder enviar correos'
    return errors
  }

  async function handleSave(e) {
    e.preventDefault()
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    if (!(await confirmDialog(
      'Estos cambios afectan el envío de correo de TODAS las tiendas del sistema (tickets, cortes, contraseñas, página web y reservaciones). ¿Continuar?',
      { confirmText: 'Guardar configuración', danger: true }
    ))) return
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, smtpHost: form.smtpHost.trim(), smtpUsername: form.smtpUsername.trim(), smtpPort: Number(form.smtpPort) }
      if (newPassword.trim()) payload.smtpPassword = newPassword.trim()
      const res = await updateMailConfig(payload)
      applyResponse(res.data.data)
      setNewPassword('')
      notify('Configuración de correo actualizada', 'success')
    } catch (err) {
      const data = err.response?.data?.data
      if (data && typeof data === 'object' && !Array.isArray(data)) setFieldErrors(data)
      setError(err.response?.data?.message ?? 'No se pudo guardar la configuración')
      notify('Error al guardar la configuración de correo', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-gray-400 text-sm">Cargando...</p>
  if (!form) return <p className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 max-w-xl">{error}</p>

  return (
    <div className="max-w-xl">
      <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900 mb-1">Correo del sistema</h1>
      <p className="text-gray-500 text-sm mb-6">
        Cuenta única con la que salen los correos de <span className="font-medium">todas las tiendas</span>: tickets,
        reportes de cierre de caja, contraseñas de usuarios nuevos, recuperación de contraseña, avisos a clientes de la
        página web y reservaciones.
      </p>

      <form onSubmit={handleSave} className="card space-y-4">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          <span className="font-semibold">Envío de correo habilitado</span>
        </label>
        {!form.enabled && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 -mt-2">
            Apagado: el sistema sigue funcionando normal (cobros, cortes, usuarios), pero ningún correo sale — solo queda
            registrado en el log del servidor. Los usuarios nuevos no recibirán su contraseña temporal.
          </p>
        )}

        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-medium text-gray-600 mb-2">Proveedor</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const active = form.smtpHost === p.smtpHost && Number(form.smtpPort) === p.smtpPort
              return (
                <button key={p.label} type="button"
                  className={`min-h-[36px] px-3 rounded-lg text-[13px] font-semibold border ${active ? 'border-purple-600 text-purple-700 bg-purple-50' : 'border-[#E4E1DA] text-gray-700 hover:bg-[#F1EFEA]'}`}
                  onClick={() => setForm({ ...form, smtpHost: p.smtpHost, smtpPort: p.smtpPort })}>
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label htmlFor="smtp-host" className="block text-sm font-medium text-gray-700 mb-1">Host SMTP <span className={fieldErrors.smtpHost ? 'text-red-600' : ''}>*</span></label>
            <input id="smtp-host" type="text" className="input" value={form.smtpHost}
              onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} />
            {fieldErrors.smtpHost && <p className="text-red-600 text-xs mt-1">{fieldErrors.smtpHost}</p>}
          </div>
          <div>
            <label htmlFor="smtp-port" className="block text-sm font-medium text-gray-700 mb-1">Puerto <span className={fieldErrors.smtpPort ? 'text-red-600' : ''}>*</span></label>
            <input id="smtp-port" type="text" inputMode="numeric" className="input" value={form.smtpPort}
              onChange={(e) => setForm({ ...form, smtpPort: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
            {fieldErrors.smtpPort && <p className="text-red-600 text-xs mt-1">{fieldErrors.smtpPort}</p>}
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="smtp-user" className="block text-sm font-medium text-gray-700 mb-1">Cuenta (correo) <span className={fieldErrors.smtpUsername ? 'text-red-600' : ''}>*</span></label>
            <input id="smtp-user" type="text" className="input" autoComplete="off" value={form.smtpUsername}
              onChange={(e) => setForm({ ...form, smtpUsername: e.target.value })} />
            {fieldErrors.smtpUsername && <p className="text-red-600 text-xs mt-1">{fieldErrors.smtpUsername}</p>}
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="smtp-pass" className="block text-sm font-medium text-gray-700 mb-1">
              Contraseña {passwordConfigured
                ? <span className="text-xs font-normal text-green-700">· ya hay una guardada</span>
                : <span className="text-xs font-normal text-amber-700">· sin configurar</span>}
            </label>
            <PasswordInput id="smtp-pass" className="input" autoComplete="new-password"
              placeholder={passwordConfigured ? 'Déjalo en blanco para conservar la actual' : 'Contraseña de la cuenta'}
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            {fieldErrors.smtpPassword && <p className="text-red-600 text-xs mt-1">{fieldErrors.smtpPassword}</p>}
            <p className="text-xs text-gray-400 mt-1">
              Para Gmail no es tu contraseña normal: es una "contraseña de aplicación" (requiere verificación en 2 pasos),
              generada en myaccount.google.com/apppasswords. Se guarda cifrada y nunca se vuelve a mostrar.
            </p>
          </div>
        </div>

        <div className="bg-[#F7F6F2] border border-[#E4E1DA] text-gray-600 text-xs rounded-lg px-4 py-3">
          El "De:" de cada correo siempre es esta cuenta (Gmail no permite mandar con otro remitente). Lo que cambia es el
          nombre visible: el del restaurante en tickets y cortes, y "Nexora Systems Soporte" en los correos de cuenta.
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

        <button className="btn-primary" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </form>
    </div>
  )
}
