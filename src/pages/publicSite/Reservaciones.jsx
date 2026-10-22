import { useEffect, useMemo, useState } from 'react'
import { getReservaOpciones, crearReservacion, getReservacion, cancelarReservacion, getMisReservaciones,
  modificarReservacion, avisarRetrasoReservacion, cancelarPreordenReservacion } from '../../api/publicSite'
import NecesidadesEspeciales from '../../components/NecesidadesEspeciales'
import { usePublicLiveRefresh, publicStreamBase } from '../../utils/liveEvents'
import { ESTADO_RESERVA, necesidades, fechaLarga, horaCorta, ymd, sumarDias, horariosDelDia } from '../../utils/reservaciones'

/** Códigos de las reservaciones hechas en este navegador (invitado o con cuenta). */
export const reservasKey = (slug) => `restopos_web_${slug}_reservaciones`
export function leerCodigosReserva(slug) {
  try {
    const v = JSON.parse(localStorage.getItem(reservasKey(slug)) || '[]')
    return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : []
  } catch { return [] }
}
export function guardarCodigosReserva(slug, codigos) {
  try { localStorage.setItem(reservasKey(slug), JSON.stringify([...new Set(codigos)].slice(-20))) } catch { /* sin storage */ }
}

const ACTIVAS = ['PENDIENTE', 'CONFIRMADA']
const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const fechaHoraCorta = (iso) => new Date(iso).toLocaleString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const inputCls = 'w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300'

/**
 * Pestaña "Reservar" de la página web: formulario de reservación (fecha, hora, personas, zona
 * preferida y necesidades especiales: periqueras, mesa accesible, carriola, ocasión) y la lista
 * de "Mis reservaciones" con su estado. La reservación llega al restaurante como "por
 * confirmar"; el cliente ve aquí cuando la confirman (o rechazan) y puede cancelarla.
 *
 * Un invitado sigue sus reservaciones por el código guardado en este navegador; un cliente
 * registrado las ve desde su cuenta (en cualquier dispositivo).
 */
