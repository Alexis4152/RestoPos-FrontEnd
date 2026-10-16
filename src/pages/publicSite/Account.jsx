import { useEffect, useState } from 'react'
import { loginCliente, registerCliente, getClientePedidos, reviewClientePedido, updateClienteMe, reportClientePedido, olvideContrasenaCliente, restablecerContrasenaCliente, getCuentasParaOpinar, opinarCuentaCliente, getRepetirPedido, uploadComprobanteCliente } from '../../api/publicSite'
import ComprobanteTransferencia, { puedeSubirComprobante } from './ComprobanteTransferencia'
import OpinionForm from './OpinionForm'
import { useAuth } from '../../context/AuthContext'
import { usePublicLiveRefresh, publicStreamBase } from '../../utils/liveEvents'
import defaultLogo from '../../assets/logo.png'
import { resolveMediaUrl } from '../../utils/media'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))
const fmtFecha = (d) => (d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TEL_RE = /^[0-9+()\-\s]+$/
const STAFF_ROLES_NO_WEB = ['ADMIN', 'SUPER_ADMIN', 'SUPERVISOR']

/**
 * ¿Este usuario del personal entra a la página web como repartidor de ESTA tienda? Tiene la
 * sección Entregas y no es admin/plataforma (esos tienen todas las secciones y trabajan desde
 * el punto de venta).
 */
export function esRepartidorDe(user, tiendaId) {
  return !!user && (user.sections ?? []).includes('DELIVERY')
    && !STAFF_ROLES_NO_WEB.includes(user.role) && user.tienda?.id === tiendaId
}

// Mismas reglas que ClienteRequests en el backend, para avisar antes de enviar.
function validarCliente(f, { conPassword }) {
  const e = {}
  if (f.nombre.trim().length < 2) e.nombre = 'Escribe tu nombre (mínimo 2 letras)'
  else if (f.nombre.length > 100) e.nombre = 'Máximo 100 caracteres'
  const digitos = f.telefono.replace(/\D/g, '').length
  if (!f.telefono.trim()) e.telefono = 'Escribe tu teléfono'
  else if (!TEL_RE.test(f.telefono)) e.telefono = 'Solo números, espacios, guiones o +'
  else if (digitos < 10 || digitos > 15) e.telefono = 'Debe tener entre 10 y 15 dígitos'
  if (f.direccion.trim().length < 5) e.direccion = 'Escribe tu dirección (calle, número, colonia)'
  else if (f.direccion.length > 200) e.direccion = 'Máximo 200 caracteres'
  if (conPassword) {
    if (!EMAIL_RE.test(f.email.trim())) e.email = 'Escribe un correo válido'
    else if (f.email.length > 150) e.email = 'Máximo 150 caracteres'
    if (f.password.length < 8) e.password = 'Mínimo 8 caracteres'
    else if (f.password.length > 72) e.password = 'Máximo 72 caracteres'
    if (f.confirm !== f.password) e.confirm = 'Las contraseñas no coinciden'
  }
  return e
}

const inputCls = 'mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-300'

function Field({ label, error, children }) {
  return (
    <label className="block text-sm text-gray-600">{label}
      {children}
      {error && <span className="block text-xs text-red-600 mt-0.5">{error}</span>}
    </label>
  )
}

/**
 * Pantalla de acceso de la página web — misma lógica que el login del punto de venta (correo
 * y contraseña), más registro de cliente y "Continuar como invitado". Un solo formulario de
 * entrada: primero prueba como cliente de la tienda; si ese correo no es de ningún cliente,
 * prueba como personal y solo deja pasar al repartidor de esta tienda.
 */
export function AuthScreen({ slug, tienda, onCliente, onRepartidor, onInvitado, onCancel }) {
  const { login: staffLogin, logout: staffLogout } = useAuth()
  const [modo, setModo] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', nombre: '', telefono: '', direccion: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); setError('') }

  async function entrar(e) {
    e.preventDefault()
    if (!form.email.trim() || !form.password) { setError('Escribe tu correo y contraseña'); return }
    setLoading(true)
    setError('')
    try {
      const res = await loginCliente(slug, { email: form.email.trim(), password: form.password })
      if (res.data.data) { onCliente(res.data.data); return }
      // No es cliente: ¿es personal (repartidor) de esta tienda?
      let u
      try {
        u = await staffLogin(form.email.trim(), form.password)
      } catch {
        setError('Correo o contraseña incorrectos')
        return
      }
      if (esRepartidorDe(u, tienda.tiendaId)) {
        if (u.mustChangePassword) { window.location.href = '/change-password'; return }
        onRepartidor()
      } else {
        await staffLogout()
        setError(u.tienda?.id === tienda.tiendaId
          ? 'Esta cuenta es del personal del restaurante: entra desde el punto de venta.'
          : 'Esta cuenta no pertenece a este restaurante.')
      }
    } catch (err) {
      setError(err.response?.data?.message ?? 'No se pudo iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  async function registrar(e) {
    e.preventDefault()
    const errs = validarCliente(form, { conPassword: true })
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setLoading(true)
    setError('')
    try {
      const res = await registerCliente(slug, {
        nombre: form.nombre.trim(), telefono: form.telefono.trim(), direccion: form.direccion.trim(),
        email: form.email.trim(), password: form.password,
      })
      onCliente(res.data.data)
    } catch (err) {
      const data = err.response?.data?.data
      if (data && typeof data === 'object') setErrors(data)
      setError(err.response?.data?.message ?? 'No se pudo crear la cuenta')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-700 via-purple-600 to-purple-500 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 sm:p-8">
        <div className="text-center">
          <img src={resolveMediaUrl(tienda.logoPath) || defaultLogo} alt="" className="w-20 h-20 rounded-full object-cover border border-gray-200 mx-auto" />
          <h1 className="text-2xl font-extrabold mt-3">{tienda.nombre}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {modo === 'login' ? 'Clientes y repartidores: inicia sesión' : modo === 'olvide' ? 'Recupera tu contraseña' : 'Crea tu cuenta de cliente'}
          </p>
        </div>

        {modo === 'olvide' ? (
          <OlvideForm slug={slug} emailInicial={form.email} onVolver={() => { setModo('login'); setError('') }} />
        ) : modo === 'login' ? (
          <form onSubmit={entrar} className="mt-6 space-y-3">
            <Field label="Correo">
              <input className={inputCls} type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Contraseña">
              <input className={inputCls} type="password" autoComplete="current-password" value={form.password} onChange={(e) => set('password', e.target.value)} />
            </Field>
            <div className="text-right -mt-1">
              <button type="button" className="text-xs text-purple-700 hover:underline" onClick={() => { setModo('olvide'); setError('') }}>
                ¿Olvidaste tu contraseña?
              </button>
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <button disabled={loading} className="w-full rounded-full bg-purple-600 text-white py-3 font-semibold hover:bg-purple-700 disabled:opacity-40">
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
            <p className="text-center text-sm text-gray-600">
              ¿No tienes cuenta? <button type="button" className="text-purple-700 font-semibold hover:underline" onClick={() => { setModo('registro'); setError('') }}>Regístrate como cliente</button>
            </p>
            <p className="text-center text-xs text-gray-400">
              🛵 ¿Eres repartidor? No necesitas registrarte: entra con el correo y contraseña que te dio el restaurante.
            </p>
          </form>
        ) : (
          <form onSubmit={registrar} className="mt-6 space-y-3">
            <Field label="Nombre completo *" error={errors.nombre}>
              <input className={inputCls} maxLength={100} autoComplete="name" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} />
            </Field>
            <Field label="Teléfono *" error={errors.telefono}>
              <input className={inputCls} type="tel" maxLength={30} autoComplete="tel" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} />
            </Field>
            <Field label="Dirección *" error={errors.direccion}>
              <textarea className={inputCls} rows={2} maxLength={200} autoComplete="street-address" placeholder="Calle, número, colonia, referencias"
                value={form.direccion} onChange={(e) => set('direccion', e.target.value)} />
            </Field>
            <Field label="Correo *" error={errors.email}>
              <input className={inputCls} type="email" maxLength={150} autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Contraseña * (mínimo 8 caracteres)" error={errors.password}>
              <input className={inputCls} type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} />
            </Field>
            <Field label="Confirma tu contraseña *" error={errors.confirm}>
              <input className={inputCls} type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} />
            </Field>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <button disabled={loading} className="w-full rounded-full bg-purple-600 text-white py-3 font-semibold hover:bg-purple-700 disabled:opacity-40">
              {loading ? 'Creando cuenta...' : 'Crear cuenta de cliente'}
            </button>
            <p className="text-center text-sm text-gray-600">
              ¿Ya tienes cuenta? <button type="button" className="text-purple-700 font-semibold hover:underline" onClick={() => { setModo('login'); setError('') }}>Inicia sesión</button>
            </p>
          </form>
        )}

        <div className="mt-6 pt-5 border-t border-gray-100 space-y-2">
          <button type="button" onClick={onInvitado}
            className="w-full rounded-full border-2 border-gray-300 py-3 font-semibold text-gray-700 hover:bg-gray-50">
            Continuar como invitado
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="w-full text-sm text-gray-500 hover:text-gray-700 py-1">Volver</button>
          )}
        </div>
      </div>
    </div>
  )
}

