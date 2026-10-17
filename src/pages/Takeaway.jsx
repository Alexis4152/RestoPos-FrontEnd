import { useEffect, useState } from 'react'
import { etiquetaEntrega, etiquetaCobro } from '../components/EntregaSeguimiento'
import { useNavigate } from 'react-router-dom'
import { getTakeawayOrders, openOrder, getDeliveryFee, acceptWebOrder, cancelOrder } from '../api/ordenes'
import Icon from '../components/Icon'
import { useNotify } from '../context/NotifyContext'
import { useLiveRefresh } from '../utils/liveEvents'
import { useEscapeKey } from '../hooks/useEscapeKey'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'

const LISTO = ['LISTO', 'ENTREGADO_MESERO', 'ENTREGADO']
const PAGO_LABEL = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia' }

/** Etapa del pedido en el tablero: por aceptar → en preparación → listo → en camino (domicilio). */
function etapa(o) {
  if (o.pendienteAceptar) return 'ACEPTAR'
  if (o.tipoEntrega === 'DOMICILIO' && o.enCaminoAt) return 'CAMINO'
  const items = (o.items ?? []).filter((i) => !i.cargoExtra && i.estado !== 'CANCELADO')
  if (items.length > 0 && items.every((i) => LISTO.includes(i.estado))) return 'LISTO'
  return 'PREP'
}
const COLUMNAS = [
  { key: 'ACEPTAR', titulo: 'Por aceptar', dot: 'bg-red-700' },
  { key: 'PREP', titulo: 'En preparación', dot: 'bg-[#24519E]' },
  { key: 'LISTO', titulo: 'Listo para entregar', dot: 'bg-[#C77700]' },
  { key: 'CAMINO', titulo: 'En camino', dot: 'bg-purple-600' },
]
const FILTROS = [
  { key: 'todos', label: 'Todos', pasa: () => true },
  { key: 'recoger', label: 'Recoger', pasa: (o) => o.tipoEntrega !== 'DOMICILIO' },
  { key: 'domicilio', label: 'Domicilio', pasa: (o) => o.tipoEntrega === 'DOMICILIO' },
  { key: 'web', label: 'Página web', pasa: (o) => o.origen === 'WEB' },
]
/** Paso del repartidor (0 sin repartidor … 3 entregado) para la barrita de 4 segmentos. */
const pasoEntrega = (o) => (o.entregadaAt ? 3 : o.enCaminoAt ? 2 : o.repartidor ? 1 : 0)

/**
 * Tablero "Para llevar": las órdenes sin mesa activas en este momento, una tarjeta por
 * orden, más antiguas primero. Click en una tarjeta va directo al detalle (la misma
 * pantalla que usan las órdenes de mesa — ver `OrderDetail.jsx`, que oculta comensales y
 * simplifica el cobro a "solo total" cuando la orden no tiene mesa). "+ Nueva orden para
 * llevar" abre un modal para capturar el nombre y teléfono del cliente (obligatorios), la
 * dirección de entrega (opcional) y si es envío a domicilio — que agrega a la orden el
 * costo de envío configurado por el admin en "Datos de la tienda" — antes de abrir la orden
 * sin mesaId y navegar directo a su detalle.
 */