export default function Reservaciones({ slug, tienda, cliente, clienteToken, onSesionVencida, onOrdenar }) {
  const [opciones, setOpciones] = useState(null)
  const [error, setError] = useState('')
  const [codigos, setCodigos] = useState(() => leerCodigosReserva(slug))
  const [porCodigo, setPorCodigo] = useState({}) // { token: reservación }
  const [deCuenta, setDeCuenta] = useState([])
  const [recienCreada, setRecienCreada] = useState(null)
  const [editando, setEditando] = useState(null) // reservación cuyos datos (personas/necesidades) se cambian

  useEffect(() => {
    getReservaOpciones(slug).then((r) => setOpciones(r.data.data))
      .catch((err) => setError(err.response?.data?.message ?? 'Las reservaciones no están disponibles por ahora'))
  }, [slug])

  function cargar() {
    codigos.forEach((t) => {
      getReservacion(slug, t)
        .then((r) => setPorCodigo((m) => ({ ...m, [t]: r.data.data })))
        .catch((err) => {
          // Código que el servidor ya no reconoce: se olvida.
          if (err.response?.status === 400) setCodigos((list) => list.filter((x) => x !== t))
        })
    })
    if (cliente && clienteToken) {
      getMisReservaciones(slug, clienteToken).then((r) => setDeCuenta(r.data.data ?? []))
        .catch((err) => { if (err.response?.status === 401) onSesionVencida?.() })
    }
  }
  useEffect(() => { guardarCodigosReserva(slug, codigos) }, [slug, codigos])
  useEffect(() => { cargar() }, [slug, codigos.join(','), cliente?.id])

  // Con cuenta: aviso en tiempo real cuando el restaurante confirma/rechaza. Invitado: se
  // consulta cada 30 s mientras tenga alguna por confirmar.
  usePublicLiveRefresh(cliente && clienteToken ? `${publicStreamBase(slug)}/clientes/me/eventos` : null, cargar,
    { headers: { 'X-Cliente-Token': clienteToken }, alFallarAuth: onSesionVencida })
  const lista = useMemo(() => {
    const m = new Map()
    deCuenta.forEach((r) => m.set(r.token, r))
    Object.values(porCodigo).forEach((r) => { if (codigos.includes(r.token)) m.set(r.token, r) })
    return [...m.values()].sort((a, b) => {
      const aAct = ACTIVAS.includes(a.estado), bAct = ACTIVAS.includes(b.estado)
      if (aAct !== bAct) return aAct ? -1 : 1
      return aAct ? a.fechaHora.localeCompare(b.fechaHora) : b.fechaHora.localeCompare(a.fechaHora)
    })
  }, [deCuenta, porCodigo, codigos])
  const hayPendientes = lista.some((r) => r.estado === 'PENDIENTE')
  useEffect(() => {
    if (!hayPendientes) return
    const t = setInterval(cargar, 30000)
    return () => clearInterval(t)
  }, [hayPendientes, codigos.join(',')])

  // Reemplaza la reservación actualizada en las dos listas (por código y de la cuenta).
  function actualizada(nueva) {
    setPorCodigo((m) => (m[nueva.token] ? { ...m, [nueva.token]: nueva } : m))
    setDeCuenta((list) => list.map((x) => (x.token === nueva.token ? nueva : x)))
  }
  async function retraso(r, minutos) {
    try { actualizada((await avisarRetrasoReservacion(slug, r.token, minutos)).data.data) }
    catch (err) { window.alert(err.response?.data?.message ?? 'No se pudo avisar') }
  }
  async function cancelarPedido(r) {
    if (!window.confirm('¿Cancelar tu pedido anticipado? Tu reservación sigue en pie.')) return
    try { actualizada((await cancelarPreordenReservacion(slug, r.token)).data.data) }
    catch (err) { window.alert(err.response?.data?.message ?? 'No se pudo cancelar el pedido') }
  }

  async function cancelar(r) {
    if (!window.confirm(`¿Cancelar tu reservación del ${fechaLarga(r.fechaHora)} a las ${horaCorta(r.fechaHora)}?`)) return
    try {
      const res = await cancelarReservacion(slug, r.token)
      setPorCodigo((m) => ({ ...m, [r.token]: res.data.data }))
      setDeCuenta((list) => list.map((x) => (x.token === r.token ? res.data.data : x)))
    } catch (err) {
      window.alert(err.response?.data?.message ?? 'No se pudo cancelar la reservación')
    }
  }

  if (error) {
    return <p className="text-center text-gray-500 py-16">{error}{tienda.telefono ? ` Llámanos al ${tienda.telefono}.` : ''}</p>
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
      <div className="lg:col-span-3">
        <h2 className="text-2xl font-bold">Reserva tu mesa</h2>
        <p className="text-sm text-gray-500 mt-1">
          Te avisamos aquí{cliente ? ' y por correo' : ''} cuando el restaurante confirme tu reservación.
        </p>
        {recienCreada && (
          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-start gap-3">
            <p className="flex-1">✅ ¡Recibimos tu reservación! Está <b>por confirmar</b>; la puedes ver en "Mis reservaciones".</p>
            <button type="button" onClick={() => setRecienCreada(null)} className="opacity-60 hover:opacity-100">✕</button>
          </div>
        )}
        {!opciones ? (
          <p className="text-gray-400 py-10">Cargando...</p>
        ) : (
          <FormularioReserva key={recienCreada ?? 'nueva'} slug={slug} tienda={tienda} opciones={opciones}
            cliente={cliente} clienteToken={clienteToken} onSesionVencida={onSesionVencida}
            onCreada={(c) => {
              setCodigos((list) => [...list.filter((x) => x !== c.token), c.token])
              setRecienCreada(c.token)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }} />
        )}
      </div>

      <div className="lg:col-span-2">
        <h2 className="text-xl font-bold">Mis reservaciones</h2>
        {lista.length === 0 && <p className="text-sm text-gray-400 mt-3">Aún no tienes reservaciones.</p>}
        <div className="mt-3 space-y-3">
          {lista.map((r) => (
            <TarjetaReserva key={r.token} r={r} tienda={tienda} destacada={r.token === recienCreada}
              onCancelar={() => cancelar(r)}
              onCambiar={() => setEditando(r)}
              onRetraso={(min) => retraso(r, min)}
              onOrdenar={onOrdenar ? () => onOrdenar(r) : null}
              onCancelarPedido={() => cancelarPedido(r)}
              onQuitar={!ACTIVAS.includes(r.estado) && codigos.includes(r.token) && !deCuenta.some((x) => x.token === r.token)
                ? () => setCodigos((list) => list.filter((x) => x !== r.token)) : null} />
          ))}
        </div>
      </div>
      {editando && opciones && (
        <ModalCambios slug={slug} r={editando} maxPersonas={opciones.maxPersonas} onClose={() => setEditando(null)}
          onGuardada={(nueva) => { actualizada(nueva); setEditando(null) }} />
      )}
    </div>
  )
}

