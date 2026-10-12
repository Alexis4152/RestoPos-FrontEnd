import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getTables, createTable, updateTable, deleteTable } from '../api/mesas'
import { getZonas, createZona, updateZona, deleteZona } from '../api/zonas'
import { openOrder } from '../api/ordenes'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { useLiveRefresh } from '../utils/liveEvents'
import { useEscapeKey } from '../hooks/useEscapeKey'

const ESTADO_STYLE = {
  DISPONIBLE: 'bg-green-50 border-green-200 text-green-700',
  OCUPADA: 'bg-blue-50 border-blue-200 text-blue-700',
  RESERVADA: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  PENDIENTE_PAGO: 'bg-orange-50 border-orange-200 text-orange-700',
  FUERA_DE_SERVICIO: 'bg-gray-100 border-gray-200 text-gray-500',
}
const ESTADO_LABEL = {
  DISPONIBLE: 'Disponible',
  OCUPADA: 'Ocupada',
  RESERVADA: 'Reservada',
  PENDIENTE_PAGO: 'Cuenta pedida',
  FUERA_DE_SERVICIO: 'Fuera de servicio',
}

// Badge de estado (color sólido) para que "Ocupada", "Cuenta pedida", etc. se lean de lejos.
const ESTADO_BADGE = {
  DISPONIBLE: 'bg-green-600 text-white',
  OCUPADA: 'bg-blue-600 text-white',
  RESERVADA: 'bg-yellow-400 text-yellow-900',
  PENDIENTE_PAGO: 'bg-orange-500 text-white',
  FUERA_DE_SERVICIO: 'bg-gray-400 text-white',
}

const emptyMesaForm ={ numero: '', capacidad: '', zonaId: '' }

/**
 * Mesas, organizadas en dos niveles: primero un tablero de Zonas (ej. "Zona principal",
 * "Terraza" — sin límite de cantidad, ver `ZonaController` en el backend), y al entrar a
 * una zona, sus mesas — mismo formato de tarjeta en ambos niveles. No hay forma de llegar a
 * dar de alta una mesa sin antes elegir una zona (se crea siempre dentro de una).
 *
 * Tanto una zona como una mesa se eliminan con la "✕" de su tarjeta, visible siempre pero
 * deshabilitada (con tooltip) cuando no se puede: una zona necesita estar sin mesas, una
 * mesa necesita no tener una orden activa — la misma regla que ya valida el backend.
 */