/** "¿Olvidaste tu contraseña?": pide el correo y manda el enlace (si la cuenta existe). */
function OlvideForm({ slug, emailInicial, onVolver }) {
  const [email, setEmail] = useState(emailInicial || '')
  const [enviado, setEnviado] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    if (!EMAIL_RE.test(email.trim())) { setError('Escribe un correo válido'); return }
    setLoading(true)
    setError('')
    try {
      const r = await olvideContrasenaCliente(slug, email.trim())
      setEnviado(r.data.message ?? 'Si ese correo tiene cuenta, te enviamos un enlace.')
    } catch (err) {
      setError(err.response?.data?.message ?? 'No se pudo enviar el correo')
    } finally { setLoading(false) }
  }

  if (enviado) {
    return (
      <div className="mt-6 space-y-3 text-center">
        <p className="text-5xl">📧</p>
        <p className="text-sm text-gray-700">{enviado}. Revisa tu bandeja de entrada (y la de spam); el enlace vence en 1 hora.</p>
        <button type="button" onClick={onVolver} className="w-full rounded-full bg-purple-600 text-white py-3 font-semibold hover:bg-purple-700">Volver a iniciar sesión</button>
      </div>
    )
  }
  return (
    <form onSubmit={enviar} className="mt-6 space-y-3">
      <p className="text-sm text-gray-600">Escribe el correo de tu cuenta y te mandaremos un enlace para crear una contraseña nueva.</p>
      <Field label="Correo">
        <input className={inputCls} type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} />
      </Field>
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      <button disabled={loading} className="w-full rounded-full bg-purple-600 text-white py-3 font-semibold hover:bg-purple-700 disabled:opacity-40">
        {loading ? 'Enviando...' : 'Enviarme el enlace'}
      </button>
      <button type="button" onClick={onVolver} className="w-full text-sm text-gray-500 hover:text-gray-700">Volver</button>
    </form>
  )
}