export default function Takeaway() {
  const { notify } = useNotify()
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [showNewModal, setShowNewModal] = useState(false)
  const [direccion, setDireccion] = useState('')
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [domicilio, setDomicilio] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  // Costo de envío configurado por el admin; null = la tienda no cobra envío (no se ofrece la casilla).
  const [deliveryFee, setDeliveryFee] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filtro, setFiltro] = useState('todos')
  const [busyId, setBusyId] = useState(null)
  const [rechazando, setRechazando] = useState(null) // pedido web que se rechaza (motivo)
  const [motivo, setMotivo] = useState('')

  function load() {
    getTakeawayOrders().then((r) => setOrders(r.data.data ?? [])).catch(() => setOrders([]))
  }
  // Tiempo real: los pedidos de la página web (y cualquier cambio) llegan en cuanto se guardan.
  useEffect(() => { load() }, [])
  useLiveRefresh(load, { filtro: (e) => e.name === 'orden' })

  function openNewModal() {
    setDireccion('')
    setClienteNombre('')
    setClienteTelefono('')
    setDomicilio(false)
    setFieldErrors({})
    getDeliveryFee().then((r) => setDeliveryFee(r.data.data ?? null)).catch(() => setDeliveryFee(null))
    setShowNewModal(true)
  }

  // Cierra con ESC el modal de nueva orden, descartando lo capturado — mismo efecto que "Cancelar".
  useEscapeKey(() => {
    if (rechazando) setRechazando(null)
    else setShowNewModal(false)
  }, !!(showNewModal || rechazando))

  async function aceptar(o) {
    setBusyId(o.id)
    try {
      await acceptWebOrder(o.id)
      notify(`Pedido #${o.id} aceptado — ya está en cocina`, 'success')
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo aceptar el pedido', 'error') }
    finally { setBusyId(null) }
  }

  async function confirmarRechazo() {
    const o = rechazando
    setRechazando(null)
    setBusyId(o.id)
    try {
      await cancelOrder(o.id, motivo.trim() || 'Pedido rechazado')
      notify(`Pedido #${o.id} rechazado`, 'success')
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo rechazar el pedido', 'error') }
    finally { setBusyId(null) }
  }

  async function handleNewOrder(e) {
    e.preventDefault()
    // Mismas reglas que OrdenService#abrir: nombre y teléfono obligatorios, dirección
    // opcional; topes de longitud iguales a las columnas del backend.
    const errors = {}
    if (!clienteNombre.trim()) errors.clienteNombre = 'El nombre es obligatorio'
    else if (clienteNombre.length > 100) errors.clienteNombre = 'No puede tener más de 100 caracteres'
    if (!clienteTelefono.trim()) errors.clienteTelefono = 'El teléfono es obligatorio'
    else if (clienteTelefono.length > 30) errors.clienteTelefono = 'No puede tener más de 30 caracteres'
    if (direccion.length > 200) errors.direccion = 'No puede tener más de 200 caracteres'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    setLoading(true)
    try {
      const res = await openOrder({
        numeroComensales: 1,
        clienteNombre: clienteNombre.trim(),
        clienteTelefono: clienteTelefono.trim(),
        direccion: direccion.trim() || undefined,
        domicilio: deliveryFee != null && domicilio,
      })
      navigate(`/orders/${res.data.data.id}`)
    } catch (err) {
      notify(err.response?.data?.message ?? 'Error al abrir la orden')
    } finally { setLoading(false) }
  }

  const filtroActual = FILTROS.find((f) => f.key === filtro) ?? FILTROS[0]
  const visibles = orders.filter(filtroActual.pasa)

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-[28px] font-extrabold tracking-tight">Para llevar y domicilio</h1>
          <p className="text-sm text-gray-600">Pedidos de caja y de la página web, por etapa</p>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openNewModal}>
          <Icon name="mas" className="w-4 h-4" /> Nuevo pedido
        </button>
      </header>

      <div className="flex flex-wrap gap-2" aria-label="Filtrar pedidos">
        {FILTROS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filtro === f.key} onClick={() => setFiltro(f.key)}
            className={`chip ${filtro === f.key ? 'chip-on' : ''}`}>
            {f.label} <span className="opacity-70">{orders.filter(f.pasa).length}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5 items-start">
        {COLUMNAS.map((col) => {
          const lista = visibles.filter((o) => etapa(o) === col.key)
          return (
            <section key={col.key} aria-label={col.titulo} className="bg-[#ECEAE4] rounded-2xl p-3.5 space-y-3">
              <div className="flex items-center gap-2 px-1">
                <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`} aria-hidden="true" />
                <h2 className="text-[15px] font-extrabold">{col.titulo}</h2>
                <span className="ml-auto text-[13px] font-extrabold text-gray-700">{lista.length}</span>
              </div>
              {lista.length === 0 && <p className="text-[13px] text-gray-600 text-center py-4">Nada por aquí</p>}
              {lista.map((o) => <TarjetaPedido key={o.id} o={o} busy={busyId === o.id} onAbrir={() => navigate(`/orders/${o.id}`)}
                onAceptar={() => aceptar(o)} onRechazar={() => { setMotivo('No podemos atender tu pedido en este momento'); setRechazando(o) }} />)}
            </section>
          )
        })}
      </div>

      {rechazando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setRechazando(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold">Rechazar pedido #{rechazando.id}</h3>
            <label htmlFor="motivo-rechazo" className="block text-xs font-semibold text-gray-700 mt-4 mb-1">Motivo (el cliente lo ve en su página)</label>
            <textarea id="motivo-rechazo" className="input" rows={3} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" className="btn-secondary" onClick={() => setRechazando(null)}>Volver</button>
              <button type="button" className="btn-danger" onClick={confirmarRechazo}>Rechazar</button>
            </div>
          </div>
        </div>
      )}

      {showNewModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowNewModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Nueva orden para llevar</h3>
            <form onSubmit={handleNewOrder} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre del cliente <span className="text-red-500">*</span></label>
                <input className="input" autoFocus placeholder="Ej. Juan Pérez" value={clienteNombre}
                  onChange={(e) => { setClienteNombre(e.target.value); setFieldErrors((f) => ({ ...f, clienteNombre: '' })) }} />
                {fieldErrors.clienteNombre && <p className="text-red-600 text-xs mt-1">{fieldErrors.clienteNombre}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Teléfono <span className="text-red-500">*</span></label>
                <input className="input" type="tel" placeholder="Ej. 55 1234 5678" value={clienteTelefono}
                  onChange={(e) => { setClienteTelefono(e.target.value); setFieldErrors((f) => ({ ...f, clienteTelefono: '' })) }} />
                {fieldErrors.clienteTelefono && <p className="text-red-600 text-xs mt-1">{fieldErrors.clienteTelefono}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Dirección de entrega <span className="font-normal text-gray-400">(opcional)</span></label>
                <input className="input" placeholder="Ej. Calle Falsa 123, Col. Centro" value={direccion}
                  onChange={(e) => { setDireccion(e.target.value); setFieldErrors((f) => ({ ...f, direccion: '' })) }} />
                {fieldErrors.direccion && <p className="text-red-600 text-xs mt-1">{fieldErrors.direccion}</p>}
              </div>
              {deliveryFee != null && (
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" className="w-4 h-4" checked={domicilio} onChange={(e) => setDomicilio(e.target.checked)} />
                  <span className="text-sm text-gray-700 flex-1">🛵 Envío a domicilio</span>
                  <span className="text-sm font-semibold text-gray-900">+{fmt(deliveryFee)}</span>
                </label>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowNewModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={loading}>{loading ? '...' : 'Abrir orden'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

/** Tarjeta de un pedido en el tablero: datos clave, avance de cocina, paso del repartidor y cobro. */
function TarjetaPedido({ o, busy, onAbrir, onAceptar, onRechazar }) {
  const items = (o.items ?? []).filter((i) => !i.cargoExtra && i.estado !== 'CANCELADO')
  const piezas = items.reduce((s, i) => s + Number(i.cantidad), 0)
  const listos = items.filter((i) => LISTO.includes(i.estado)).reduce((s, i) => s + Number(i.cantidad), 0)
  const resumen = items.slice(0, 3).map((i) => `${Number(i.cantidad) > 1 ? `${Number(i.cantidad)} × ` : ''}${i.productoNombre}`).join(', ')
    + (items.length > 3 ? ` y ${items.length - 3} más` : '')
  const domicilio = o.tipoEntrega === 'DOMICILIO'
  const paso = pasoEntrega(o)
  const cobro = etiquetaCobro(o)
  return (
    <article className="bg-white border border-[#E4E1DA] rounded-2xl">
      <button type="button" onClick={onAbrir} className="w-full text-left p-3.5 space-y-2.5 rounded-2xl">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-base font-extrabold truncate">#{o.id} · {o.clienteNombre ?? 'Sin nombre'}</span>
          <span className="text-xs text-gray-600 whitespace-nowrap">{fmtTime(o.openedAt)}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#F1EFEA] text-gray-700">{o.origen === 'WEB' ? 'Web' : 'Caja'}</span>
          <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#F1EFEA] text-gray-700">{domicilio ? 'Domicilio' : 'Recoger'}</span>
          {o.metodoPago && <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#F1EFEA] text-gray-700">{PAGO_LABEL[o.metodoPago] ?? o.metodoPago}</span>}
        </div>
        <p className="text-sm text-gray-700">{resumen || 'Sin productos todavía'}</p>
        {!o.pendienteAceptar && piezas > 0 && listos < piezas && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-[#ECE9E2] overflow-hidden" aria-hidden="true">
              <div className="h-full bg-[#24519E]" style={{ width: `${Math.round((listos * 100) / piezas)}%` }} />
            </div>
            <p className="text-xs text-gray-600">{listos} de {piezas} listos</p>
          </div>
        )}
        {domicilio && !o.pendienteAceptar && (
          <div className="rounded-xl bg-[#F7F6F2] p-2.5 space-y-1.5">
            <div className="grid grid-cols-4 gap-1" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <span key={i} className={`h-1.5 rounded-full ${i <= paso ? 'bg-purple-600' : 'bg-[#DCD8CF]'}`} />)}
            </div>
            <p className="text-[13px] font-bold">{etiquetaEntrega(o).texto}</p>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs font-extrabold px-2 py-1 rounded-md ${cobro.cls}`}>{cobro.texto}</span>
          <span className="text-base font-extrabold">{fmt(o.total)}</span>
        </div>
      </button>
      {o.pendienteAceptar && (
        <div className="flex gap-2 px-3.5 pb-3.5">
          <button type="button" className="btn-primary flex-1 min-h-[44px]" disabled={busy} onClick={onAceptar}>Aceptar</button>
          <button type="button" className="btn-secondary flex-1 min-h-[44px]" disabled={busy} onClick={onRechazar}>Rechazar</button>
        </div>
      )}
    </article>
  )
}
