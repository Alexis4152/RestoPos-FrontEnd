import { useEffect, useState } from 'react'
import { etiquetaEntrega, etiquetaCobro } from '../components/EntregaSeguimiento'
import { useNavigate } from 'react-router-dom'
import { getTakeawayOrders, openOrder, getDeliveryFee, acceptWebOrder, rejectWebOrder, cancelOrder } from '../api/ordenes'
import { getDeliveriesPorRecibir, recibirDineroEntrega } from '../api/deliveries'
import { getTables } from '../api/mesas'
import { nombreMesa } from './rapido/MisMesas'
import Icon from '../components/Icon'
import { useNotify } from '../context/NotifyContext'
import { useAuth } from '../context/AuthContext'
import { useLiveRefresh } from '../utils/liveEvents'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { TIPOS_PEDIDO, tipoPedido, etiquetaTipoPedido } from '../utils/tipoPedido'
import CamposDireccion, { validarDireccion, direccionPayload } from '../components/CamposDireccion'

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
  ...TIPOS_PEDIDO.map((t) => ({ key: t.key, label: t.label, pasa: (o) => tipoPedido(o.tipoEntrega).key === t.key })),
  { key: 'web', label: 'Página web', pasa: (o) => o.origen === 'WEB' },
]
/** Paso del repartidor (0 sin repartidor … 3 entregado) para la barrita de 4 segmentos. */
const pasoEntrega = (o) => (o.entregadaAt ? 3 : o.enCaminoAt ? 2 : o.repartidor ? 1 : 0)

/**
 * Tablero "Para llevar": las órdenes sin mesa activas en este momento, una tarjeta por
 * orden, más antiguas primero. Click en una tarjeta va directo al detalle (la misma
 * pantalla que usan las órdenes de mesa — ver `OrderDetail.jsx`, que oculta comensales y
 * simplifica el cobro a "solo total" cuando la orden no tiene mesa). "Nuevo pedido" abre un
 * modal donde se elige el tipo (ver utils/tipoPedido.js) y se piden solo sus datos:
 * para llevar / comer aquí → nombre; para recoger → nombre y teléfono; a domicilio →
 * nombre, teléfono y dirección (+ el costo de envío configurado en "Datos de la tienda").
 */
