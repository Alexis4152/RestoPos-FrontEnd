import { useEffect, useMemo, useState } from 'react'
import { getReservaciones, getReservacionesPendientes, createReservacion, confirmReservacion, rejectReservacion,
  cancelReservacion, markReservacionLlegada } from '../api/reservaciones'
import { getTables } from '../api/mesas'
import { getZonas } from '../api/zonas'
import { useNotify } from '../context/NotifyContext'
import { useLiveRefresh } from '../utils/liveEvents'
import { useEscapeKey } from '../hooks/useEscapeKey'
import NecesidadesEspeciales from '../components/NecesidadesEspeciales'
import { ESTADO_RESERVA, necesidades, fechaLarga, horaCorta, ymd, sumarDias } from '../utils/reservaciones'

/**
 * Reservaciones de mesa (sección Mesas): bandeja de las que llegaron de la página web y están
 * por confirmar, y la agenda del día. Al confirmar se asigna mesa (avisando si es chica o ya
 * está reservada a esa hora); el día de la visita se marca si llegaron. Las necesidades
 * especiales (periqueras, mesa accesible, carriola, ocasión) se ven destacadas para preparar la
 * mesa antes. También se capturan aquí las reservaciones que llegan por teléfono.
 */
export default function Reservaciones() {
  const { notify } = useNotify()
  const [fecha, setFecha] = useState(ymd())
  const [delDia, setDelDia] = useState([])
  const [pendientes, setPendientes] = useState([])
  const [mesas, setMesas] = useState([])
  const [zonas, setZonas] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [asignando, setAsignando] = useState(null) // reservación a confirmar / cambiar mesa
  const [conMotivo, setConMotivo] = useState(null) // { r, accion: 'rechazar' | 'cancelar' }
  const [nueva, setNueva] = useState(false)

  function load() {
    getReservaciones(fecha).then((r) => setDelDia(r.data.data ?? [])).catch(() => {})
    getReservacionesPendientes().then((r) => setPendientes(r.data.data ?? [])).catch(() => {})
  }
  useEffect(() => { load() }, [fecha])
  useEffect(() => {
    getTables().then((r) => setMesas(r.data.data ?? [])).catch(() => {})
    getZonas().then((r) => setZonas(r.data.data ?? [])).catch(() => {})
  }, [])
  useLiveRefresh(load, { filtro: (e) => e.name === 'reservacion' })

  async function accion(r, fn, ok) {
    setBusyId(r.id)
    try {
      await fn()
      if (ok) notify(ok, 'success')
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo completar la acción', 'error')
    } finally { setBusyId(null) }
  }

  const activas = delDia.filter((r) => ['PENDIENTE', 'CONFIRMADA', 'LLEGO'].includes(r.estado))
  const resumen = {
    reservas: activas.length,
    personas: activas.reduce((s, r) => s + r.personas, 0),
    periqueras: activas.reduce((s, r) => s + r.periqueras, 0),
    accesibles: activas.filter((r) => r.accesible).length,
  }
  const esHoy = fecha === ymd()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reservaciones</h1>
          <p className="text-sm text-gray-500">Las de la página web llegan "por confirmar". Las que capturas aquí quedan confirmadas.</p>
        </div>
        <button className="btn-primary" onClick={() => setNueva(true)}>+ Nueva reservación</button>
      </div>

      {pendientes.length > 0 && (
        <section className="card border-2 border-yellow-300 bg-yellow-50/60">
          <h2 className="font-bold text-yellow-900 mb-3">⏳ Por confirmar ({pendientes.length})</h2>
          <div className="space-y-3">
            {pendientes.map((r) => (
              <TarjetaStaff key={r.id} r={r} conFecha busy={busyId === r.id}
                onConfirmar={() => setAsignando(r)}
                onRechazar={() => setConMotivo({ r, accion: 'rechazar' })} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button className="btn-secondary !px-3" aria-label="Día anterior" onClick={() => setFecha(sumarDias(fecha, -1))}>‹</button>
          <input type="date" className="input !w-auto" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
          <button className="btn-secondary !px-3" aria-label="Día siguiente" onClick={() => setFecha(sumarDias(fecha, 1))}>›</button>
          {!esHoy && <button className="btn-secondary" onClick={() => setFecha(ymd())}>Hoy</button>}
          <p className="font-semibold text-gray-800 capitalize ml-1">{esHoy ? 'Hoy, ' : ''}{fechaLarga(`${fecha}T12:00:00`)}</p>
        </div>
        {resumen.reservas > 0 && (
          <div className="flex flex-wrap gap-2 mb-4 text-sm">
            <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-800 font-semibold">📅 {resumen.reservas} reservación{resumen.reservas === 1 ? '' : 'es'}</span>
            <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-800 font-semibold">👥 {resumen.personas} personas</span>
            {resumen.periqueras > 0 && <span className="px-3 py-1 rounded-full bg-orange-100 text-orange-800 font-semibold">🪑 {resumen.periqueras} periquera{resumen.periqueras === 1 ? '' : 's'}</span>}
            {resumen.accesibles > 0 && <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 font-semibold">♿ {resumen.accesibles} mesa{resumen.accesibles === 1 ? '' : 's'} accesible{resumen.accesibles === 1 ? '' : 's'}</span>}
          </div>
        )}
        {delDia.length === 0 && <p className="text-gray-400 text-center py-10">Sin reservaciones este día.</p>}
        <div className="space-y-3">
          {delDia.map((r) => (
            <TarjetaStaff key={r.id} r={r} busy={busyId === r.id}
              onConfirmar={() => setAsignando(r)}
              onRechazar={() => setConMotivo({ r, accion: 'rechazar' })}
              onCancelar={() => setConMotivo({ r, accion: 'cancelar' })}
              onLlego={(llego) => accion(r, () => markReservacionLlegada(r.id, llego), llego ? `${r.nombre} llegó` : null)} />
          ))}
        </div>
      </section>

      {asignando && (
        <ModalMesa r={asignando} mesas={mesas} onClose={() => setAsignando(null)}
          onGuardar={async (mesaId) => {
            const r = asignando
            setAsignando(null)
            await accion(r, () => confirmReservacion(r.id, mesaId), r.estado === 'PENDIENTE' ? 'Reservación confirmada' : 'Mesa actualizada')
          }} />
      )}
      {conMotivo && (
        <ModalMotivo {...conMotivo} onClose={() => setConMotivo(null)}
          onGuardar={async (motivo) => {
            const { r, accion: a } = conMotivo
            setConMotivo(null)
            await accion(r, () => (a === 'rechazar' ? rejectReservacion(r.id, motivo) : cancelReservacion(r.id, motivo)),
              a === 'rechazar' ? 'Reservación rechazada' : 'Reservación cancelada')
          }} />
      )}
      {nueva && (
        <ModalNueva mesas={mesas} zonas={zonas} fechaInicial={fecha} onClose={() => setNueva(false)}
          onCreada={(r) => { setNueva(false); setFecha(r.fechaHora.slice(0, 10)); load() }} />
      )}
    </div>
  )
}

function TarjetaStaff({ r, conFecha, busy, onConfirmar, onRechazar, onCancelar, onLlego }) {
  const est = ESTADO_RESERVA[r.estado] ?? { staff: r.estado, cls: '' }
  const chips = necesidades(r)
  const inactiva = ['RECHAZADA', 'CANCELADA', 'NO_LLEGO'].includes(r.estado)
  const chica = r.mesaCapacidad && r.mesaCapacidad < r.personas
  return (
    <article className={`card !p-4 flex flex-col sm:flex-row gap-4 ${inactiva ? 'opacity-60' : ''}`}>
      <div className="sm:w-28 shrink-0">
        <p className="text-2xl font-extrabold text-gray-900">{horaCorta(r.fechaHora)}</p>
        {conFecha && <p className="text-xs text-gray-500 capitalize">{fechaLarga(r.fechaHora)}</p>}
        <span className={`inline-block mt-1 px-2 py-0.5 rounded-md border text-xs font-semibold ${est.cls}`}>{est.staff}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-gray-900">
          {r.nombre} <span className="font-normal text-gray-600">· 👥 {r.personas}</span>
          {r.clienteRegistrado && <span className="ml-2 text-xs font-medium text-purple-700">⭐ Cliente registrado</span>}
          {r.origen === 'PERSONAL' && <span className="ml-2 text-xs font-medium text-gray-500">📞 Capturada por {r.atendidaPor ?? 'el personal'}</span>}
        </p>
        <p className="text-sm text-gray-600">
          <a href={`tel:${r.telefono}`} className="hover:underline">📞 {r.telefono}</a>
          {r.email && <span className="ml-3">✉️ {r.email}</span>}
        </p>
        <p className="text-sm mt-1">
          {r.mesa
            ? <span className={`font-semibold ${chica ? 'text-orange-700' : 'text-gray-800'}`}>🍽️ Mesa {r.mesa}{r.mesaCapacidad ? ` (${r.mesaCapacidad} lugares)` : ''}{chica ? ' — chica para el grupo' : ''}</span>
            : <span className="text-gray-500">Sin mesa asignada</span>}
          {r.zona && <span className="text-gray-600"> · prefiere {r.zona}</span>}
        </p>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {chips.map((c) => (
              <span key={c.corto} className="px-2 py-1 rounded-md bg-orange-50 border border-orange-200 text-orange-900 text-sm font-semibold">{c.icono} {c.corto}</span>
            ))}
          </div>
        )}
        {r.notas && <p className="text-sm text-gray-700 mt-2 bg-gray-50 rounded-md px-2 py-1">📝 {r.notas}</p>}
        {r.motivo && inactiva && <p className="text-xs text-red-700 mt-1">{r.motivo}</p>}
      </div>
      <div className="flex sm:flex-col flex-wrap gap-2 sm:w-40 shrink-0">
        {r.estado === 'PENDIENTE' && (
          <>
            <button disabled={busy} onClick={onConfirmar} className="btn-primary text-sm">✓ Confirmar</button>
            <button disabled={busy} onClick={onRechazar} className="btn-secondary text-sm text-red-600">Rechazar</button>
          </>
        )}
        {r.estado === 'CONFIRMADA' && onLlego && (
          <>
            <button disabled={busy} onClick={() => onLlego(true)} className="btn-primary text-sm">✓ Llegó</button>
            <button disabled={busy} onClick={onConfirmar} className="btn-secondary text-sm">{r.mesa ? 'Cambiar mesa' : 'Asignar mesa'}</button>
            <button disabled={busy} onClick={() => onLlego(false)} className="btn-secondary text-sm">No llegó</button>
            <button disabled={busy} onClick={onCancelar} className="btn-secondary text-sm text-red-600">Cancelar</button>
          </>
        )}
        {(r.estado === 'LLEGO' || r.estado === 'NO_LLEGO') && onLlego && (
          <button disabled={busy} onClick={() => onLlego(r.estado !== 'LLEGO')} className="text-xs text-gray-500 hover:underline text-left">
            Corregir: marcar {r.estado === 'LLEGO' ? '"no llegó"' : '"llegó"'}
          </button>
        )}
      </div>
    </article>
  )
}

/** Mesas agrupadas por zona para elegir, con la preferida del cliente primero. */
function opcionesMesa(mesas, r) {
  const porZona = new Map()
  mesas.filter((m) => m.estado !== 'FUERA_DE_SERVICIO').forEach((m) => {
    const z = m.zona?.nombre ?? 'Sin zona'
    if (!porZona.has(z)) porZona.set(z, { zonaId: m.zona?.id, mesas: [] })
    porZona.get(z).mesas.push(m)
  })
  return [...porZona.entries()].sort(([, a], [, b]) => (b.zonaId === r.zonaId) - (a.zonaId === r.zonaId))
}

function ModalMesa({ r, mesas, onClose, onGuardar }) {
  const [mesaId, setMesaId] = useState(r.mesaId ? String(r.mesaId) : '')
  useEscapeKey(onClose, true)
  const grupos = useMemo(() => opcionesMesa(mesas, r), [mesas, r])
  const elegida = mesas.find((m) => String(m.id) === mesaId)
  const chips = necesidades(r)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{r.estado === 'PENDIENTE' ? 'Confirmar reservación' : 'Mesa de la reservación'}</h3>
        <p className="text-sm text-gray-600 mt-1 capitalize">{fechaLarga(r.fechaHora)} · {horaCorta(r.fechaHora)} · {r.nombre} · 👥 {r.personas}</p>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {chips.map((c) => <span key={c.corto} className="px-2 py-0.5 rounded-md bg-orange-50 border border-orange-200 text-orange-900 text-xs font-semibold">{c.icono} {c.corto}</span>)}
          </div>
        )}
        <label className="block text-sm font-medium text-gray-700 mt-4 mb-1">Mesa</label>
        <select className="input" value={mesaId} onChange={(e) => setMesaId(e.target.value)}>
          <option value="">Sin mesa por ahora (se asigna al llegar)</option>
          {grupos.map(([zona, g]) => (
            <optgroup key={zona} label={`${zona}${g.zonaId && g.zonaId === r.zonaId ? ' ★ preferida' : ''}`}>
              {g.mesas.map((m) => (
                <option key={m.id} value={m.id}>
                  Mesa {m.numero}{m.capacidad ? ` · ${m.capacidad} lugares` : ''}{m.capacidad && m.capacidad < r.personas ? ' (chica)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {elegida?.capacidad && elegida.capacidad < r.personas && (
          <p className="text-xs text-orange-700 mt-1">Esta mesa es para {elegida.capacidad}; el grupo es de {r.personas}.</p>
        )}
        {r.accesible && <p className="text-xs text-blue-700 mt-1">♿ Elige una mesa accesible, sin escalones y con espacio para silla de ruedas.</p>}
        <p className="text-xs text-gray-400 mt-2">Si la mesa ya está reservada a una hora cercana, se te avisará.</p>
        <div className="flex gap-2 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
          <button className="btn-primary flex-1" onClick={() => onGuardar(mesaId ? Number(mesaId) : null)}>
            {r.estado === 'PENDIENTE' ? 'Confirmar' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalMotivo({ r, accion, onClose, onGuardar }) {
  const [motivo, setMotivo] = useState(accion === 'rechazar' ? 'No tenemos lugar disponible en ese horario' : '')
  useEscapeKey(onClose, true)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{accion === 'rechazar' ? 'Rechazar reservación' : 'Cancelar reservación'}</h3>
        <p className="text-sm text-gray-600 mt-1 capitalize">{fechaLarga(r.fechaHora)} · {horaCorta(r.fechaHora)} · {r.nombre}</p>
        <label className="block text-sm font-medium text-gray-700 mt-4 mb-1">Motivo (el cliente lo verá)</label>
        <textarea className="input" rows={3} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <div className="flex gap-2 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Volver</button>
          <button className="btn-primary flex-1 !bg-red-600 hover:!bg-red-700" onClick={() => onGuardar(motivo.trim())}>
            {accion === 'rechazar' ? 'Rechazar' : 'Cancelar reservación'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalNueva({ mesas, zonas, fechaInicial, onClose, onCreada }) {
  const { notify } = useNotify()
  const [form, setForm] = useState({
    nombre: '', telefono: '', email: '', fecha: fechaInicial < ymd() ? ymd() : fechaInicial, hora: '20:00', personas: 2,
    zonaId: '', mesaId: '', periqueras: 0, accesible: false, carriola: false, ocasion: '', notas: '',
  })
  const [saving, setSaving] = useState(false)
  useEscapeKey(onClose, true)
  const set = (c) => setForm((f) => ({ ...f, ...c }))
  const grupos = useMemo(() => opcionesMesa(mesas, { zonaId: form.zonaId ? Number(form.zonaId) : null, personas: form.personas }), [mesas, form.zonaId, form.personas])

  async function guardar(e) {
    e.preventDefault()
    if (!form.nombre.trim() || !form.telefono.trim() || !form.fecha || !form.hora) {
      notify('Captura nombre, teléfono, día y hora', 'error')
      return
    }
    setSaving(true)
    try {
      const r = await createReservacion({
        nombre: form.nombre.trim(), telefono: form.telefono.trim(), email: form.email.trim() || null,
        fechaHora: `${form.fecha}T${form.hora}:00`, personas: Number(form.personas),
        zonaId: form.zonaId ? Number(form.zonaId) : null, mesaId: form.mesaId ? Number(form.mesaId) : null,
        periqueras: Math.min(form.periqueras, form.personas), accesible: form.accesible, carriola: form.carriola,
        ocasion: form.ocasion || null, notas: form.notas.trim() || null,
      })
      notify('Reservación registrada', 'success')
      onCreada(r.data.data)
    } catch (err) {
      const data = err.response?.data?.data
      notify(data && typeof data === 'object' ? Object.values(data).join(' · ') : (err.response?.data?.message ?? 'No se pudo guardar'), 'error')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <form onSubmit={guardar} className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">Nueva reservación</h3>
        <p className="text-sm text-gray-500">Para clientes que llaman o vienen a reservar. Queda confirmada.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <label className="block"><span className="block text-sm font-medium text-gray-700 mb-1">Nombre *</span>
            <input className="input" maxLength={120} value={form.nombre} onChange={(e) => set({ nombre: e.target.value })} /></label>
          <label className="block"><span className="block text-sm font-medium text-gray-700 mb-1">Teléfono *</span>
            <input className="input" type="tel" maxLength={30} value={form.telefono} onChange={(e) => set({ telefono: e.target.value })} /></label>
          <label className="block"><span className="block text-sm font-medium text-gray-700 mb-1">Día *</span>
            <input className="input" type="date" min={ymd()} value={form.fecha} onChange={(e) => set({ fecha: e.target.value })} /></label>
          <label className="block"><span className="block text-sm font-medium text-gray-700 mb-1">Hora *</span>
            <input className="input" type="time" step={900} value={form.hora} onChange={(e) => set({ hora: e.target.value })} /></label>
          <label className="block"><span className="block text-sm font-medium text-gray-700 mb-1">Personas *</span>
            <input className="input" type="number" min={1} max={100} value={form.personas}
              onChange={(e) => set({ personas: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} /></label>
          <label className="block"><span className="block text-sm font-medium text-gray-700 mb-1">Correo (opcional)</span>
            <input className="input" type="email" maxLength={150} value={form.email} onChange={(e) => set({ email: e.target.value })} /></label>
          <label className="block"><span className="block text-sm font-medium text-gray-700 mb-1">Zona preferida</span>
            <select className="input" value={form.zonaId} onChange={(e) => set({ zonaId: e.target.value })}>
              <option value="">Sin preferencia</option>
              {zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
            </select></label>
          <label className="block"><span className="block text-sm font-medium text-gray-700 mb-1">Mesa</span>
            <select className="input" value={form.mesaId} onChange={(e) => set({ mesaId: e.target.value })}>
              <option value="">Asignar después</option>
              {grupos.map(([zona, g]) => (
                <optgroup key={zona} label={zona}>
                  {g.mesas.map((m) => <option key={m.id} value={m.id}>Mesa {m.numero}{m.capacidad ? ` · ${m.capacidad} lugares` : ''}</option>)}
                </optgroup>
              ))}
            </select></label>
        </div>
        <p className="font-semibold text-gray-800 mt-5 mb-2">Necesidades especiales</p>
        <NecesidadesEspeciales value={form} personas={form.personas} onChange={set} />
        <div className="flex gap-2 mt-6">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
          <button className="btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Guardar reservación'}</button>
        </div>
      </form>
    </div>
  )
}