/** Cambiar personas o necesidades especiales (no la fecha ni la hora: para eso, cancelar y reservar otra). */
function ModalCambios({ slug, r, maxPersonas, onClose, onGuardada }) {
  const [form, setForm] = useState({
    personas: r.personas, periqueras: r.periqueras, accesible: r.accesible, carriola: r.carriola,
    ocasion: r.ocasion ?? '', notas: r.notas ?? '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (c) => setForm((f) => ({ ...f, ...c }))
  async function guardar(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await modificarReservacion(slug, r.token, {
        personas: form.personas, periqueras: Math.min(form.periqueras, form.personas), accesible: form.accesible,
        carriola: form.carriola, ocasion: form.ocasion || null, notas: form.notas.trim() || null,
      })
      onGuardada(res.data.data)
    } catch (err) {
      setError(err.response?.data?.message ?? 'No se pudo guardar el cambio')
    } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={guardar} className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-lg font-bold">Cambiar mi reservación</h3>
          <p className="text-sm text-gray-500 capitalize">{fechaLarga(r.fechaHora)} · {horaCorta(r.fechaHora)}</p>
        </div>
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-1">Personas</span>
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Menos personas" disabled={form.personas <= 1} onClick={() => set({ personas: form.personas - 1 })}
              className="w-10 h-10 rounded-full border border-gray-300 text-xl leading-none hover:bg-gray-50 disabled:opacity-30">−</button>
            <span className="w-10 text-center text-xl font-bold">{form.personas}</span>
            <button type="button" aria-label="Más personas" disabled={form.personas >= maxPersonas} onClick={() => set({ personas: form.personas + 1 })}
              className="w-10 h-10 rounded-full border border-gray-300 text-xl leading-none hover:bg-gray-50 disabled:opacity-30">+</button>
          </div>
          {r.estado === 'CONFIRMADA' && form.personas > r.personas && (
            <p className="text-xs text-gray-500 mt-1">Si tu mesa ya no alcanza, el restaurante volverá a confirmarte con otra.</p>
          )}
        </div>
        <NecesidadesEspeciales value={form} personas={form.personas} onChange={set} />
        {error && <p className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-full border border-gray-300 py-2.5 font-semibold hover:bg-gray-50">Volver</button>
          <button disabled={saving} className="flex-1 rounded-full bg-purple-600 text-white py-2.5 font-semibold hover:bg-purple-700 disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  )
}

function FormularioReserva({ slug, tienda, opciones, cliente, clienteToken, onSesionVencida, onCreada }) {
  const hoy = ymd()
  const ultimoDia = sumarDias(hoy, opciones.diasMax)
  // Primer día con algún horario disponible (hoy puede ya no tener por la anticipación).
  const primerDia = useMemo(() => {
    for (let i = 0; i <= Math.min(opciones.diasMax, 7); i++) {
      const d = sumarDias(hoy, i)
      if (horariosDelDia(d, opciones).length > 0) return d
    }
    return hoy
  }, [opciones])

  const [form, setForm] = useState(() => ({
    fecha: primerDia, hora: '', personas: 2, zonaId: '',
    nombre: cliente?.nombre ?? '', telefono: cliente?.telefono ?? '', email: cliente?.email ?? '',
    periqueras: 0, accesible: false, carriola: false, ocasion: '', notas: '',
  }))
  const [errors, setErrors] = useState({})
  const [sending, setSending] = useState(false)
  const [serverError, setServerError] = useState('')
  const set = (cambios) => setForm((f) => ({ ...f, ...cambios }))

  const horarios = useMemo(() => horariosDelDia(form.fecha, opciones), [form.fecha, opciones])
  // Si la hora elegida ya no existe para el nuevo día, se limpia.
  useEffect(() => { if (form.hora && !horarios.includes(form.hora)) set({ hora: '' }) }, [horarios])

  async function enviar(e) {
    e.preventDefault()
    const errs = {}
    if (!form.fecha) errs.fecha = 'Elige el día'
    if (!form.hora) errs.hora = 'Elige la hora'
    if (!form.nombre.trim()) errs.nombre = 'Escribe tu nombre'
    if (!form.telefono.trim()) errs.telefono = 'Escribe tu teléfono'
    else if (form.telefono.replace(/\D/g, '').length < 8) errs.telefono = 'Revisa tu teléfono'
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = 'Revisa tu correo'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSending(true)
    setServerError('')
    try {
      const r = await crearReservacion(slug, {
        nombre: form.nombre.trim(), telefono: form.telefono.trim(), email: form.email.trim() || null,
        fechaHora: `${form.fecha}T${form.hora}:00`, personas: form.personas,
        zonaId: form.zonaId ? Number(form.zonaId) : null,
        periqueras: Math.min(form.periqueras, form.personas), accesible: form.accesible, carriola: form.carriola,
        ocasion: form.ocasion || null, notas: form.notas.trim() || null,
      }, clienteToken)
      onCreada(r.data.data)
    } catch (err) {
      if (err.response?.status === 401) { onSesionVencida?.(); return }
      const data = err.response?.data?.data
      setServerError(data && typeof data === 'object' ? Object.values(data).join(' · ') : (err.response?.data?.message ?? 'No se pudo enviar tu reservación'))
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={enviar} className="mt-5 space-y-6">
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <p className="font-semibold">¿Cuándo y cuántos?</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Día</span>
            <input type="date" className={inputCls} min={hoy} max={ultimoDia} value={form.fecha}
              onChange={(e) => set({ fecha: e.target.value })} />
            {form.fecha && <span className="block text-xs text-gray-500 mt-1 capitalize">{fechaLarga(`${form.fecha}T12:00:00`)}</span>}
            {errors.fecha && <span className="text-xs text-red-600">{errors.fecha}</span>}
          </label>
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1">Personas</span>
            <div className="flex items-center gap-3">
              <button type="button" aria-label="Menos personas" disabled={form.personas <= 1}
                onClick={() => set({ personas: form.personas - 1 })}
                className="w-10 h-10 rounded-full border border-gray-300 text-xl leading-none hover:bg-gray-50 disabled:opacity-30">−</button>
              <span className="w-10 text-center text-xl font-bold">{form.personas}</span>
              <button type="button" aria-label="Más personas" disabled={form.personas >= opciones.maxPersonas}
                onClick={() => set({ personas: form.personas + 1 })}
                className="w-10 h-10 rounded-full border border-gray-300 text-xl leading-none hover:bg-gray-50 disabled:opacity-30">+</button>
            </div>
            <span className="block text-xs text-gray-500 mt-1">
              ¿Más de {opciones.maxPersonas}? {tienda.telefono ? `Llámanos al ${tienda.telefono}.` : 'Llámanos.'}
            </span>
          </div>
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-700 mb-1.5">Hora</span>
          {horarios.length === 0 ? (
            <p className="text-sm text-gray-500">Ya no hay horarios disponibles ese día; elige otro.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {horarios.map((h) => (
                <button key={h} type="button" onClick={() => set({ hora: h })}
                  className={`px-3 py-1.5 rounded-full text-sm border font-medium ${form.hora === h ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'}`}>
                  {h}
                </button>
              ))}
            </div>
          )}
          {errors.hora && <span className="text-xs text-red-600">{errors.hora}</span>}
        </div>

        {opciones.zonas.length > 1 && (
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Zona preferida</span>
            <select className={inputCls} value={form.zonaId} onChange={(e) => set({ zonaId: e.target.value })}>
              <option value="">Sin preferencia</option>
              {opciones.zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
            </select>
            <span className="block text-xs text-gray-500 mt-1">Haremos lo posible por sentarte ahí.</span>
          </label>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="font-semibold">Necesidades especiales</p>
        <p className="text-xs text-gray-500 mb-3">Cuéntanos para tener todo listo cuando llegues.</p>
        <NecesidadesEspeciales value={form} personas={form.personas} onChange={set} />
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <p className="font-semibold">Tus datos</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Nombre *</span>
            <input className={inputCls} maxLength={120} value={form.nombre} onChange={(e) => set({ nombre: e.target.value })} autoComplete="name" />
            {errors.nombre && <span className="text-xs text-red-600">{errors.nombre}</span>}
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Teléfono *</span>
            <input className={inputCls} type="tel" maxLength={30} value={form.telefono} onChange={(e) => set({ telefono: e.target.value })} autoComplete="tel" />
            {errors.telefono && <span className="text-xs text-red-600">{errors.telefono}</span>}
          </label>
          <label className="block sm:col-span-2">
            <span className="block text-sm font-medium text-gray-700 mb-1">Correo (opcional)</span>
            <input className={inputCls} type="email" maxLength={150} value={form.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" />
            <span className="block text-xs text-gray-500 mt-1">Para avisarte por correo cuando confirmemos tu reservación.</span>
            {errors.email && <span className="text-xs text-red-600">{errors.email}</span>}
          </label>
        </div>
      </section>

      {serverError && <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{serverError}</p>}

      <button disabled={sending || horarios.length === 0}
        className="w-full rounded-full bg-purple-600 text-white py-3.5 font-semibold hover:bg-purple-700 disabled:opacity-50">
        {sending ? 'Enviando...' : `Reservar para ${form.personas} ${form.personas === 1 ? 'persona' : 'personas'}${form.hora ? ` a las ${form.hora}` : ''}`}
      </button>
    </form>
  )
}

function TarjetaReserva({ r, tienda, destacada, onCancelar, onQuitar, onCambiar, onRetraso, onOrdenar, onCancelarPedido }) {
  const est = ESTADO_RESERVA[r.estado] ?? { cliente: r.estado, cls: 'bg-gray-100 text-gray-600 border-gray-300' }
  const chips = necesidades(r)
  const [eligiendoRetraso, setEligiendoRetraso] = useState(false)
  const activa = ACTIVAS.includes(r.estado)
  const horaConRetraso = r.retrasoMinutos ? horaCorta(new Date(new Date(r.fechaHora).getTime() + r.retrasoMinutos * 60000).toISOString()) : null
  return (
    <article className={`bg-white rounded-2xl border shadow-sm p-4 ${destacada ? 'border-purple-400 ring-2 ring-purple-200' : 'border-gray-100'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold capitalize">{fechaLarga(r.fechaHora)}</p>
          <p className="text-sm text-gray-600">🕒 {horaCorta(r.fechaHora)} · 👥 {r.personas} {r.personas === 1 ? 'persona' : 'personas'}</p>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-md border text-xs font-semibold ${est.cls}`}>{est.cliente}</span>
      </div>
      {(r.mesa || r.zona) && (
        <p className="text-sm text-gray-700 mt-2">
          {r.mesa ? <>🍽️ Mesa <b>{r.mesa}</b></> : null}
          {r.mesa && r.zona ? ' · ' : ''}
          {r.zona ? `📍 ${r.zona}` : ''}
        </p>
      )}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {chips.map((c) => <span key={c.corto} className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 text-xs">{c.icono} {c.corto}</span>)}
        </div>
      )}
      {r.notas && <p className="text-xs text-gray-500 mt-2 italic">"{r.notas}"</p>}
      {r.estado === 'PENDIENTE' && <p className="text-xs text-gray-500 mt-2">El restaurante revisará tu reservación y te avisará aquí.</p>}
      {r.estado === 'CONFIRMADA' && (
        <p className="text-xs text-green-700 mt-2">¡Te esperamos! Si no podrás venir, cancela aquí o avísanos{tienda.telefono ? ` al ${tienda.telefono}` : ''}.</p>
      )}

      {/* Retraso: "llegaré un poco más tarde", hasta las horas que fijó el restaurante */}
      {activa && r.retrasoMinutos > 0 && (
        <p className="text-sm font-semibold text-amber-800 mt-2">⏰ Avisaste que llegas {r.retrasoMinutos} min tarde (~{horaConRetraso}).</p>
      )}
      {activa && r.puedeAvisarRetraso && (
        eligiendoRetraso ? (
          <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 p-2.5">
            <p className="text-sm font-semibold text-amber-900 mb-1.5">¿Cuánto tiempo más tarde?</p>
            <div className="flex flex-wrap gap-1.5">
              {[15, 30, 45, 60].map((m) => (
                <button key={m} type="button" onClick={() => { onRetraso(m); setEligiendoRetraso(false) }}
                  className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${r.retrasoMinutos === m ? 'bg-amber-600 text-white border-amber-600' : 'bg-white border-amber-300 text-amber-900'}`}>
                  {m} min
                </button>
              ))}
              {r.retrasoMinutos > 0 && (
                <button type="button" onClick={() => { onRetraso(0); setEligiendoRetraso(false) }} className="px-3 py-1.5 rounded-full text-sm font-semibold border border-gray-300 bg-white">
                  Llego a tiempo
                </button>
              )}
              <button type="button" onClick={() => setEligiendoRetraso(false)} className="px-2 text-sm text-gray-500 hover:underline">Cerrar</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setEligiendoRetraso(true)} className="block mt-2 text-sm font-semibold text-amber-800 hover:underline">
            ⏰ {r.retrasoMinutos > 0 ? 'Cambiar mi aviso de retraso' : 'Llegaré un poco más tarde'}
            <span className="block text-xs font-normal text-gray-500">Puedes avisar hasta el {fechaHoraCorta(r.limiteRetraso)}</span>
          </button>
        )
      )}

      {/* Cambios de personas / necesidades */}
      {activa && (r.puedeModificar ? (
        <button type="button" onClick={onCambiar} className="block mt-2 text-sm font-semibold text-purple-700 hover:underline">
          ✏️ Cambiar personas o necesidades
          <span className="block text-xs font-normal text-gray-500">Hasta el {fechaHoraCorta(r.limiteCambios)}</span>
        </button>
      ) : (
        <p className="text-xs text-gray-500 mt-2">Para hacer cambios ahora, llámanos{tienda.telefono ? ` al ${tienda.telefono}` : ''}.</p>
      ))}

      {/* Pedido anticipado: se prepara cuando llegas */}
      {r.preorden && (
        <div className="mt-3 rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm">
          <p className="font-semibold text-blue-900">🍽️ Tu pedido · {fmt(r.preorden.total)}</p>
          <ul className="text-blue-900/80 text-xs mt-1 space-y-0.5">
            {r.preorden.items.map((i, idx) => <li key={idx}>{Number(i.cantidad)}× {i.nombre}</li>)}
          </ul>
          <p className="text-xs text-blue-900 mt-1.5">
            {r.preorden.estado === 'EN_COCINA' ? 'Ya está en cocina.' : 'Lo empezamos a preparar cuando llegues. Lo pagas en el restaurante.'}
          </p>
          {r.preorden.estado === 'EN_ESPERA' && (
            <div className="flex gap-3 mt-2">
              {r.puedeOrdenar && onOrdenar && <button type="button" onClick={onOrdenar} className="text-sm font-semibold text-purple-700 hover:underline">Agregar más</button>}
              <button type="button" onClick={onCancelarPedido} className="text-sm font-semibold text-red-600 hover:underline">Cancelar pedido</button>
            </div>
          )}
        </div>
      )}
      {!r.preorden && r.puedeOrdenar && onOrdenar && (
        <button type="button" onClick={onOrdenar}
          className="mt-3 w-full rounded-full border-2 border-purple-200 text-purple-700 py-2 text-sm font-semibold hover:bg-purple-50">
          🍽️ Ordenar desde ahora
          <span className="block text-xs font-normal text-gray-500">Se manda a cocina cuando llegues</span>
        </button>
      )}
      {r.motivo && ['RECHAZADA', 'CANCELADA'].includes(r.estado) && <p className="text-xs text-red-700 mt-2">{r.motivo}</p>}
      {(r.puedeCancelar || onQuitar) && (
        <div className="flex gap-2 mt-3">
          {r.puedeCancelar && (
            <button type="button" onClick={onCancelar} className="text-sm font-medium text-red-600 hover:underline">Cancelar reservación</button>
          )}
          {onQuitar && <button type="button" onClick={onQuitar} className="text-sm text-gray-500 hover:underline">Quitar de la lista</button>}
        </div>
      )}
    </article>
  )
}
