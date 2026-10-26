import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getTables, createTable, updateTable, deleteTable } from '../api/mesas'
import { getZonas, createZona, updateZona, deleteZona } from '../api/zonas'
import { openOrder, getOrder, getPickups, moveOrderTable, joinOrderTable, splitOrderTable } from '../api/ordenes'
import { getReservaciones } from '../api/reservaciones'
import { horaCorta, necesidades } from '../utils/reservaciones'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { useLiveRefresh } from '../utils/liveEvents'
import { useEscapeKey } from '../hooks/useEscapeKey'
import Icon, { Persona } from '../components/Icon'
import SelectorModoToma from '../components/SelectorModoToma'
import MisMesas from './rapido/MisMesas'
import { useModoToma } from '../utils/modoToma'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))

/**
 * Cada estado se distingue por color Y forma (no solo por color): libre = contorno verde,
 * ocupada = azul sólido, cuenta pedida = ámbar sólido, reservada = contorno punteado morado.
 */
const EST = {
  DISPONIBLE: { label: 'Libre', pill: 'bg-[#E7F3EC] text-[#22603C]', seat: '#2E7D4F', table: 'bg-[#F1F8F4] border-[#9CCBB0]', cell: 'bg-[#E7F3EC] border-[1.5px] border-[#2E7D4F]' },
  OCUPADA: { label: 'Ocupada', pill: 'bg-[#E6EDF8] text-[#1E4585]', seat: '#24519E', table: 'bg-[#E6EDF8] border-[#A9BEE3]', cell: 'bg-[#24519E]' },
  PENDIENTE_PAGO: { label: 'Pidió la cuenta', pill: 'bg-[#FBF0DC] text-[#7A4A00]', seat: '#B86E00', table: 'bg-[#FBF0DC] border-[#E2B76B]', cell: 'bg-[#C77700]' },
  RESERVADA: { label: 'Reservada', pill: 'bg-[#EEEAF8] text-[#4B3391]', seat: '#5B3FA6', table: 'bg-[#F6F3FC] border-dashed border-[#8F7AD0]', cell: 'bg-white border-[1.5px] border-dashed border-[#5B3FA6]' },
  FUERA_DE_SERVICIO: { label: 'Fuera de servicio', pill: 'bg-gray-200 text-gray-700', seat: '#9CA3AF', table: 'bg-gray-100 border-gray-300', cell: 'bg-gray-300' },
}
const est = (e) => EST[e] ?? EST.DISPONIBLE
const RESUMEN = [
  { key: 'DISPONIBLE', label: 'Libres', short: 'libres' },
  { key: 'OCUPADA', label: 'Ocupadas', short: 'ocupadas' },
  { key: 'PENDIENTE_PAGO', label: 'Pidieron la cuenta', short: 'pidieron cuenta' },
  { key: 'RESERVADA', label: 'Reservadas', short: 'reservadas' },
]

const emptyMesaForm = { numero: '', capacidad: '', zonaId: '' }
const porNumero = (a, b) => Number(a.numero) - Number(b.numero) || String(a.numero).localeCompare(String(b.numero))

/** "38 min" / "1 h 05" desde una fecha. */
function transcurrido(desde) {
  if (!desde) return ''
  const min = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60000))
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

/** Lugares de una mesa: capacidad (o lo que haya sentado si no se capturó) y cuántos ocupados. */
function lugares(mesa) {
  const sentados = mesa.unidaA ? 0 : (mesa.ordenActiva?.numeroComensales ?? 0)
  const cap = Math.max(mesa.capacidad || 0, sentados, mesa.capacidad ? 0 : 2)
  return { cap, sentados }
}

/** Dibujo de la mesa: figuras arriba y abajo (rellena = comensal, contorno = libre) y la mesa al centro. */
function MesaDibujo({ mesa, size = 'w-5 h-5' }) {
  const { cap, sentados } = lugares(mesa)
  const e = est(mesa.estado)
  const visibles = Math.min(cap, 12)
  const seats = Array.from({ length: visibles }, (_, i) => i < sentados)
  const arriba = Math.ceil(visibles / 2)
  const redonda = cap <= 2
  const ancho = redonda ? 44 : Math.max(60, arriba * 24 + 8)
  const fila = (lista, off) => (
    <div className="flex gap-1 min-h-5">
      {lista.map((llena, i) => <Persona key={off + i} llena={llena} className={size} color={llena ? e.seat : '#A39E94'} />)}
    </div>
  )
  return (
    <div className="flex flex-col items-center gap-1 py-1">
      {fila(seats.slice(0, arriba), 0)}
      <div className={`flex items-center justify-center font-extrabold text-base border-[1.5px] ${e.table}`}
        style={{ width: ancho, height: redonda ? 44 : 38, borderRadius: redonda ? 22 : 10 }}>
        {mesa.numero}
      </div>
      {fila(seats.slice(arriba), arriba)}
      {cap > 12 && <span className="text-xs text-gray-600">+{cap - 12} lugares</span>}
    </div>
  )
}