/** Pantalla del enlace "restablecer contraseña" (?restablecer=código). */
export function RestablecerScreen({ slug, tienda, token, onListo }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [listo, setListo] = useState(false)
  const [loading, setLoading] = useState(false)

  async function guardar(e) {
    e.preventDefault()
    if (password.length < 8 || password.length > 72) { setError('La contraseña debe tener entre 8 y 72 caracteres'); return }
    if (password !== confirm) { setError('Las contraseñas no coinciden'); return }
    setLoading(true)
    setError('')
    try {
      await restablecerContrasenaCliente(slug, token, password)
      setListo(true)
    } catch (err) {
      setError(err.response?.data?.message ?? 'No se pudo cambiar la contraseña')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-700 via-purple-600 to-purple-500 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 sm:p-8">
        <div className="text-center">
          <img src={resolveMediaUrl(tienda.logoPath) || defaultLogo} alt="" className="w-20 h-20 rounded-full object-cover border border-gray-200 mx-auto" />
          <h1 className="text-2xl font-extrabold mt-3">{tienda.nombre}</h1>
          <p className="text-sm text-gray-500 mt-1">Crea tu nueva contraseña</p>
        </div>
        {listo ? (
          <div className="mt-6 space-y-3 text-center">
            <p className="text-5xl">✅</p>
            <p className="text-sm text-gray-700">Listo, tu contraseña cambió. Por seguridad cerramos tus otras sesiones abiertas.</p>
            <button type="button" onClick={onListo} className="w-full rounded-full bg-purple-600 text-white py-3 font-semibold hover:bg-purple-700">Iniciar sesión</button>
          </div>
        ) : (
          <form onSubmit={guardar} className="mt-6 space-y-3">
            <Field label="Nueva contraseña (mínimo 8 caracteres)">
              <input className={inputCls} type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setError('') }} />
            </Field>
            <Field label="Confírmala">
              <input className={inputCls} type="password" autoComplete="new-password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setError('') }} />
            </Field>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <button disabled={loading} className="w-full rounded-full bg-purple-600 text-white py-3 font-semibold hover:bg-purple-700 disabled:opacity-40">
              {loading ? 'Guardando...' : 'Guardar contraseña'}
            </button>
            <button type="button" onClick={onListo} className="w-full text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          </form>
        )}
      </div>
    </div>
  )
}

/** Estrellas de 1 a 5; interactivas si se pasa `onChange`. */
export function Stars({ value, onChange, size = 'text-2xl' }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)}
          aria-label={`${n} estrella${n === 1 ? '' : 's'}`}
          className={`${size} leading-none ${n <= (value ?? 0) ? 'text-yellow-400' : 'text-gray-300'} ${onChange ? 'hover:scale-110 transition-transform' : 'cursor-default'}`}>
          ★
        </button>
      ))}
    </span>
  )
}

