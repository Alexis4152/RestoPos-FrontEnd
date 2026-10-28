import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getTiendaInfo, updateTiendaInfo, uploadTiendaLogo, removeTiendaLogo } from '../api/tiendas'
import { useNotify } from '../context/NotifyContext'
import defaultLogo from '../assets/logo.png'
import { resolveMediaUrl } from '../utils/media'

// Mismo límite que TiendaLogoService en el backend (ver ese archivo) — validarlo aquí
// también evita el viaje redondo al servidor solo para enterarse de que pesa de más.
const MAX_LOGO_MB = 3

// Mismos límites reales de columna que TiendaInfoRequest en el backend (ver ese archivo) —
// redesSociales/notasAdicionales son TEXT sin límite de columna, su tope de 500 es solo de
// aplicación, igual que en ProductRequest.description.
const FIELDS = [
  { key: 'name', label: 'Nombre de la tienda', required: true, maxLength: 150 },
  { key: 'razonSocial', label: 'Razón social', maxLength: 200 },
  { key: 'rfc', label: 'RFC', maxLength: 20 },
  { key: 'telefono', label: 'Teléfono', maxLength: 30 },
  { key: 'paginaWeb', label: 'Página web', maxLength: 200 },
  { key: 'calle', label: 'Calle', maxLength: 200 },
  { key: 'colonia', label: 'Colonia', maxLength: 150 },
  { key: 'codigoPostal', label: 'Código postal', maxLength: 10 },
  { key: 'localidad', label: 'Localidad', maxLength: 150 },
  { key: 'estado', label: 'Estado', maxLength: 100 },
  { key: 'redesSociales', label: 'Redes sociales', textarea: true, maxLength: 500 },
  { key: 'notasAdicionales', label: 'Otros datos', textarea: true, maxLength: 500 },
]

/**
 * Pantalla "Datos de la tienda": edita los datos fiscales y de contacto de la tienda del
 * usuario en sesión (razón social, RFC, teléfono, dirección, redes sociales, etc.) y el
 * logo que se muestra en el sidebar y en el ticket de venta. Solo la puede editar el
 * `ADMIN` de esa tienda (según el copy de la propia pantalla); el control de acceso a la
 * ruta ya lo resuelve `PrivateRoute`.
 *
 * La dirección se captura en 5 campos separados (calle, colonia, código postal, localidad,
 * estado) en vez de un solo campo de texto libre, porque el backend imprime cada uno en su
 * propia línea dentro del ticket PDF de venta.
 *
 * Al guardar el nombre de la tienda o el logo, se usa `patchTienda()` de `AuthContext`
 * para reflejar el cambio de inmediato en el sidebar sin recargar la página.
 */