/**
 * Mesas en dos niveles:
 *  1. Zonas: resumen por estado, una tarjeta por zona con su mini mapa (un cuadrito por mesa
 *     con el color/forma de su estado) y lugares ocupados, y el panel "Necesita atención"
 *     (cuentas pedidas, platillos listos para llevar, reservaciones próximas).
 *  2. Plano de la zona (?zona=id): cada mesa con sus lugares como figuras; al tocarla, el
 *     panel lateral muestra su detalle y acciones (abrir, ver orden, mover de mesa).
 * La zona vive en la URL para que "atrás" desde una orden regrese al plano correcto.
 */
/** Mesas: "Mis mesas" en modo rápido, el plano por zonas en modo detallado (ver utils/modoToma.js). */
export default function Tables() {
  const { rapido } = useModoToma()
  return rapido ? <MisMesas /> : <TablesDetallado />
}

function TablesDetallado() {
  const { isAdmin } = useAuth()
  const { notify, confirmDialog } = useNotify()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [tables, setTables] = useState([])
  const [zonas, setZonas] = useState([])
  const [reservasHoy, setReservasHoy] = useState([])
  const [pickups, setPickups] = useState([])
  const [, setTick] = useState(0) // refresca los "hace X min"

  const [selId, setSelId] = useState(null)
  const [selOrden, setSelOrden] = useState(null)
  const [comensales, setComensales] = useState(2)
  const [loading, setLoading] = useState(false)
  const [moverDe, setMoverDe] = useState(null) // mesa cuya orden se mueve
  const [unirA, setUnirA] = useState(null) // mesa principal a la que se une otra

  const [showModal, setShowModal] = useState(false)
  const [editTable, setEditTable] = useState(null)
  const [form, setForm] = useState(emptyMesaForm)
  const [fieldErrors, setFieldErrors] = useState({})
  const [showZonaModal, setShowZonaModal] = useState(false)
  const [editZona, setEditZona] = useState(null)
  const [zonaNombre, setZonaNombre] = useState('')
  const [zonaFieldError, setZonaFieldError] = useState('')
  const [zonaLoading, setZonaLoading] = useState(false)

  function load() {
    getTables().then((r) => setTables(r.data.data ?? []))
    getReservaciones().then((r) => setReservasHoy(r.data.data ?? [])).catch(() => setReservasHoy([]))
    // Platillos listos para llevar a la mesa (solo si el usuario puede ver órdenes).
    getPickups().then((r) => setPickups(r.data.data ?? [])).catch(() => setPickups([]))
  }
  function loadZonas() { getZonas().then((r) => setZonas(r.data.data ?? [])) }
  useEffect(() => { load(); loadZonas() }, [])
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t) }, [])
  useLiveRefresh(load)

  const zonaIdParam = searchParams.get('zona')
  const activeZona = zonaIdParam ? zonas.find((z) => String(z.id) === zonaIdParam) ?? null : null
  const sel = tables.find((m) => m.id === selId) ?? null

  // Detalle de la orden de la mesa elegida (para "x entregados · y por entregar").
  const selOrdenId = sel?.ordenActiva?.id
  useEffect(() => {
    setSelOrden(null)
    if (selOrdenId) getOrder(selOrdenId).then((r) => setSelOrden(r.data.data)).catch(() => {})
  }, [selOrdenId, sel?.ordenActiva?.total])

  useEscapeKey(() => {
    if (moverDe) setMoverDe(null)
    else if (unirA) setUnirA(null)
    else if (showModal) setShowModal(false)
    else if (showZonaModal) setShowZonaModal(false)
  }, !!(moverDe || unirA || showModal || showZonaModal))

  // Reservaciones confirmadas de hoy que aún no llegan (hasta 1 h de retraso), por mesa.
  const desde = Date.now() - 60 * 60 * 1000
  const proximas = reservasHoy.filter((x) => x.estado === 'CONFIRMADA' && new Date(x.fechaHora).getTime() >= desde)
  const reservasPorMesa = {}
  proximas.filter((x) => x.mesaId).forEach((x) => { (reservasPorMesa[x.mesaId] ??= []).push(x) })

  function elegir(mesa) {
    setSelId(mesa.id)
    setComensales(Math.min(2, lugares(mesa).cap || 2))
  }

  async function abrirMesa(mesa) {
    setLoading(true)
    try {
      const res = await openOrder({ mesaId: mesa.id, numeroComensales: Number(comensales) })
      navigate(`/orders/${res.data.data.id}`)
    } catch (err) {
      notify(err.response?.data?.message ?? 'Error al abrir la mesa', 'error')
    } finally { setLoading(false) }
  }

  async function mover(destino) {
    const origen = moverDe
    setMoverDe(null)
    try {
      const r = await moveOrderTable(origen.ordenActiva.id, destino.id)
      notify(r.data.message ?? `Orden movida a la mesa ${destino.numero}`, 'success')
      setSelId(destino.id)
      if (destino.zona?.id && String(destino.zona.id) !== zonaIdParam) setSearchParams({ zona: String(destino.zona.id) })
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo mover la orden', 'error')
    }
  }

  async function unir(mesa) {
    const principal = unirA
    if (mesa.ordenActiva && !(await confirmDialog(
      `La mesa ${mesa.numero} ya tiene su orden: sus productos y comensales pasan a la mesa ${principal.numero} y su orden se cierra. ¿Unirlas?`,
      { confirmText: 'Unir mesas' }))) return
    setUnirA(null)
    try {
      await joinOrderTable(principal.ordenActiva.id, mesa.id)
      notify(`Mesa ${mesa.numero} unida a la mesa ${principal.numero}`, 'success')
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudieron unir las mesas', 'error') }
  }

  async function separar(mesa) {
    if (!(await confirmDialog(`¿Separar la mesa ${mesa.numero}? Queda libre; los productos se quedan en la orden de la mesa ${mesa.unidaA}.`, { confirmText: 'Separar' }))) return
    try {
      await splitOrderTable(mesa.ordenActiva.id, mesa.id)
      notify(`Mesa ${mesa.numero} separada`, 'success')
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo separar la mesa', 'error') }
  }

  // ── Alta / edición de mesas y zonas (admin) ──
  function openNewMesa() {
    setEditTable(null)
    setForm({ ...emptyMesaForm, zonaId: activeZona?.id ?? '' })
    setFieldErrors({})
    setShowModal(true)
  }
  function openEditMesa(mesa) {
    setEditTable(mesa)
    setForm({ numero: mesa.numero, capacidad: mesa.capacidad ?? '', zonaId: mesa.zona?.id ?? '' })
    setFieldErrors({})
    setShowModal(true)
  }
  async function handleSave(e) {
    e.preventDefault()
    const errors = {}
    if (!form.numero.trim()) errors.numero = 'El número/nombre es obligatorio'
    if (!form.zonaId) errors.zonaId = 'Debes elegir una zona'
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); notify('Revisa los campos marcados en rojo', 'error'); return }
    setLoading(true)
    try {
      const payload = { numero: form.numero, capacidad: form.capacidad ? Number(form.capacidad) : null, zonaId: Number(form.zonaId) }
      if (editTable) await updateTable(editTable.id, payload)
      else await createTable(payload)
      setShowModal(false)
      load()
      notify(editTable ? 'Mesa actualizada' : 'Mesa creada', 'success')
    } catch (err) {
      const data = err.response?.data?.data
      if (data && typeof data === 'object' && !Array.isArray(data)) setFieldErrors(data)
      notify(err.response?.data?.message ?? 'Error al guardar', 'error')
    } finally { setLoading(false) }
  }
  async function handleDeactivate(mesa) {
    if (!(await confirmDialog(`¿Desactivar la mesa ${mesa.numero}?`, { confirmText: 'Desactivar', danger: true }))) return
    try {
      await deleteTable(mesa.id)
      setSelId(null)
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo desactivar', 'error') }
  }
  function openNewZona() { setEditZona(null); setZonaNombre(''); setZonaFieldError(''); setShowZonaModal(true) }
  function openEditZona(z) { setEditZona(z); setZonaNombre(z.nombre); setZonaFieldError(''); setShowZonaModal(true) }
  async function handleSaveZona(e) {
    e.preventDefault()
    if (!zonaNombre.trim()) { setZonaFieldError('El nombre es obligatorio'); return }
    setZonaLoading(true)
    try {
      if (editZona) await updateZona(editZona.id, { nombre: zonaNombre.trim() })
      else await createZona({ nombre: zonaNombre.trim() })
      setShowZonaModal(false)
      loadZonas()
      notify(editZona ? 'Zona actualizada' : 'Zona creada', 'success')
    } catch (err) { notify(err.response?.data?.message ?? 'Error al guardar', 'error') }
    finally { setZonaLoading(false) }
  }
  async function handleDeleteZona(z, total) {
    if (total > 0) { notify('Esta zona todavía tiene mesas — reasígnalas a otra zona antes de eliminarla', 'error'); return }
    if (!(await confirmDialog(`¿Eliminar la zona "${z.nombre}"?`, { confirmText: 'Eliminar', danger: true }))) return
    try { await deleteZona(z.id); loadZonas() } catch (err) { notify(err.response?.data?.message ?? 'No se pudo eliminar la zona', 'error') }
  }

  // ── Resúmenes ──
  const conteo = (lista) => lista.reduce((acc, m) => { acc[m.estado] = (acc[m.estado] ?? 0) + 1; return acc }, {})
  const totales = conteo(tables)
  const mesasDe = (zonaId) => tables.filter((m) => m.zona?.id === zonaId).sort(porNumero)
  const mesasDeZona = activeZona ? mesasDe(activeZona.id) : []

  const atencion = [
    ...tables.filter((m) => m.estado === 'PENDIENTE_PAGO').map((m) => ({
      key: `c${m.id}`, dot: 'bg-[#C77700]', titulo: `Mesa ${m.numero} pidió la cuenta`,
      sub: [m.zona?.nombre, m.ordenActiva?.mesero?.name].filter(Boolean).join(' · '),
      cuando: m.ordenActiva?.total != null ? fmt(m.ordenActiva.total) : '',
      ir: () => (m.ordenActiva ? navigate(`/orders/${m.ordenActiva.id}`) : null),
    })),
    ...pickups.filter((o) => o.mesa).map((o) => ({
      key: `p${o.id}`, dot: 'bg-[#24519E]', titulo: `Mesa ${o.mesa.numero}: ${o.items?.length ?? 0} platillo${o.items?.length === 1 ? '' : 's'} listo${o.items?.length === 1 ? '' : 's'}`,
      sub: 'Llevar a la mesa', cuando: '', ir: () => navigate(`/orders/${o.id}`),
    })),
    ...proximas.filter((x) => new Date(x.fechaHora).getTime() <= Date.now() + 2 * 60 * 60 * 1000).map((x) => ({
      key: `r${x.id}`, dot: 'bg-[#5B3FA6]', titulo: `Reservación ${horaCorta(x.fechaHora)} · ${x.nombre} (${x.personas})`,
      sub: [x.mesa ? `Mesa ${x.mesa}` : 'Sin mesa asignada', ...necesidades(x).map((c) => c.corto)].join(' · '),
      cuando: '', ir: () => navigate('/reservaciones'),
    })),
  ]

  return (
    <div className="space-y-5">
      {!activeZona ? (
        <>
          <header className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <h1 className="text-[28px] font-extrabold tracking-tight">Mesas</h1>
              <p className="text-sm text-gray-600">{tables.length} mesas en {zonas.length} zona{zonas.length === 1 ? '' : 's'}</p>
            </div>
            <SelectorModoToma />
            {isAdmin && <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openNewZona}><Icon name="mas" className="w-4 h-4" />Nueva zona</button>}
          </header>

          <section aria-label="Resumen de mesas" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {RESUMEN.map((r) => (
              <div key={r.key} className="bg-white border border-[#E4E1DA] rounded-2xl px-4 py-3.5 flex items-center gap-3">
                <span className={`w-7 h-7 rounded-lg shrink-0 ${EST[r.key].cell}`} aria-hidden="true" />
                <div>
                  <p className="text-[13px] font-semibold text-gray-600">{r.label}</p>
                  <p className="text-2xl font-extrabold leading-tight">{totales[r.key] ?? 0}</p>
                </div>
              </div>
            ))}
          </section>

          <div className="flex flex-wrap gap-5 items-start">
            <section aria-label="Zonas" className="flex-[999_1_600px] min-w-0 grid grid-cols-1 md:grid-cols-2 gap-4">
              {zonas.map((z) => {
                const ms = mesasDe(z.id)
                const c = conteo(ms)
                const cap = ms.reduce((s, m) => s + lugares(m).cap, 0)
                const sent = ms.reduce((s, m) => s + lugares(m).sentados, 0)
                return (
                  <div key={z.id} className="relative bg-white border border-[#E4E1DA] rounded-2xl hover:border-purple-300 transition-colors">
                    <button type="button" onClick={() => setSearchParams({ zona: String(z.id) })}
                      className="w-full text-left p-5 flex flex-col gap-4 rounded-2xl">
                      <div className="flex items-baseline justify-between gap-3 pr-16">
                        <h2 className="text-lg font-extrabold">{z.nombre}</h2>
                        <span className="text-[13px] font-semibold text-gray-600 whitespace-nowrap">{ms.length} mesa{ms.length === 1 ? '' : 's'}</span>
                      </div>
                      {ms.length > 0 ? (
                        <div className="grid grid-cols-8 gap-1.5 max-w-[300px]" aria-hidden="true">
                          {ms.map((m) => <span key={m.id} title={`Mesa ${m.numero}`} className={`aspect-square rounded-md ${est(m.estado).cell}`} />)}
                        </div>
                      ) : <p className="text-sm text-gray-500">Sin mesas todavía</p>}
                      {ms.length > 0 && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-gray-700">
                          {RESUMEN.filter((r) => c[r.key]).map((r) => (
                            <span key={r.key} className="inline-flex items-center gap-1.5">
                              <span className={`w-3 h-3 rounded-[3px] ${EST[r.key].cell}`} aria-hidden="true" />
                              <b className="font-extrabold">{c[r.key]}</b> {r.short}
                            </span>
                          ))}
                        </div>
                      )}
                      {cap > 0 && (
                        <div className="space-y-1.5">
                          <p className="flex items-center gap-1.5 text-[13px] text-gray-700">
                            <Persona className="w-4 h-4" /> <b className="font-extrabold">{sent}</b> de {cap} lugares ocupados
                          </p>
                          <div className="h-1.5 rounded-full bg-[#ECE9E2] overflow-hidden" aria-hidden="true">
                            <div className="h-full bg-purple-600" style={{ width: `${Math.round((sent * 100) / cap)}%` }} />
                          </div>
                        </div>
                      )}
                    </button>
                    {isAdmin && (
                      <div className="absolute top-3 right-3 flex gap-1">
                        <button type="button" aria-label={`Editar zona ${z.nombre}`} onClick={() => openEditZona(z)}
                          className="w-8 h-8 rounded-lg text-gray-600 hover:bg-[#F1EFEA] flex items-center justify-center"><Icon name="editar" className="w-4 h-4" /></button>
                        <button type="button" aria-label={`Eliminar zona ${z.nombre}`} onClick={() => handleDeleteZona(z, ms.length)}
                          title={ms.length > 0 ? 'Solo se puede eliminar una zona sin mesas' : 'Eliminar zona'}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center ${ms.length > 0 ? 'text-gray-300 cursor-not-allowed' : 'text-red-600 hover:bg-red-50'}`}><Icon name="borrar" className="w-4 h-4" /></button>
                      </div>
                    )}
                  </div>
                )
              })}
              {zonas.length === 0 && (
                <p className="text-gray-500 col-span-full text-center py-10">Sin zonas todavía{isAdmin ? ' — crea la primera con "Nueva zona"' : ''}</p>
              )}
            </section>

            <aside aria-label="Necesita atención" className="flex-[1_1_300px] bg-white border border-[#E4E1DA] rounded-2xl p-4">
              <h2 className="text-base font-extrabold px-1 mb-1">Necesita atención</h2>
              {atencion.length === 0 && <p className="text-sm text-gray-600 px-1 py-4">Todo en orden por ahora.</p>}
              <ul>
                {atencion.map((a) => (
                  <li key={a.key}>
                    <button type="button" onClick={a.ir} className="w-full flex items-start gap-3 px-2 py-3 rounded-xl text-left hover:bg-[#F7F6F2]">
                      <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${a.dot}`} aria-hidden="true" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold">{a.titulo}</span>
                        {a.sub && <span className="block text-[13px] text-gray-600">{a.sub}</span>}
                      </span>
                      {a.cuando && <span className="text-xs text-gray-600 whitespace-nowrap">{a.cuando}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </>
      ) : (
        <>
          <header className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <nav aria-label="Ruta" className="text-[13px] text-gray-600 flex items-center gap-1.5">
                <button type="button" onClick={() => { setSearchParams({}); setSelId(null) }} className="font-semibold text-purple-700 hover:underline">Mesas</button>
                <span aria-hidden="true">›</span><span>{activeZona.nombre}</span>
              </nav>
              <h1 className="text-[28px] font-extrabold tracking-tight mt-0.5">{activeZona.nombre}</h1>
            </div>
            <SelectorModoToma />
            {isAdmin && <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openNewMesa}><Icon name="mas" className="w-4 h-4" />Nueva mesa</button>}
          </header>

          <div className="flex flex-wrap items-center gap-2">
            {zonas.map((z) => (
              <button key={z.id} type="button" aria-pressed={z.id === activeZona.id}
                onClick={() => { setSearchParams({ zona: String(z.id) }); setSelId(null) }}
                className={`chip ${z.id === activeZona.id ? 'chip-on' : ''}`}>
                {z.nombre} <span className="opacity-70">{mesasDe(z.id).length}</span>
              </button>
            ))}
            <span className="flex-1" />
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-gray-700" aria-label="Leyenda">
              {['DISPONIBLE', 'OCUPADA', 'PENDIENTE_PAGO', 'RESERVADA'].map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5"><span className={`w-3 h-3 rounded-[3px] ${EST[k].cell}`} />{EST[k].label}</span>
              ))}
              <span className="inline-flex items-center gap-1"><Persona className="w-3.5 h-3.5" />Comensal</span>
              <span className="inline-flex items-center gap-1"><Persona llena={false} className="w-3.5 h-3.5" color="#8C877E" />Lugar libre</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-5 items-start">
            <section aria-label={`Mesas de ${activeZona.nombre}`} className="flex-[999_1_560px] min-w-0 grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3.5">
              {mesasDeZona.map((m) => {
                const e = est(m.estado)
                const { cap, sentados } = lugares(m)
                const rv = reservasPorMesa[m.id]?.[0]
                const elegido = sel?.id === m.id
                return (
                  <button key={m.id} type="button" onClick={() => elegir(m)} aria-pressed={elegido}
                    className={`text-left bg-white rounded-2xl p-3.5 flex flex-col gap-2.5 transition-shadow ${
                      elegido ? 'border-2 border-purple-600 shadow-[0_0_0_4px_rgb(var(--brand-100))]' : 'border border-[#E4E1DA] hover:border-purple-300'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`px-2.5 py-0.5 rounded-lg text-xs font-extrabold ${e.pill}`}>{e.label}</span>
                      {m.ordenActiva && <span className="text-xs font-semibold text-gray-600">{transcurrido(m.ordenActiva.openedAt)}</span>}
                    </div>
                    <MesaDibujo mesa={m} />
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      {m.unidaA ? (
                        <span className="font-semibold text-[#1E4585]">Unida a la mesa {m.unidaA}</span>
                      ) : m.ordenActiva ? (
                        <>
                          <span className="text-gray-700 truncate">{m.ordenActiva.mesero?.name ?? '—'} · {sentados} de {cap}</span>
                          <span className="font-extrabold">{fmt(m.ordenActiva.total)}</span>
                        </>
                      ) : rv ? (
                        <>
                          <span className="text-[#4B3391] font-semibold truncate">{rv.nombre} ({rv.personas})</span>
                          <span className="font-extrabold text-[#4B3391]">{horaCorta(rv.fechaHora)}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-gray-700">{cap} lugares</span>
                          <span className="font-semibold text-gray-600">{m.estado === 'FUERA_DE_SERVICIO' ? '' : 'Disponible'}</span>
                        </>
                      )}
                    </div>
                  </button>
                )
              })}
              {mesasDeZona.length === 0 && (
                <p className="text-gray-500 col-span-full text-center py-10">Sin mesas en esta zona{isAdmin ? ' — agrega la primera con "Nueva mesa"' : ''}</p>
              )}
            </section>

            <aside aria-label="Mesa seleccionada" className="flex-[1_1_300px] bg-white border border-[#E4E1DA] rounded-2xl p-5 space-y-4 lg:sticky lg:top-4">
              {!sel ? (
                <p className="text-sm text-gray-600 py-6 text-center">Toca una mesa para ver su detalle.</p>
              ) : (
                <PanelMesa mesa={sel} orden={selOrden} reservas={reservasPorMesa[sel.id] ?? []} isAdmin={isAdmin}
                  comensales={comensales} setComensales={setComensales} loading={loading}
                  onAbrir={() => abrirMesa(sel)} onVer={() => navigate(`/orders/${sel.ordenActiva.id}`)}
                  onMover={() => setMoverDe(sel)} onUnir={() => setUnirA(sel)} onSeparar={() => separar(sel)}
                  unidas={tables.filter((t) => t.unidaA && t.ordenActiva?.id === sel.ordenActiva?.id && !sel.unidaA)}
                  onEditar={() => openEditMesa(sel)} onDesactivar={() => handleDeactivate(sel)} />
              )}
            </aside>
          </div>
        </>
      )}

      {/* Mover la orden a otra mesa libre */}
      {moverDe && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setMoverDe(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold">Mover la orden de la mesa {moverDe.numero}</h3>
            <p className="text-sm text-gray-600 mt-1">Elige una mesa libre. Productos, comensales y cuentas se van con la orden.</p>
            <div className="mt-4 space-y-4">
              {zonas.map((z) => {
                const libres = mesasDe(z.id).filter((m) => !m.ordenActiva && (m.estado === 'DISPONIBLE' || m.estado === 'RESERVADA'))
                if (libres.length === 0) return null
                return (
                  <div key={z.id}>
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-1.5">{z.nombre}</p>
                    <div className="flex flex-wrap gap-2">
                      {libres.map((m) => (
                        <button key={m.id} type="button" onClick={() => mover(m)}
                          className="min-h-[44px] px-4 rounded-xl border border-[#D9D5CC] bg-white text-sm font-bold hover:border-purple-400 hover:bg-purple-50">
                          Mesa {m.numero}{m.capacidad ? <span className="font-normal text-gray-600"> · {m.capacidad} lugares</span> : null}
                          {reservasPorMesa[m.id] && <span className="block text-[11px] font-semibold text-[#4B3391]">Reservada {horaCorta(reservasPorMesa[m.id][0].fechaHora)}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end mt-5"><button type="button" className="btn-secondary" onClick={() => setMoverDe(null)}>Cancelar</button></div>
          </div>
        </div>
      )}

      {/* Unir otra mesa a la orden de la mesa elegida */}
      {unirA && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setUnirA(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold">Unir una mesa a la mesa {unirA.numero}</h3>
            <p className="text-sm text-gray-600 mt-1">
              Solo mesas de la misma zona. Una mesa libre queda ocupada por esta orden; si ya tiene su orden, sus productos y comensales pasan aquí.
            </p>
            <div className="mt-4 space-y-4">
              {zonas.filter((z) => String(z.id) === String(unirA.zona?.id)).map((z) => {
                const opciones = mesasDe(z.id).filter((m) => m.id !== unirA.id && m.estado !== 'FUERA_DE_SERVICIO'
                  && m.ordenActiva?.id !== unirA.ordenActiva?.id)
                if (opciones.length === 0) return <p key={z.id} className="text-sm text-gray-700 py-6 text-center">No hay otras mesas en {z.nombre}.</p>
                return (
                  <div key={z.id}>
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-1.5">{z.nombre}</p>
                    <div className="flex flex-wrap gap-2">
                      {opciones.map((m) => (
                        <button key={m.id} type="button" onClick={() => unir(m)}
                          className="min-h-[44px] px-4 rounded-xl border border-[#D9D5CC] bg-white text-sm font-bold hover:border-purple-400 hover:bg-purple-50 text-left">
                          Mesa {m.numero}
                          <span className={`block text-[11px] font-semibold ${m.ordenActiva ? 'text-[#1E4585]' : 'text-[#22603C]'}`}>
                            {m.ordenActiva ? `Ocupada · ${fmt(m.ordenActiva.total)}` : 'Libre'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end mt-5"><button type="button" className="btn-secondary" onClick={() => setUnirA(null)}>Cancelar</button></div>
          </div>
        </div>
      )}

      {/* Nueva/editar mesa */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold mb-4">{editTable ? 'Editar mesa' : 'Nueva mesa'}</h3>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label htmlFor="mesa-numero" className="text-xs font-semibold text-gray-700">Número/nombre <span className={fieldErrors.numero ? 'text-red-600' : ''}>*</span></label>
                <input id="mesa-numero" className="input" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
                {fieldErrors.numero && <p className="text-red-600 text-xs mt-1">{fieldErrors.numero}</p>}
              </div>
              <div>
                <label htmlFor="mesa-zona" className="text-xs font-semibold text-gray-700">Zona <span className={fieldErrors.zonaId ? 'text-red-600' : ''}>*</span></label>
                <select id="mesa-zona" className="input" value={form.zonaId} onChange={(e) => setForm({ ...form, zonaId: e.target.value })}>
                  <option value="">Seleccionar...</option>
                  {zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
                </select>
                {fieldErrors.zonaId && <p className="text-red-600 text-xs mt-1">{fieldErrors.zonaId}</p>}
              </div>
              <div>
                <label htmlFor="mesa-cap" className="text-xs font-semibold text-gray-700">Lugares (capacidad)</label>
                <input id="mesa-cap" className="input" type="number" min="1" value={form.capacidad} onChange={(e) => setForm({ ...form, capacidad: e.target.value })} />
                <p className="text-xs text-gray-500 mt-1">Se dibujan como figuras alrededor de la mesa.</p>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={loading}>{loading ? '...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Nueva/editar zona */}
      {showZonaModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowZonaModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold mb-4">{editZona ? 'Editar zona' : 'Nueva zona'}</h3>
            <form onSubmit={handleSaveZona} className="space-y-3">
              <div>
                <label htmlFor="zona-nombre" className="text-xs font-semibold text-gray-700">Nombre <span className={zonaFieldError ? 'text-red-600' : ''}>*</span></label>
                <input id="zona-nombre" className="input" autoFocus placeholder="Ej. Terraza" value={zonaNombre}
                  onChange={(e) => { setZonaNombre(e.target.value); setZonaFieldError('') }} />
                {zonaFieldError && <p className="text-red-600 text-xs mt-1">{zonaFieldError}</p>}
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowZonaModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={zonaLoading}>{zonaLoading ? '...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

/** Panel lateral de la mesa elegida: detalle y acciones según su estado. */
function PanelMesa({ mesa, orden, reservas, isAdmin, comensales, setComensales, loading, onAbrir, onVer, onMover, onUnir, onSeparar, unidas = [], onEditar, onDesactivar }) {
  const e = est(mesa.estado)
  const { cap, sentados } = lugares(mesa)
  const activos = (orden?.items ?? []).filter((i) => i.estado !== 'CANCELADO' && !i.cargoExtra)
  const entregados = activos.filter((i) => i.estado === 'ENTREGADO').reduce((s, i) => s + Number(i.cantidad), 0)
  const porEntregar = activos.filter((i) => i.estado !== 'ENTREGADO').reduce((s, i) => s + Number(i.cantidad), 0)
  // Límite de personas = lugares de la mesa (los captura el admin); sin capacidad, hasta 20.
  const maxComensales = mesa.capacidad ? mesa.capacidad : 20

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[22px] font-extrabold">Mesa {mesa.numero}</h2>
        <span className={`px-3 py-1 rounded-lg text-[13px] font-extrabold ${e.pill}`}>{e.label}</span>
      </div>

      {mesa.unidaA ? (
        <>
          <p className="text-sm text-gray-700">Esta mesa está unida a la <b>mesa {mesa.unidaA}</b>: comparten la misma orden.</p>
          <button type="button" className="btn-primary w-full min-h-[44px]" onClick={onVer}>Ver orden</button>
          <button type="button" className="btn-secondary w-full min-h-[44px]" onClick={onSeparar}>Separar mesa</button>
        </>
      ) : mesa.ordenActiva ? (
        <>
          {unidas.length > 0 && (
            <p className="text-sm rounded-xl bg-[#E6EDF8] text-[#1E4585] px-3 py-2">
              Unida con la{unidas.length === 1 ? '' : 's'} mesa{unidas.length === 1 ? '' : 's'} <b>{unidas.map((u) => u.numero).join(', ')}</b>
            </p>
          )}
          <div>
            <p className="text-[13px] font-semibold text-gray-600 mb-1.5">Comensales</p>
            <div className="flex flex-wrap items-center gap-1">
              {Array.from({ length: Math.min(cap, 12) }, (_, i) => (
                <Persona key={i} llena={i < sentados} className="w-6 h-6" color={i < sentados ? e.seat : '#A39E94'} />
              ))}
              <span className="text-sm font-bold ml-1.5">{sentados} de {cap} lugares</span>
            </div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-600">Mesero</dt><dd className="font-bold">{mesa.ordenActiva.mesero?.name ?? '—'}</dd>
            <dt className="text-gray-600">Abierta</dt>
            <dd className="font-bold">{mesa.ordenActiva.openedAt ? `${horaCorta(mesa.ordenActiva.openedAt)} · hace ${transcurrido(mesa.ordenActiva.openedAt)}` : '—'}</dd>
            <dt className="text-gray-600">Productos</dt>
            <dd className="font-bold">{orden ? (activos.length === 0 ? 'Sin productos' : `${entregados} entregados · ${porEntregar} por entregar`) : '...'}</dd>
            <dt className="text-gray-600">Total</dt><dd className="font-extrabold text-xl">{fmt(mesa.ordenActiva.total)}</dd>
          </dl>
          <button type="button" className="btn-primary w-full min-h-[44px]" onClick={onVer}>Ver orden</button>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1 min-h-[44px] inline-flex items-center justify-center gap-2" onClick={onMover}>
              <Icon name="mover" className="w-4 h-4" /> Mover
            </button>
            <button type="button" className="btn-secondary flex-1 min-h-[44px] inline-flex items-center justify-center gap-2" onClick={onUnir}>
              <Icon name="unir" className="w-4 h-4" /> Unir mesa
            </button>
          </div>
        </>
      ) : mesa.estado === 'FUERA_DE_SERVICIO' ? (
        <p className="text-sm text-gray-700">Esta mesa está fuera de servicio.</p>
      ) : (
        <>
          <p className="text-sm text-gray-700">Mesa para {cap} persona{cap === 1 ? '' : 's'}, lista para sentar.</p>
          <div>
            <p className="text-[13px] font-semibold text-gray-600 mb-1.5">¿Cuántos comensales?</p>
            <div className="flex items-center gap-3">
              <button type="button" aria-label="Menos comensales" disabled={comensales <= 1} onClick={() => setComensales((c) => Math.max(1, c - 1))}
                className="w-11 h-11 rounded-xl border border-[#D9D5CC] bg-white text-xl font-bold disabled:opacity-40">−</button>
              <span className="text-2xl font-extrabold w-8 text-center">{comensales}</span>
              <button type="button" aria-label="Más comensales" disabled={comensales >= maxComensales} onClick={() => setComensales((c) => Math.min(maxComensales, c + 1))}
                className="w-11 h-11 rounded-xl border border-[#D9D5CC] bg-white text-xl font-bold disabled:opacity-40">+</button>
            </div>
            {mesa.capacidad && comensales >= mesa.capacidad && <p className="text-xs text-gray-600 mt-1.5">Es el máximo de la mesa. Para más personas, ábrela y une otra mesa.</p>}
          </div>
          <button type="button" className="btn-primary w-full min-h-[44px]" disabled={loading} onClick={onAbrir}>
            {loading ? '...' : `Abrir mesa ${mesa.numero}`}
          </button>
        </>
      )}

      {reservas.length > 0 && (
        <div className="border-t border-[#ECE9E2] pt-3 space-y-2">
          <p className="text-[13px] font-semibold text-gray-600">Reservaciones de hoy</p>
          {reservas.map((r) => (
            <div key={r.id} className="rounded-xl bg-[#F6F3FC] border border-[#E2DAF5] px-3 py-2">
              <p className="text-sm font-bold text-[#4B3391]">{horaCorta(r.fechaHora)} · {r.nombre} ({r.personas})</p>
              {necesidades(r).length > 0 && <p className="text-xs text-[#4B3391] mt-0.5">{necesidades(r).map((c) => c.corto).join(' · ')}</p>}
              {r.notas && <p className="text-xs text-gray-700 mt-0.5">{r.notas}</p>}
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div className="border-t border-[#ECE9E2] pt-3 flex gap-2">
          <button type="button" className="flex-1 min-h-[40px] rounded-xl text-sm font-semibold text-gray-700 hover:bg-[#F1EFEA] inline-flex items-center justify-center gap-1.5" onClick={onEditar}>
            <Icon name="editar" className="w-4 h-4" /> Editar mesa
          </button>
          <button type="button" disabled={!!mesa.ordenActiva} title={mesa.ordenActiva ? 'No se puede: tiene una orden activa' : undefined}
            className="flex-1 min-h-[40px] rounded-xl text-sm font-semibold text-red-700 hover:bg-red-50 disabled:text-gray-400 disabled:hover:bg-transparent inline-flex items-center justify-center gap-1.5" onClick={onDesactivar}>
            <Icon name="borrar" className="w-4 h-4" /> Desactivar
          </button>
        </div>
      )}
    </>
  )
}