export default function Takeaway() {
  const { notify } = useNotify()
  const navigate = useNavigate()
  const puedeCobrar = useAuth().hasSection('CASH_CUTS')
  const [orders, setOrders] = useState([])
  const [porRecibir, setPorRecibir] = useState([])
  const [recibiendo, setRecibiendo] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [direccion, setDireccion] = useState({ calle: '', colonia: '', codigoPostal: '' })
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  // "Comer aquí": el cliente pide en caja y se le asigna una mesa (zona → mesa).
  const [mesas, setMesas] = useState([])
  const [zonaSel, setZonaSel] = useState(null)
  const [mesaId, setMesaId] = useState(null)
  const [tipo, setTipo] = useState('PARA_LLEVAR')
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
    if (puedeCobrar) getDeliveriesPorRecibir().then((r) => setPorRecibir(r.data.data ?? [])).catch(() => setPorRecibir([]))
  }

  // Dinero que traen los repartidores de envíos ya entregados: la caja lo recibe aquí y se
  // cobra en el corte de quien lo recibe.
  async function recibir(lista) {
    setRecibiendo(true)
    let ok = 0
    try {
      for (const o of lista) { await recibirDineroEntrega(o.id); ok++ }
      notify(ok === 1 ? `Pedido #${lista[0].id}: dinero recibido` : `${ok} pedidos recibidos`, 'success')
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo registrar', 'error')
    } finally { setRecibiendo(false); load() }
  }
  // Tiempo real: los pedidos de la página web (y cualquier cambio) llegan en cuanto se guardan.
  useEffect(() => { load() }, [])
  useLiveRefresh(load, { filtro: (e) => e.name === 'orden' })

  function openNewModal() {
    setDireccion({ calle: '', colonia: '', codigoPostal: '' })
    setClienteNombre('')
    setClienteTelefono('')
    setMesaId(null)
    setZonaSel(null)
    getTables().then((r) => setMesas((r.data.data ?? []).filter((m) => m.isActive !== false && !m.unidaA))).catch(() => setMesas([]))
    setTipo('PARA_LLEVAR')
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
      await rejectWebOrder(o.id, motivo.trim() || 'Pedido rechazado')
      notify(`Pedido #${o.id} rechazado`, 'success')
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo rechazar el pedido', 'error'); load() }
    finally { setBusyId(null) }
  }

  async function handleNewOrder(e) {
    e.preventDefault()
    // Mismas reglas que OrdenService#abrir (según el tipo); topes de longitud iguales a las
    // columnas del backend.
    const t = tipoPedido(tipo)
    const errors = {}
    if (!clienteNombre.trim()) errors.clienteNombre = 'El nombre es obligatorio'
    else if (clienteNombre.length > 100) errors.clienteNombre = 'No puede tener más de 100 caracteres'
    if (t.telefono) {
      if (!clienteTelefono.trim()) errors.clienteTelefono = 'El teléfono es obligatorio'
      else if (clienteTelefono.length > 30) errors.clienteTelefono = 'No puede tener más de 30 caracteres'
    }
    if (t.direccion) Object.assign(errors, validarDireccion(direccion))
    if (t.key === 'COMER_AQUI' && !mesaId) errors.mesa = 'Elige la mesa donde se va a sentar'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    setLoading(true)
    try {
      const res = await openOrder({
        // "Comer aquí": la mesa se abre con todos sus lugares ocupados (una de 4 → 4 comensales).
        numeroComensales: t.key === 'COMER_AQUI' ? (mesas.find((m) => m.id === mesaId)?.capacidad || 1) : 1,
        mesaId: t.key === 'COMER_AQUI' ? mesaId : undefined,
        tipoEntrega: t.key,
        clienteNombre: clienteNombre.trim(),
        clienteTelefono: t.telefono ? clienteTelefono.trim() : undefined,
        ...(t.direccion ? direccionPayload(direccion) : {}),
      })
      navigate(`/orders/${res.data.data.id}`)
    } catch (err) {
      notify(err.response?.data?.message ?? 'Error al abrir la orden')
    } finally { setLoading(false) }
  }

  const filtroActual = FILTROS.find((f) => f.key === filtro) ?? FILTROS[0]
  // Los envíos ya entregados (por recibir el dinero) salen del tablero: van en el panel de arriba.
  const enTablero = orders.filter((o) => !o.entregadaAt)
  const visibles = enTablero.filter(filtroActual.pasa)

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

      {porRecibir.length > 0 && (
        <section aria-label="Dinero por recibir de repartidores" className="rounded-2xl border border-[#E2B76B] bg-[#FBF0DC] p-4 space-y-3">
          <h2 className="text-base font-extrabold text-[#6B4100]">Dinero por recibir de repartidores</h2>
          {Object.values(porRecibir.reduce((g, o) => {
            const k = o.repartidor?.id ?? 0
            ;(g[k] ??= { nombre: o.repartidor?.name ?? 'Sin repartidor', lista: [] }).lista.push(o)
            return g
          }, {})).map((g) => {
            const total = g.lista.reduce((s, o) => s + Number(o.total ?? 0), 0)
            const efectivo = g.lista.filter((o) => o.metodoPago === 'EFECTIVO').reduce((s, o) => s + Number(o.total ?? 0), 0)
            return (
              <div key={g.nombre} className="bg-white rounded-xl border border-[#EADFC3] p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex-1 min-w-[160px] font-extrabold">
                    {g.nombre} · {fmt(total)}
                    <span className="block text-xs font-semibold text-gray-600">
                      {efectivo > 0 ? `${fmt(efectivo)} en efectivo` : 'Sin efectivo'}{total - efectivo > 0 ? ` · ${fmt(total - efectivo)} por transferencia` : ''}
                    </span>
                  </p>
                  {g.lista.length > 1 && (
                    <button type="button" className="btn-primary min-h-[40px]" disabled={recibiendo} onClick={() => recibir(g.lista)}>
                      Recibir todo
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-[#F0EEE8]">
                  {g.lista.map((o) => (
                    <li key={o.id} className="flex items-center gap-3 py-2 text-sm">
                      <button type="button" className="flex-1 min-w-0 text-left hover:underline" onClick={() => navigate(`/orders/${o.id}`)}>
                        <span className="font-bold">#{o.id} · {o.clienteNombre ?? 'Cliente'}</span>
                        <span className="block text-xs text-gray-600">{PAGO_LABEL[o.metodoPago] ?? o.metodoPago} · entregado {fmtTime(o.entregadaAt)}</span>
                      </button>
                      <span className="font-bold">{fmt(o.total)}</span>
                      <button type="button" className="btn-secondary min-h-[40px]" disabled={recibiendo} onClick={() => recibir([o])}>Recibir</button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          <p className="text-xs text-[#6B4100]">Se cobra en tu corte de caja (necesitas tenerlo abierto).</p>
        </section>
      )}

      <div className="flex flex-wrap gap-2" aria-label="Filtrar pedidos">
        {FILTROS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filtro === f.key} onClick={() => setFiltro(f.key)}
            className={`chip ${filtro === f.key ? 'chip-on' : ''}`}>
            {f.label} <span className="opacity-70">{enTablero.filter(f.pasa).length}</span>
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Nuevo pedido</h3>
            <form onSubmit={handleNewOrder} className="space-y-3">
              <fieldset>
                <legend className="text-xs font-medium text-gray-600 mb-1.5">Tipo de pedido</legend>
                <div className="grid grid-cols-2 gap-2">
                  {TIPOS_PEDIDO.map((op) => {
                    const sinEnvio = op.key === 'DOMICILIO' && deliveryFee == null
                    return (
                      <button key={op.key} type="button" aria-pressed={tipo === op.key} disabled={sinEnvio}
                        onClick={() => { setTipo(op.key); setFieldErrors({}) }}
                        className={`min-h-[56px] rounded-xl border-2 px-3 py-2 text-left disabled:opacity-50 disabled:cursor-not-allowed ${tipo === op.key ? 'border-purple-600 bg-purple-50' : 'border-[#E4E1DA] hover:bg-gray-50'}`}>
                        <span className="block text-sm font-bold">{op.label}</span>
                        <span className="block text-[11px] text-gray-600">
                          {sinEnvio ? 'Configura el costo de envío en Datos de la tienda' : op.hint}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre del cliente <span className="text-red-500">*</span></label>
                <input className="input" autoFocus placeholder="Ej. Juan Pérez" value={clienteNombre}
                  onChange={(e) => { setClienteNombre(e.target.value); setFieldErrors((f) => ({ ...f, clienteNombre: '' })) }} />
                {fieldErrors.clienteNombre && <p className="text-red-600 text-xs mt-1">{fieldErrors.clienteNombre}</p>}
              </div>
              {tipo === 'COMER_AQUI' && (
                <ElegirMesa mesas={mesas} zonaSel={zonaSel} setZonaSel={setZonaSel} mesaId={mesaId}
                  onMesa={(id) => { setMesaId(id); setFieldErrors((f) => ({ ...f, mesa: '' })) }} error={fieldErrors.mesa} />
              )}
              {tipoPedido(tipo).telefono && (
                <div>
                  <label className="text-xs font-medium text-gray-600">Teléfono <span className="text-red-500">*</span></label>
                  <input className="input" type="tel" placeholder="Ej. 55 1234 5678" value={clienteTelefono}
                    onChange={(e) => { setClienteTelefono(e.target.value); setFieldErrors((f) => ({ ...f, clienteTelefono: '' })) }} />
                  {fieldErrors.clienteTelefono && <p className="text-red-600 text-xs mt-1">{fieldErrors.clienteTelefono}</p>}
                </div>
              )}
              {tipoPedido(tipo).direccion && (
                <>
                  <CamposDireccion value={direccion} errors={fieldErrors} idPrefix="pos-dir"
                    onChange={(p) => { setDireccion((d) => ({ ...d, ...p })); setFieldErrors((f) => ({ ...f, ...Object.fromEntries(Object.keys(p).map((k) => [k, ''])) })) }} />
                  <p className="flex justify-between rounded-lg bg-[#F7F6F2] px-3 py-2 text-sm">
                    <span className="text-gray-700">Costo de envío (se agrega a la orden)</span>
                    <span className="font-semibold">{fmt(deliveryFee)}</span>
                  </p>
                </>
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
  const tipoLabel = etiquetaTipoPedido(o)
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
          <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#F1EFEA] text-gray-700">{tipoLabel}</span>
          {o.mesa && <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#E6EDF8] text-[#1E4585]">{nombreMesa(o.mesa.numero)}</span>}
          {o.metodoPago && <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#F1EFEA] text-gray-700">{PAGO_LABEL[o.metodoPago] ?? o.metodoPago}</span>}
          {o.metodoPago === 'EFECTIVO' && o.pagaCon != null && Number(o.pagaCon) > Number(o.total) && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#E7F3EC] text-[#22603C]">Paga con {fmt(o.pagaCon)} · cambio {fmt(Number(o.pagaCon) - Number(o.total))}</span>
          )}
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

/**
 * "Comer aquí": se elige la zona y luego la mesa, con sus lugares. Las mesas ocupadas o fuera
 * de servicio se ven pero no se pueden elegir.
 */
function ElegirMesa({ mesas, zonaSel, setZonaSel, mesaId, onMesa, error }) {
  const zonas = []
  mesas.forEach((m) => {
    const z = m.zona ?? { id: 0, nombre: 'Sin zona' }
    if (!zonas.some((x) => x.id === z.id)) zonas.push(z)
  })
  const zona = zonaSel ?? zonas[0]?.id ?? null
  const libre = (m) => m.estado === 'DISPONIBLE' || m.estado === 'RESERVADA'
  const deZona = mesas.filter((m) => (m.zona?.id ?? 0) === zona)
  if (mesas.length === 0) return <p className="text-sm text-gray-600">No hay mesas dadas de alta.</p>
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-600">Mesa <span className="text-red-500">*</span></p>
      {zonas.length > 1 && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Zona">
          {zonas.map((z) => {
            const libres = mesas.filter((m) => (m.zona?.id ?? 0) === z.id && libre(m)).length
            return (
              <button key={z.id} type="button" role="radio" aria-checked={zona === z.id} onClick={() => setZonaSel(z.id)}
                className={`min-h-[36px] px-3 rounded-full text-sm font-semibold border ${zona === z.id ? 'bg-gray-900 border-gray-900 text-white' : 'border-[#D9D5CC] bg-white text-gray-700'}`}>
                {z.nombre} <span className="opacity-70">· {libres} libre{libres === 1 ? '' : 's'}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Mesa">
        {deZona.map((m) => {
          const ok = libre(m)
          const sel = mesaId === m.id
          return (
            <button key={m.id} type="button" role="radio" aria-checked={sel} disabled={!ok} onClick={() => onMesa(m.id)}
              className={`min-h-[56px] rounded-xl border px-3 py-2 text-left disabled:opacity-45 disabled:cursor-not-allowed ${sel ? 'border-2 border-purple-600 bg-purple-50' : 'border-[#D9D5CC] bg-white hover:border-gray-400'}`}>
              <span className="block text-sm font-extrabold">{nombreMesa(m.numero)}</span>
              <span className="block text-xs text-gray-600">
                {m.capacidad ? `${m.capacidad} lugar${m.capacidad === 1 ? '' : 'es'}` : 'Sin capacidad'}{ok ? '' : m.estado === 'FUERA_DE_SERVICIO' ? ' · fuera de servicio' : ' · ocupada'}
              </span>
            </button>
          )
        })}
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  )
}