export default function StoreInfo() {
  const { user, patchTienda } = useAuth()
  const { notify, confirmDialog } = useNotify()
  const tiendaId = user?.tienda?.id

  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  // Solo al dar clic en "Guardar cambios" — mismo patrón que Usuarios/Roles/Categorías.
  const [fieldErrors, setFieldErrors] = useState({})

  // Carga los datos fiscales/de contacto actuales de la tienda para precargar el formulario.
  useEffect(() => {
    if (!tiendaId) return
    getTiendaInfo(tiendaId).then((r) => {
      const info = r.data.data
      setForm({
        name: info.tienda?.name || '',
        razonSocial: info.razonSocial || '',
        rfc: info.rfc || '',
        telefono: info.telefono || '',
        paginaWeb: info.paginaWeb || '',
        calle: info.calle || '',
        colonia: info.colonia || '',
        codigoPostal: info.codigoPostal || '',
        localidad: info.localidad || '',
        estado: info.estado || '',
        redesSociales: info.redesSociales || '',
        notasAdicionales: info.notasAdicionales || '',
        costoEnvioDomicilio: info.costoEnvioDomicilio != null ? String(info.costoEnvioDomicilio) : '',
        blindCashCount: info.tienda?.blindCashCount ?? false,
        modoToma: info.tienda?.modoToma ?? 'DETALLADO',
        propinaMaxPorcentaje: String(info.tienda?.propinaMaxPorcentaje ?? 50),
      })
    }).finally(() => setLoading(false))
  }, [tiendaId])

  /**
   * Guarda los datos fiscales/de contacto de la tienda. Solo el nombre (`form.name`) se
   * refleja de inmediato en `AuthContext` vía `patchTienda`, porque es el único de estos
   * campos que se muestra en el sidebar; el resto (RFC, dirección, etc.) solo se usa en
   * el ticket PDF y no necesita propagarse a la sesión en memoria.
   *
   * Pide confirmación explícita antes de guardar: estos datos van directo al ticket que
   * se le entrega al cliente, así que un error aquí no se nota hasta que ya se imprimió.
   */
  async function handleSave(e) {
    e.preventDefault()
    // Valida que ningún campo supere su máximo real (mismos límites que TiendaInfoRequest
    // en el backend) ANTES de pedir confirmación — así el usuario ve el error de inmediato
    // en vez de confirmar y que lo rechace el backend.
    const errors = {}
    for (const f of FIELDS) {
      const value = form[f.key] || ''
      if (f.required && !value.trim()) {
        errors[f.key] = `${f.label} es obligatorio`
      } else if (f.maxLength && value.length > f.maxLength) {
        errors[f.key] = `${f.label} no puede tener más de ${f.maxLength} caracteres`
      }
    }
    const envio = String(form.costoEnvioDomicilio ?? '').trim()
    if (envio && (isNaN(Number(envio)) || Number(envio) < 0)) {
      errors.costoEnvioDomicilio = 'Debe ser un monto válido (0 o mayor)'
    }
    const tope = Number(String(form.propinaMaxPorcentaje ?? '').trim())
    if (!Number.isInteger(tope) || tope < 1 || tope > 100) {
      errors.propinaMaxPorcentaje = 'Debe ser un número entero entre 1 y 100'
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    setFieldErrors({})
    if (!(await confirmDialog('¿Deseas guardar estos datos? Se usarán en el ticket de venta.', { confirmText: 'Guardar datos', danger: false }))) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await updateTiendaInfo(tiendaId, { ...form, costoEnvioDomicilio: envio ? Number(envio) : null, propinaMaxPorcentaje: tope })
      patchTienda({ name: form.name, blindCashCount: !!form.blindCashCount, modoToma: form.modoToma, propinaMaxPorcentaje: tope })
      setMessage('Datos guardados')
    } catch (err) {
      const data = err.response?.data?.data
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        setFieldErrors(data)
      } else {
        setError(err.response?.data?.message || 'No se pudieron guardar los datos')
      }
    } finally {
      setSaving(false)
    }
  }

  // Sube el archivo de logo elegido y actualiza `AuthContext` con la nueva ruta para que
  // el sidebar/ticket lo reflejen sin recargar. Limpia el input file al terminar (éxito o
  // error) para permitir volver a seleccionar el mismo archivo si hace falta reintentar.
  async function handleLogoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_LOGO_MB * 1024 * 1024) {
      setError(`El logo pesa demasiado — el máximo permitido es ${MAX_LOGO_MB} MB`)
      e.target.value = ''
      return
    }
    setUploadingLogo(true)
    setError('')
    setMessage('')
    try {
      const res = await uploadTiendaLogo(tiendaId, file)
      patchTienda({ logoPath: res.data.data.logoPath })
      setMessage('Logo actualizado')
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo subir el logo')
    } finally {
      setUploadingLogo(false)
      e.target.value = ''
    }
  }

  // Quita el logo personalizado de la tienda; a partir de aquí se vuelve a usar el logo
  // por default (de Nexora) tanto en el sidebar como en el ticket.
  async function handleRemoveLogo() {
    setUploadingLogo(true)
    setError('')
    setMessage('')
    try {
      await removeTiendaLogo(tiendaId)
      patchTienda({ logoPath: null })
      setMessage('Se eliminó el logo, ahora se usa el logo por default')
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo eliminar el logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  if (loading || !form) return <p className="text-gray-400 text-sm">Cargando...</p>

  const logoSrc = resolveMediaUrl(user?.tienda?.logoPath) || defaultLogo

  return (
    <div className="max-w-2xl">
      <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900 mb-1">Datos de la tienda</h1>
      <p className="text-gray-500 text-sm mb-6">
        Información fiscal y de contacto de <span className="font-medium">{user?.tienda?.name}</span>. Solo la puede
        editar el administrador de esta tienda.
      </p>

      <div className="card mb-6">
        <p className="text-sm font-medium text-gray-700 mb-3">Logo</p>
        <div className="flex flex-wrap items-center gap-4">
          <img src={logoSrc} alt="Logo de la tienda" className="w-20 h-20 rounded-full object-cover border border-gray-200" />
          <div className="flex flex-col gap-2">
            <label className="btn-secondary text-sm cursor-pointer inline-block">
              {uploadingLogo ? 'Subiendo...' : 'Subir logo'}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoChange} disabled={uploadingLogo} />
            </label>
            {user?.tienda?.logoPath && (
              <button type="button" className="text-xs text-red-600 hover:underline text-left" onClick={handleRemoveLogo} disabled={uploadingLogo}>
                Quitar logo (usar el default)
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3">PNG, JPG o WEBP, máximo {MAX_LOGO_MB} MB. Si no subes uno, se usa el logo de Nexora.</p>
      </div>

      {/* Sin `required` nativo en Nombre a propósito (ver handleSave): el globo del
          navegador se disparaba antes de que este formulario alcanzara a correr. */}
      <form onSubmit={handleSave} className="card space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.textarea ? 'sm:col-span-2' : ''}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
              {f.textarea ? (
                <textarea
                  className="input"
                  rows={2}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              ) : (
                <input
                  type="text"
                  className="input"
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              )}
              {fieldErrors[f.key] && <p className="text-red-600 text-xs mt-1">{fieldErrors[f.key]}</p>}
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm font-semibold text-gray-800 mb-2">🛵 Servicio a domicilio</p>
          <label className="block text-sm font-medium text-gray-700 mb-1">Costo de envío a domicilio</label>
          <div className="relative max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
            <input type="number" min="0" step="0.01" className="input !pl-7" placeholder="0.00"
              value={form.costoEnvioDomicilio}
              onChange={(e) => setForm({ ...form, costoEnvioDomicilio: e.target.value })} />
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Se suma a las órdenes para llevar marcadas como "Envío a domicilio". Déjalo vacío o en 0 si no cobras envío.
          </p>
          {fieldErrors.costoEnvioDomicilio && <p className="text-red-600 text-xs mt-1">{fieldErrors.costoEnvioDomicilio}</p>}
        </div>

        <fieldset className="border-t border-gray-100 pt-4">
          <legend className="text-sm font-semibold text-gray-800 mb-1">Toma de orden</legend>
          <p className="text-xs text-gray-600 mb-2">
            Cómo arrancan los meseros de esta tienda. Cada uno puede cambiarlo en su dispositivo con el interruptor
            Rápido / Detallado de Mesas; los dos modos trabajan sobre las mismas órdenes.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              ['RAPIDO', 'Rápido', 'Mis mesas, menú directo, opciones sugeridas y cobrar en un paso. Para servicio con mucho movimiento.'],
              ['DETALLADO', 'Detallado', 'Plano por zonas, comensal por producto, entregar y luego generar la cuenta. Más control.'],
            ].map(([key, label, desc]) => (
              <label key={key} className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer ${form.modoToma === key ? 'border-purple-600 bg-purple-50' : 'border-gray-200'}`}>
                <input type="radio" name="modoToma" className="mt-1 w-4 h-4" checked={form.modoToma === key}
                  onChange={() => setForm({ ...form, modoToma: key })} />
                <span>
                  <span className="block text-sm font-semibold text-gray-800">{label}</span>
                  <span className="block text-xs text-gray-600 mt-0.5">{desc}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="border-t border-gray-100 pt-4">
          <label htmlFor="propina-max" className="block text-sm font-semibold text-gray-800 mb-1">Tope de propina</label>
          <div className="relative max-w-[8rem]">
            <input id="propina-max" type="number" min="1" max="100" step="1" inputMode="numeric" className="input !pr-8"
              value={form.propinaMaxPorcentaje}
              onChange={(e) => setForm({ ...form, propinaMaxPorcentaje: e.target.value })} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">%</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Lo máximo que se puede registrar de propina al cobrar, en porcentaje del consumo (también limita la
            propina en monto fijo). Evita errores por un dedo de más. Por default 50%.
          </p>
          {fieldErrors.propinaMaxPorcentaje && <p className="text-red-600 text-xs mt-1">{fieldErrors.propinaMaxPorcentaje}</p>}
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm font-semibold text-gray-800 mb-2">Corte de caja</p>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1 w-4 h-4" checked={!!form.blindCashCount}
              onChange={(e) => setForm({ ...form, blindCashCount: e.target.checked })} />
            <span>
              <span className="block text-sm font-semibold text-gray-800">Conteo ciego al cerrar corte</span>
              <span className="block text-xs text-gray-600 mt-0.5">
                El cajero no ve el efectivo esperado ni sus cobros en efectivo mientras su corte está abierto: cuenta el
                efectivo, cierra y solo entonces ve si cuadró. Así no puede ajustar su conteo para que coincida. Los
                administradores y supervisores siempre ven todo.
              </span>
            </span>
          </label>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
        )}
        {message && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">{message}</div>
        )}

        <button className="btn-primary" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar datos'}
        </button>
      </form>
    </div>
  )
}