const ESTADO_INFO = {
  RECIBIDO: { label: 'Recibido', cls: 'bg-blue-100 text-blue-800' },
  ACEPTADO: { label: 'En preparación', cls: 'bg-orange-100 text-orange-800' },
  LISTO: { label: 'Listo', cls: 'bg-green-100 text-green-800' },
  EN_CAMINO: { label: 'En camino', cls: 'bg-purple-100 text-purple-800' },
  ENTREGADO: { label: 'Entregado', cls: 'bg-gray-200 text-gray-800' },
  RECHAZADO: { label: 'No aceptado', cls: 'bg-red-100 text-red-800' },
}

// Mismas etapas que el seguimiento del invitado (PedidoTracker en PublicSite.jsx); "En camino"
// solo aplica a domicilio.
const STEPS = [
  { key: 'RECIBIDO', label: 'Recibido', hint: 'Esperando que el restaurante confirme tu pedido.' },
  { key: 'ACEPTADO', label: 'En preparación', hint: '¡Confirmado! Ya lo estamos preparando.' },
  { key: 'LISTO', label: 'Listo', hint: 'Tu pedido está listo.' },
  { key: 'EN_CAMINO', label: 'En camino', hint: 'El repartidor ya va hacia tu domicilio.', soloDomicilio: true },
  { key: 'ENTREGADO', label: 'Entregado', hint: '¡Gracias por tu compra!' },
]