export default function Tables() {
  const { isAdmin } = useAuth()
  const { notify, confirmDialog } = useNotify()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [tables, setTables] = useState([])
  const [zonas, setZonas] = useState([])

  const [showModal, setShowModal] = useState(false)
  const [editTable, setEditTable] = useState(null)
  const [form, setForm] = useState(emptyMesaForm)
  const [fieldErrors, setFieldErrors] = useState({})
  const [openModal, setOpenModal] = useState(null)
  const [numeroComensales, setNumeroComensales] = useState(1)
  const [loading, setLoading] = useState(false)

  // Modal de Zona (crear/editar) — un modal normal, no una card embebida en la grilla.
  const [showZonaModal, setShowZonaModal] = useState(false)
  const [editZona, setEditZona] = useState(null)
  const [zonaNombre, setZonaNombre] = useState('')
  const [zonaFieldError, setZonaFieldError] = useState('')
  const [zonaLoading, setZonaLoading] = useState(false)

  function load() {
    getTables().then((r) => setTables(r.data.data ?? []))
  }
  function loadZonas() {
    getZonas().then((r) => setZonas(r.data.data ?? []))
  }
  useEffect(() => { load(); loadZonas() }, [])
  // Tiempo real: si otro mesero abre/cierra una mesa, aquí se ve sin recargar.
  useLiveRefresh(load)

  // La zona activa vive en la URL (?zona=id), no en un estado local: así el historial del
  // navegador guarda en qué nivel (zonas o mesas de zona X) estaba el usuario, y "atrás" desde
  // la orden de una mesa (ver OrderDetail) regresa al nivel correcto en vez de saltarse las
  // mesas y caer directo en el tablero de zonas. Si la zona ya no existe (se eliminó en otra
  // sesión), simplemente no resuelve y se muestra el tablero de zonas.
  const zonaIdParam = searchParams.get('zona')
  const activeZona = zonaIdParam ? zonas.find((z) => String(z.id) === zonaIdParam) ?? null : null

  // Cierra con ESC el modal abierto (abrir orden, alta/edición de mesa, o de zona) — mismo
  // efecto que su botón "Cancelar".
  useEscapeKey(() => {
    if (openModal) setOpenModal(null)
    else if (showModal) setShowModal(false)
    else if (showZonaModal) setShowZonaModal(false)
  }, !!(openModal || showModal || showZonaModal))

  function handleCardClick(mesa) {
    if (mesa.ordenActiva) {
      navigate(`/orders/${mesa.ordenActiva.id}`)
    } else if (mesa.estado === 'FUERA_DE_SERVICIO') {
      notify('Esta mesa está fuera de servicio')
    } else {
      setOpenModal(mesa)
      setNumeroComensales(mesa.capacidad || 1)
    }
  }

  async function handleOpenOrder(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await openOrder({ mesaId: openModal.id, numeroComensales: Number(numeroComensales) })
      setOpenModal(null)
      navigate(`/orders/${res.data.data.id}`)
    } catch (err) {
      notify(err.response?.data?.message ?? 'Error al abrir la orden')
    } finally { setLoading(false) }
  }

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

  function validateTableForm() {
    const errors = {}
    if (!form.numero.trim()) errors.numero = 'El número/nombre es obligatorio'
    if (!form.zonaId) errors.zonaId = 'Debes elegir una zona'
    return errors
  }

  async function handleSave(e) {
    e.preventDefault()
    const errors = validateTableForm()
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
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
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo desactivar')
    }
  }

  // ── Zonas ──────────────────────────────────────────────────────────
  function openNewZona() {
    setEditZona(null)
    setZonaNombre('')
    setZonaFieldError('')
    setShowZonaModal(true)
  }
  function openEditZona(z) {
    setEditZona(z)
    setZonaNombre(z.nombre)
    setZonaFieldError('')
    setShowZonaModal(true)
  }

  async function handleSaveZona(e) {
    e.preventDefault()
    if (!zonaNombre.trim()) {
      setZonaFieldError('El nombre es obligatorio')
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    setZonaLoading(true)
    try {
      if (editZona) await updateZona(editZona.id, { nombre: zonaNombre.trim() })
      else await createZona({ nombre: zonaNombre.trim() })
      setShowZonaModal(false)
      loadZonas()
      notify(editZona ? 'Zona actualizada' : 'Zona creada', 'success')
    } catch (err) {
      notify(err.response?.data?.message ?? 'Error al guardar', 'error')
    } finally { setZonaLoading(false) }
  }

  async function handleDeleteZona(z) {
    if ((zonaStats[z.id]?.total ?? 0) > 0) {
      notify('Esta zona todavía tiene mesas — reasígnalas a otra zona antes de eliminarla', 'error')
      return
    }
    if (!(await confirmDialog(`¿Eliminar la zona "${z.nombre}"?`, { confirmText: 'Eliminar', danger: true }))) return
    try {
      await deleteZona(z.id)
      loadZonas()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo eliminar la zona')
    }
  }

  // Desglose por zona de cuántas mesas tiene y en qué estado está cada una ahora mismo —
  // mismos estados que ya maneja el tablero de mesas (ver ESTADO_STYLE/ESTADO_LABEL), para
  // que el tablero de Zonas dé un vistazo rápido de qué zona necesita atención sin tener
  // que entrar a cada una. `.total` también se usa para bloquear el borrado de una zona
  // que todavía tiene mesas.
  const zonaStats = tables.reduce((acc, m) => {
    if (!m.zona?.id) return acc
    const s = (acc[m.zona.id] ??= { total: 0, numeros: {} })
    s.total += 1
    s[m.estado] = (s[m.estado] ?? 0) + 1
    // Números de mesa por estado, para que la tarjeta de zona diga exactamente cuáles
    // mesas están ocupadas / con cuenta pedida, no solo cuántas.
    ;(s.numeros[m.estado] ??= []).push(m.numero)
    return acc
  }, {})
  const listaMesas = (nums = []) =>
    [...nums].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b))).join(', ')

  // Leyenda grande de la tarjeta de zona: el estado más urgente que tenga (mismo orden de
  // prioridad que `zonaCardStyle`), en un banner de color sólido para leerse de lejos.
  function zonaBanner(stats) {
    if (!stats || stats.total === 0) return null
    if (stats.PENDIENTE_PAGO > 0) return { text: 'CUENTA PEDIDA', cls: 'bg-orange-500 text-white' }
    if (stats.OCUPADA > 0) {
      return stats.OCUPADA === stats.total
        ? { text: 'OCUPADA', cls: 'bg-blue-600 text-white' }
        : { text: 'OCUPADA PARCIAL', cls: 'bg-blue-600 text-white' }
    }
    if (stats.RESERVADA > 0) return { text: 'RESERVADA', cls: 'bg-yellow-400 text-yellow-900' }
    if ((stats.DISPONIBLE ?? 0) > 0) return { text: 'LIBRE', cls: 'bg-green-600 text-white' }
    return null
  }
  const mesasDeZona = activeZona ? tables.filter((m) => m.zona?.id === activeZona.id) : []

  // Color de la tarjeta de zona: refleja lo más urgente que haya en ella (cuenta pedida >
  // ocupada > reservada), igual que una mesa individual — "blanca" (sin color) si está
  // vacía o todas sus mesas están libres/fuera de servicio, para que destaque a simple
  // vista cuál zona de verdad necesita atención.
  function zonaCardStyle(stats) {
    if (!stats) return 'bg-white border-gray-200'
    if (stats.PENDIENTE_PAGO > 0) return ESTADO_STYLE.PENDIENTE_PAGO
    if (stats.OCUPADA > 0) return ESTADO_STYLE.OCUPADA
    if (stats.RESERVADA > 0) return ESTADO_STYLE.RESERVADA
    return 'bg-white border-gray-200'
  }

  return (
    <div>
      {!activeZona ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Zonas</h2>
            {isAdmin && <button className="btn-primary" onClick={openNewZona}>+ Nueva zona</button>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {zonas.map((z) => {
              const stats = zonaStats[z.id]
              const count = stats?.total ?? 0
              const banner = zonaBanner(stats)
              return (
                <div key={z.id} className={`relative card border-2 cursor-pointer hover:shadow-md transition-shadow ${zonaCardStyle(stats)}`}
                  onClick={() => setSearchParams({ zona: String(z.id) })}>
                  {isAdmin && (
                    <button
                      type="button"
                      title={count > 0 ? `No se puede eliminar: tiene ${count} mesa${count === 1 ? '' : 's'}` : 'Eliminar zona'}
                      disabled={count > 0}
                      className={`absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow ${
                        count > 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-red-500 text-white hover:bg-red-600'}`}
                      onClick={(e) => { e.stopPropagation(); handleDeleteZona(z) }}
                    >✕</button>
                  )}
                  {banner && (
                    <div className={`-mx-1 mb-2 rounded-lg px-2 py-1.5 text-center text-base font-extrabold tracking-wide shadow-sm ${banner.cls}`}>
                      {banner.text}
                    </div>
                  )}
                  <p className="text-lg font-bold">{z.nombre}</p>
                  <p className="text-xs opacity-70 mt-1">{count} mesa{count === 1 ? '' : 's'}</p>
                  {stats?.OCUPADA > 0 && (
                    <p className="text-sm font-bold text-blue-800 mt-2">
                      {stats.OCUPADA} de {count} ocupada{stats.OCUPADA === 1 ? '' : 's'}
                      <span className="block font-semibold">Mesa{stats.OCUPADA === 1 ? '' : 's'}: {listaMesas(stats.numeros.OCUPADA)}</span>
                    </p>
                  )}
                  {stats?.PENDIENTE_PAGO > 0 && (
                    <p className="text-sm font-bold text-orange-800 mt-2">
                      Cuenta pedida — Mesa{stats.PENDIENTE_PAGO === 1 ? '' : 's'}: {listaMesas(stats.numeros.PENDIENTE_PAGO)}
                    </p>
                  )}
                  {count > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {stats.DISPONIBLE > 0 && (
                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
                          {stats.DISPONIBLE} disponible{stats.DISPONIBLE === 1 ? '' : 's'}
                        </span>
                      )}
                      {stats.OCUPADA > 0 && (
                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          {stats.OCUPADA} ocupada{stats.OCUPADA === 1 ? '' : 's'}
                        </span>
                      )}
                      {stats.PENDIENTE_PAGO > 0 && (
                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
                          {stats.PENDIENTE_PAGO} cuenta pedida{stats.PENDIENTE_PAGO === 1 ? '' : 's'}
                        </span>
                      )}
                      {stats.RESERVADA > 0 && (
                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
                          {stats.RESERVADA} reservada{stats.RESERVADA === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  )}
                  {isAdmin && (
                    <div className="mt-3 text-xs" onClick={(e) => e.stopPropagation()}>
                      <button className="hover:underline" onClick={() => openEditZona(z)}>Editar</button>
                    </div>
                  )}
                </div>
              )
            })}
            {zonas.length === 0 && (
              <p className="text-gray-400 col-span-full text-center py-8">
                Sin zonas todavía{isAdmin ? ' — crea la primera con "+ Nueva zona"' : ''}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                title="Regresar a zonas"
                onClick={() => setSearchParams({})}
                className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-white border border-gray-300 shadow-sm text-gray-600 hover:bg-purple-50 hover:text-purple-700 hover:border-purple-300 transition-colors"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" clipRule="evenodd" d="M9.53 2.47a.75.75 0 010 1.06L4.81 8.25H16.5a.75.75 0 010 1.5H4.81l4.72 4.72a.75.75 0 11-1.06 1.06l-6-6a.75.75 0 010-1.06l6-6a.75.75 0 011.06 0z" />
                </svg>
              </button>
              <h2 className="text-2xl font-bold text-gray-900">{activeZona.nombre}</h2>
            </div>
            {isAdmin && <button className="btn-primary" onClick={openNewMesa}>+ Nueva mesa</button>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {mesasDeZona.map((mesa) => (
              <div key={mesa.id} className={`relative card border-2 cursor-pointer hover:shadow-md transition-shadow ${ESTADO_STYLE[mesa.estado] ?? ''}`}
                onClick={() => handleCardClick(mesa)}>
                {isAdmin && (
                  <button
                    type="button"
                    title={mesa.ordenActiva ? 'No se puede eliminar: tiene una orden activa' : 'Eliminar mesa'}
                    disabled={!!mesa.ordenActiva}
                    className={`absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow ${
                      mesa.ordenActiva ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-red-500 text-white hover:bg-red-600'}`}
                    onClick={(e) => { e.stopPropagation(); handleDeactivate(mesa) }}
                  >✕</button>
                )}
                <p className="text-lg font-bold">Mesa {mesa.numero}</p>
                <p className={`inline-block mt-1 px-2 py-0.5 rounded-md text-sm font-extrabold uppercase tracking-wide ${ESTADO_BADGE[mesa.estado] ?? 'bg-gray-200 text-gray-700'}`}>
                  {ESTADO_LABEL[mesa.estado] ?? mesa.estado}
                </p>
                {mesa.ordenActiva?.mesero?.name && (
                  <p className="text-sm mt-2 text-gray-800">Tomó la orden: <span className="font-bold">{mesa.ordenActiva.mesero.name}</span></p>
                )}
                {mesa.capacidad && <p className="text-xs opacity-70 mt-1">{mesa.capacidad} personas</p>}
                {mesa.ordenActiva && <p className="text-xs opacity-70 mt-2">Total: ${Number(mesa.ordenActiva.total ?? 0).toFixed(2)}</p>}
                {isAdmin && (
                  <div className="mt-3 text-xs" onClick={(e) => e.stopPropagation()}>
                    <button className="hover:underline" onClick={() => openEditMesa(mesa)}>Editar</button>
                  </div>
                )}
              </div>
            ))}
            {mesasDeZona.length === 0 && (
              <p className="text-gray-400 col-span-full text-center py-8">
                Sin mesas en esta zona{isAdmin ? ' — agrega la primera con "+ Nueva mesa"' : ''}
              </p>
            )}
          </div>
        </>
      )}

      {/* Nueva orden */}
      {openModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOpenModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Abrir mesa {openModal.numero}</h3>
            <form onSubmit={handleOpenOrder} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Número de comensales</label>
                <input className="input" type="number" min="1" required value={numeroComensales}
                  onChange={(e) => setNumeroComensales(e.target.value)} />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setOpenModal(null)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={loading}>{loading ? '...' : 'Abrir'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Nueva/editar mesa */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{editTable ? 'Editar mesa' : 'Nueva mesa'}</h3>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Número/nombre <span className={fieldErrors.numero ? 'text-red-600' : ''}>*</span></label>
                <input className="input" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
                {fieldErrors.numero && <p className="text-red-600 text-xs mt-1">{fieldErrors.numero}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Zona <span className={fieldErrors.zonaId ? 'text-red-600' : ''}>*</span></label>
                <select className="input" value={form.zonaId} onChange={(e) => setForm({ ...form, zonaId: e.target.value })}>
                  <option value="">Seleccionar...</option>
                  {zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
                </select>
                {fieldErrors.zonaId && <p className="text-red-600 text-xs mt-1">{fieldErrors.zonaId}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Capacidad</label>
                <input className="input" type="number" min="1" value={form.capacidad} onChange={(e) => setForm({ ...form, capacidad: e.target.value })} />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={loading}>{loading ? '...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Nueva/editar zona — modal simple: solo el nombre. */}
      {showZonaModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowZonaModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{editZona ? 'Editar zona' : 'Nueva zona'}</h3>
            <form onSubmit={handleSaveZona} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre <span className={zonaFieldError ? 'text-red-600' : ''}>*</span></label>
                <input className="input" autoFocus placeholder="Ej. Terraza" value={zonaNombre}
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