/** Barra de etapas del pedido (Recibido → En preparación → Listo → [En camino] → Entregado). */
function Etapas({ pedido }) {
  const steps = STEPS.filter((s) => !s.soloDomicilio || pedido.tipoEntrega === 'DOMICILIO')
  const idx = steps.findIndex((s) => s.key === pedido.estado)
  if (idx < 0) return null
  const terminado = pedido.estado === 'ENTREGADO'
  return (
    <div className="mt-4">
      {!terminado && (
        <>
          <p className="text-lg font-bold">{steps[idx].label}</p>
          <p className="text-sm text-gray-600">{steps[idx].hint}</p>
        </>
      )}
      <ol className={`mt-3 grid gap-2 ${steps.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {steps.map((s, i) => (
          <li key={s.key} className="text-center">
            <div className={`h-2 rounded-full ${i <= idx ? 'bg-purple-600' : 'bg-gray-200'}`} />
            <p className={`text-xs mt-2 ${i <= idx ? 'text-purple-700 font-semibold' : 'text-gray-400'}`}>{s.label}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * "Mis pedidos" del cliente registrado: arriba los que siguen en curso (tarjeta completa con su
 * barra de etapas); abajo los terminados en una lista compacta que se despliega al tocarla —
 * por defecto los últimos 10, o todos los de un rango de fechas con el buscador.
 */
export function MisPedidos({ slug, tienda, token, onSesionVencida, onPedir, onRepetir }) {
  const [pedidos, setPedidos] = useState(null)
  // "Volver a pedir": pedido que se está cargando al carrito y aviso si no se pudo.
  const [repitiendo, setRepitiendo] = useState(null)
  const [avisoRepetir, setAvisoRepetir] = useState(null) // { id, texto }

  async function repetir(p) {
    setRepitiendo(p.id)
    setAvisoRepetir(null)
    try {
      const r = await getRepetirPedido(slug, token, p.id)
      const data = r.data.data
      if (data.lineas.length === 0) {
        setAvisoRepetir({ id: p.id, texto: 'Ninguno de los platillos de este pedido está disponible ahora.' })
        return
      }
      onRepetir(data)
    } catch (err) {
      if (err.response?.status === 401) onSesionVencida()
      else setAvisoRepetir({ id: p.id, texto: err.response?.data?.message ?? 'No se pudo cargar el pedido' })
    } finally { setRepitiendo(null) }
  }
  const [abiertoId, setAbiertoId] = useState(null)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [filtro, setFiltro] = useState({ desde: '', hasta: '' }) // el aplicado (al dar "Buscar")
  const [errorFechas, setErrorFechas] = useState('')

  const load = () => getClientePedidos(slug, token, filtro)
    .then((r) => setPedidos(r.data.data ?? []))
    .catch((err) => { if (err.response?.status === 401) onSesionVencida(); else setPedidos((p) => p ?? []) })
  useEffect(() => { load() }, [slug, token, filtro])
  // Tiempo real: cuando cambia cualquiera de sus pedidos, se recarga la lista.
  usePublicLiveRefresh(`${publicStreamBase(slug)}/clientes/me/eventos`, load,
    { headers: { 'X-Cliente-Token': token }, alFallarAuth: onSesionVencida })

  function buscar(e) {
    e.preventDefault()
    if (!desde && !hasta) { setErrorFechas('Elige al menos una fecha'); return }
    if (desde && hasta && desde > hasta) { setErrorFechas('La fecha inicial no puede ser mayor que la final'); return }
    setErrorFechas('')
    setAbiertoId(null)
    setFiltro({ desde, hasta })
  }
  function limpiar() {
    setDesde(''); setHasta(''); setErrorFechas(''); setAbiertoId(null)
    setFiltro({ desde: '', hasta: '' })
  }

  if (pedidos === null) return <p className="text-center text-gray-400 py-16">Cargando tus pedidos...</p>

  const terminado = (p) => p.estado === 'ENTREGADO' || p.estado === 'RECHAZADO'
  const enCurso = pedidos.filter((p) => !terminado(p))
  const terminados = pedidos.filter(terminado)
  const actualizar = (nuevo) => setPedidos((list) => list.map((x) => (x.id === nuevo.id ? nuevo : x)))
  const filtrando = !!(filtro.desde || filtro.hasta)
  const fmtDia = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('es-MX', { dateStyle: 'medium' })
  const resumen = filtrando
    ? `${terminados.length} pedido${terminados.length === 1 ? '' : 's'}${filtro.desde ? ` desde ${fmtDia(filtro.desde)}` : ''}${filtro.hasta ? ` hasta ${fmtDia(filtro.hasta)}` : ''}`
    : 'Tus últimos 10 — busca por fechas para ver más'

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold">Mis pedidos</h2>
      {pedidos.length === 0 && !filtrando && (
        <div className="text-center py-16">
          <p className="text-gray-400">Todavía no has hecho pedidos.</p>
          <button onClick={onPedir} className="mt-4 rounded-full bg-purple-600 text-white px-6 py-2.5 font-semibold hover:bg-purple-700">Ver el menú</button>
        </div>
      )}

      {enCurso.length > 0 && (
        <section className="mt-4">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide">En curso</h3>
          <div className="mt-2 space-y-4">
            {enCurso.map((p) => (
              <PedidoHistorial key={p.id} slug={slug} tienda={tienda} token={token} pedido={p} onCambio={actualizar} onSesionVencida={onSesionVencida} />
            ))}
          </div>
        </section>
      )}

      {(terminados.length > 0 || filtrando) && (
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide">Terminados</h3>
            <p className="text-xs text-gray-400">{resumen}</p>
          </div>

          <form onSubmit={buscar} className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
            <label className="text-xs text-gray-600 flex-1 min-w-[8rem]">Desde
              <input type="date" className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={desde} max={hasta || undefined}
                onChange={(e) => { setDesde(e.target.value); setErrorFechas('') }} />
            </label>
            <label className="text-xs text-gray-600 flex-1 min-w-[8rem]">Hasta
              <input type="date" className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={hasta} min={desde || undefined}
                onChange={(e) => { setHasta(e.target.value); setErrorFechas('') }} />
            </label>
            <button className="rounded-lg bg-purple-600 text-white px-4 py-2 text-sm font-semibold hover:bg-purple-700">Buscar</button>
            {filtrando && (
              <button type="button" onClick={limpiar} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">Limpiar</button>
            )}
            {errorFechas && <p className="w-full text-xs text-red-600">{errorFechas}</p>}
          </form>

          {terminados.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">No hay pedidos terminados en esas fechas.</p>
          ) : (
            <div className="mt-2 rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
              {terminados.map((p) => (
                <PedidoTerminado key={p.id} slug={slug} token={token} pedido={p} abierto={abiertoId === p.id}
                  onToggle={() => setAbiertoId((id) => (id === p.id ? null : p.id))}
                  onCambio={actualizar} onSesionVencida={onSesionVencida}
                  onRepetir={onRepetir ? () => repetir(p) : null} repitiendo={repitiendo === p.id}
                  aviso={avisoRepetir?.id === p.id ? avisoRepetir.texto : null} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

/** Fila compacta de un pedido terminado; al tocarla se despliega el detalle (y la calificación). */
function PedidoTerminado({ slug, token, pedido, abierto, onToggle, onCambio, onSesionVencida, onRepetir, repitiendo, aviso }) {
  const info = ESTADO_INFO[pedido.estado] ?? { label: pedido.estado, cls: 'bg-gray-100 text-gray-700' }
  const porCalificar = pedido.tipoEntrega !== 'MESA' && pedido.estado === 'ENTREGADO' && !pedido.resenaEstrellas
  return (
    <div>
      <div className="flex items-center hover:bg-gray-50">
      <button type="button" onClick={onToggle} className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-2 py-3 text-left">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Pedido #{pedido.id} <span className="font-normal text-gray-500">· {fmtFecha(pedido.creadoEn)}</span></p>
          <p className="text-xs text-gray-500 truncate">{pedido.items.map((it) => `${Number(it.cantidad)}× ${it.nombre}`).join(', ')}</p>
        </div>
        {pedido.puedeReportar && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 whitespace-nowrap">¿Cómo llegó?</span>}
        {pedido.resenaEstrellas ? <Stars value={pedido.resenaEstrellas} size="text-sm" />
          : porCalificar ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">⭐ Calificar</span>
          : <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${info.cls}`}>{info.label}</span>}
        <span className="text-sm font-bold w-20 text-right">{fmt(pedido.total)}</span>
        <span className="text-gray-400">{abierto ? '▾' : '▸'}</span>
      </button>
      {/* Vuelve a cargar al carrito los platillos de este pedido (con el menú y precios de hoy). */}
      {onRepetir && (
        <button type="button" onClick={onRepetir} disabled={repitiendo} title="Volver a pedir"
          className="mr-3 shrink-0 rounded-full border border-purple-300 bg-white px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-50 disabled:opacity-50">
          {repitiendo ? '...' : <>🔁<span className="hidden sm:inline"> Volver a pedir</span></>}
        </button>
      )}
      </div>
      {aviso && <p className="px-4 pb-2 text-xs text-red-600">{aviso}</p>}
      {abierto && (
        <div className="px-3 pb-3">
          <PedidoHistorial slug={slug} token={token} pedido={pedido} onCambio={onCambio} onSesionVencida={onSesionVencida} />
        </div>
      )}
    </div>
  )
}

const REPORTE_OPCIONES = [
  { tipo: 'BIEN', label: '✅ Llegó bien', cls: 'border-green-500 bg-green-50 text-green-800' },
  { tipo: 'MAL', label: '⚠️ Llegó mal', cls: 'border-orange-500 bg-orange-50 text-orange-800' },
  { tipo: 'FALTANTE', label: '❌ Me faltó algo', cls: 'border-red-500 bg-red-50 text-red-800' },
]
const REPORTE_LABEL = { BIEN: '✅ Llegó bien', MAL: '⚠️ Llegó mal', FALTANTE: '❌ Le faltó algo' }

/**
 * "¿Cómo llegó tu pedido?" — reporte opcional del cliente registrado (bien / mal / faltó algo
 * y qué productos), una sola vez y hasta 24 h después de la entrega. Aparte de las estrellas.
 */
function ReporteEntrega({ slug, token, pedido, onCambio, onSesionVencida }) {
  const [tipo, setTipo] = useState(null)
  const [productos, setProductos] = useState([])
  const [comentario, setComentario] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (pedido.reporteTipo) {
    return (
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase">Tu reporte de entrega</p>
        <p className="font-semibold mt-0.5">{REPORTE_LABEL[pedido.reporteTipo] ?? pedido.reporteTipo}</p>
        {pedido.reporteProductos && <p className="text-sm text-gray-700">Productos: {pedido.reporteProductos}</p>}
        {pedido.reporteComentario && <p className="text-sm text-gray-700 italic">"{pedido.reporteComentario}"</p>}
      </div>
    )
  }
  if (!pedido.puedeReportar) return null

  const platillos = pedido.items.filter((it) => it.nombre !== 'Envío a domicilio')
  const pideProductos = tipo === 'MAL' || tipo === 'FALTANTE'
  const toggle = (id) => { setProductos((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); setError('') }
  const hasta = new Date(pedido.reportarHasta).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })

  async function enviar(e) {
    e.preventDefault()
    if (!tipo) { setError('Elige cómo llegó tu pedido'); return }
    if (tipo === 'FALTANTE' && productos.length === 0) { setError('Marca qué producto te faltó'); return }
    setSaving(true)
    setError('')
    try {
      const r = await reportClientePedido(slug, token, pedido.id, {
        tipo, productoIds: pideProductos ? productos : [], comentario: comentario.trim() || undefined,
      })
      onCambio(r.data.data)
    } catch (err) {
      if (err.response?.status === 401) onSesionVencida()
      else setError(err.response?.data?.message ?? 'No se pudo enviar tu reporte')
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={enviar} className="mt-3 pt-3 border-t border-gray-100">
      <p className="font-semibold">¿Cómo llegó tu pedido? <span className="text-xs font-normal text-gray-400">(opcional)</span></p>
      <p className="text-xs text-gray-500">Puedes reportarlo hasta el {hasta}.</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {REPORTE_OPCIONES.map((o) => (
          <button key={o.tipo} type="button" onClick={() => { setTipo(o.tipo); setError(''); if (o.tipo === 'BIEN') setProductos([]) }}
            className={`rounded-xl border-2 px-2 py-2 text-sm font-semibold ${tipo === o.tipo ? o.cls : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
            {o.label}
          </button>
        ))}
      </div>
      {pideProductos && (
        <div className="mt-3">
          <p className="text-sm text-gray-700">{tipo === 'FALTANTE' ? '¿Qué te faltó? *' : '¿Qué llegó mal? (opcional)'}</p>
          <div className="mt-1 space-y-1">
            {platillos.map((it) => (
              <label key={it.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="w-4 h-4" checked={productos.includes(it.id)} onChange={() => toggle(it.id)} />
                {Number(it.cantidad)}× {it.nombre}
              </label>
            ))}
          </div>
        </div>
      )}
      {tipo && (
        <>
          <textarea className={inputCls} rows={2} maxLength={500}
            placeholder={tipo === 'BIEN' ? 'Comentario (opcional)' : 'Cuéntanos qué pasó (opcional)'}
            value={comentario} onChange={(e) => setComentario(e.target.value)} />
          <p className="text-xs text-gray-400 text-right">{comentario.length}/500</p>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {tipo && (
        <button disabled={saving} className="mt-2 rounded-full bg-purple-600 text-white px-5 py-2 font-semibold hover:bg-purple-700 disabled:opacity-40">
          {saving ? 'Enviando...' : 'Enviar reporte'}
        </button>
      )}
    </form>
  )
}

function PedidoHistorial({ slug, tienda, token, pedido, onCambio, onSesionVencida }) {
  const [estrellas, setEstrellas] = useState(0)
  const [comentario, setComentario] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const info = ESTADO_INFO[pedido.estado] ?? { label: pedido.estado, cls: 'bg-gray-100 text-gray-700' }
  // Las visitas al restaurante (MESA) no usan esta reseña: se opinan por cuenta (OpinionesVisita).
  const enMesa = pedido.tipoEntrega === 'MESA'
  const puedeCalificar = !enMesa && pedido.estado === 'ENTREGADO' && !pedido.resenaEstrellas

  async function enviar(e) {
    e.preventDefault()
    if (estrellas < 1) { setError('Elige de 1 a 5 estrellas'); return }
    setSaving(true)
    setError('')
    try {
      const r = await reviewClientePedido(slug, token, pedido.id, { estrellas, comentario: comentario.trim() || undefined })
      onCambio(r.data.data)
    } catch (err) {
      if (err.response?.status === 401) onSesionVencida()
      else setError(err.response?.data?.message ?? 'No se pudo guardar tu calificación')
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold">Pedido #{pedido.id}</p>
          <p className="text-xs text-gray-500">{fmtFecha(pedido.creadoEn)} · {pedido.tipoEntrega === 'MESA' ? `🍽️ En el restaurante${pedido.mesa ? ` · Mesa ${pedido.mesa}` : ''}` : pedido.tipoEntrega === 'DOMICILIO' ? '🛵 A domicilio' : '🛍️ Para recoger'}</p>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${info.cls}`}>{info.label}</span>
      </div>
      {pedido.estado === 'RECHAZADO' ? (
        <p className="mt-3 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
          El restaurante no pudo aceptar tu pedido{pedido.motivoRechazo ? `: ${pedido.motivoRechazo}` : '.'}
        </p>
      ) : !enMesa && <Etapas pedido={pedido} />}
      <ul className="mt-4 pt-3 border-t border-gray-100 text-sm space-y-1">
        {pedido.items.map((it, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>{Number(it.cantidad)}× {it.nombre}{it.modificadores.length > 0 && <span className="text-xs text-gray-500"> ({it.modificadores.join(', ')})</span>}</span>
            <span className="shrink-0">{fmt(it.subtotal)}</span>
          </li>
        ))}
      </ul>
      <p className="text-right font-bold mt-2">Total {fmt(pedido.total)}</p>

      {/* Pago por transferencia a domicilio: datos de la cuenta y subir la foto del comprobante. */}
      {puedeSubirComprobante(pedido) && (
        <ComprobanteTransferencia status={pedido} tienda={tienda} onActualizado={onCambio}
          onSubir={(file, incluyeEnvio) => uploadComprobanteCliente(slug, token, pedido.id, file, incluyeEnvio)
            .catch((err) => { if (err.response?.status === 401) onSesionVencida(); throw err })} />
      )}

      <ReporteEntrega slug={slug} token={token} pedido={pedido} onCambio={onCambio} onSesionVencida={onSesionVencida} />
      {enMesa && pedido.estado === 'ENTREGADO' && (
        <OpinionesVisita slug={slug} token={token} ordenId={pedido.id} onSesionVencida={onSesionVencida} />
      )}

      {pedido.resenaEstrellas ? (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase">Tu calificación</p>
          <Stars value={pedido.resenaEstrellas} size="text-xl" />
          {pedido.resenaComentario && <p className="text-sm text-gray-700 mt-1 italic">"{pedido.resenaComentario}"</p>}
        </div>
      ) : puedeCalificar && (
        <form onSubmit={enviar} className="mt-3 pt-3 border-t border-gray-100">
          <p className="font-semibold">¿Qué tal estuvo tu pedido?</p>
          <Stars value={estrellas} onChange={(n) => { setEstrellas(n); setError('') }} size="text-3xl" />
          <textarea className={inputCls} rows={2} maxLength={500} placeholder="Déjanos un comentario (opcional)"
            value={comentario} onChange={(e) => setComentario(e.target.value)} />
          <p className="text-xs text-gray-400 text-right">{comentario.length}/500</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={saving} className="mt-2 rounded-full bg-purple-600 text-white px-5 py-2 font-semibold hover:bg-purple-700 disabled:opacity-40">
            {saving ? 'Enviando...' : 'Enviar calificación'}
          </button>
        </form>
      )}

    </div>
  )
}

/** Datos del cliente (nombre, teléfono, dirección); el correo no se cambia aquí. */
export function PerfilCliente({ slug, token, cliente, onActualizado, onSesionVencida }) {
  const [form, setForm] = useState({ nombre: cliente.nombre, telefono: cliente.telefono, direccion: cliente.direccion, email: cliente.email, password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); setMsg('') }

  async function guardar(e) {
    e.preventDefault()
    const errs = validarCliente(form, { conPassword: false })
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSaving(true)
    try {
      const r = await updateClienteMe(slug, token, { nombre: form.nombre.trim(), telefono: form.telefono.trim(), direccion: form.direccion.trim() })
      onActualizado(r.data.data)
      setMsg('Datos guardados')
    } catch (err) {
      if (err.response?.status === 401) { onSesionVencida(); return }
      const data = err.response?.data?.data
      if (data && typeof data === 'object') setErrors(data)
      setMsg(err.response?.data?.message ?? 'No se pudieron guardar tus datos')
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={guardar} className="max-w-md mx-auto bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
      <h2 className="text-2xl font-bold">Mis datos</h2>
      <p className="text-sm text-gray-500">Se usan para llenar tus pedidos automáticamente.</p>
      <Field label="Correo"><input className={`${inputCls} bg-gray-50 text-gray-500`} value={form.email} disabled /></Field>
      <Field label="Nombre completo *" error={errors.nombre}>
        <input className={inputCls} maxLength={100} value={form.nombre} onChange={(e) => set('nombre', e.target.value)} />
      </Field>
      <Field label="Teléfono *" error={errors.telefono}>
        <input className={inputCls} type="tel" maxLength={30} value={form.telefono} onChange={(e) => set('telefono', e.target.value)} />
      </Field>
      <Field label="Dirección *" error={errors.direccion}>
        <textarea className={inputCls} rows={2} maxLength={200} value={form.direccion} onChange={(e) => set('direccion', e.target.value)} />
      </Field>
      {msg && <p className={`text-sm rounded-lg px-3 py-2 ${msg === 'Datos guardados' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>{msg}</p>}
      <button disabled={saving} className="w-full rounded-full bg-purple-600 text-white py-3 font-semibold hover:bg-purple-700 disabled:opacity-40">
        {saving ? 'Guardando...' : 'Guardar'}
      </button>
    </form>
  )
}

/**
 * Opinión de una visita al restaurante desde "Mis pedidos" (la orden la ligó el mesero a esta
 * cuenta): un formulario por cada cuenta pagada (si la mesa pagó separado, cada cuenta aparte).
 */
function OpinionesVisita({ slug, token, ordenId, onSesionVencida }) {
  const [cuentas, setCuentas] = useState(null)
  useEffect(() => {
    getCuentasParaOpinar(slug, token, ordenId)
      .then((r) => setCuentas(r.data.data ?? []))
      .catch((err) => { if (err.response?.status === 401) onSesionVencida(); else setCuentas([]) })
  }, [slug, token, ordenId])
  if (!cuentas || cuentas.length === 0) return null
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-4">
      <p className="font-semibold">¿Qué tal estuvo tu visita?</p>
      {cuentas.map((c) => (
        <div key={c.cuentaId} className={cuentas.length > 1 ? 'rounded-xl border border-gray-200 p-3' : ''}>
          <OpinionForm cuenta={c} compacto
            onEnviar={async (data) => {
              const r = await opinarCuentaCliente(slug, token, c.cuentaId, data)
              setCuentas((list) => list.map((x) => (x.cuentaId === c.cuentaId ? r.data.data : x)))
            }} />
        </div>
      ))}
    </div>
  )
}
