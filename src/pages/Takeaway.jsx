import { useEffect, useState } from 'react'
import { etiquetaEntrega, etiquetaCobro } from '../components/EntregaSeguimiento'
import { useNavigate } from 'react-router-dom'
import { getTakeawayOrders, openOrder, getDeliveryFee } from '../api/ordenes'
import { useNotify } from '../context/NotifyContext'
import { useLiveRefresh } from '../utils/liveEvents'
import { useEscapeKey } from '../hooks/useEscapeKey'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'

const ESTADO_STYLE = {
  ABIERTA: 'bg-blue-50 border-blue-200 text-blue-700',
  EN_PROCESO: 'bg-orange-50 border-orange-200 text-orange-700',
  LISTA: 'bg-green-50 border-green-200 text-green-700',
  PENDIENTE_PAGO: 'bg-gray-100 border-gray-200 text-gray-500',
}
const ESTADO_LABEL = {
  ABIERTA: 'Abierta', EN_PROCESO: 'En proceso', LISTA: 'Lista', PENDIENTE_PAGO: 'Cuenta pedida',
}
// Badge de estado (color sólido), igual que en Mesas, para que se lea de lejos.
const ESTADO_BADGE = {
  ABIERTA: 'bg-blue-600 text-white',
  EN_PROCESO: 'bg-orange-500 text-white',
  LISTA: 'bg-green-600 text-white',
  PENDIENTE_PAGO: 'bg-gray-500 text-white',
}

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
    setShowNewModal(false)
  }, !!showNewModal)

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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Para llevar</h2>
        <button className="btn-primary" onClick={openNewModal}>
          + Nueva orden para llevar
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {orders.map((orden) => (
          <div key={orden.id} className={`card border-2 cursor-pointer hover:shadow-md transition-shadow ${ESTADO_STYLE[orden.estado] ?? ''}`}
            onClick={() => navigate(`/orders/${orden.id}`)}>
            <p className="text-lg font-bold">Orden #{orden.id}</p>
            {orden.origen === 'WEB' && (
              <p className={`inline-block mt-1 mr-1 px-2 py-0.5 rounded-md text-xs font-extrabold uppercase tracking-wide ${
                orden.pendienteAceptar ? 'bg-blue-600 text-white animate-pulse' : 'bg-blue-100 text-blue-800'}`}>
                🌐 {orden.pendienteAceptar ? 'Web · por aceptar' : 'Pedido web'}
              </p>
            )}
            <p className={`inline-block mt-1 px-2 py-0.5 rounded-md text-sm font-extrabold uppercase tracking-wide ${ESTADO_BADGE[orden.estado] ?? 'bg-gray-200 text-gray-700'}`}>
              {ESTADO_LABEL[orden.estado] ?? orden.estado}
            </p>
            {orden.clienteNombre && <p className="text-sm font-semibold truncate mt-2" title={orden.clienteNombre}>👤 {orden.clienteNombre}</p>}
            {orden.clienteTelefono && <p className="text-xs opacity-80">📞 {orden.clienteTelefono}</p>}
            {orden.tipoEntrega && <p className="text-xs mt-1 font-semibold">{orden.tipoEntrega === 'DOMICILIO' ? '🛵 A domicilio' : '🛍️ Para recoger'}</p>}
            {orden.tipoEntrega === 'DOMICILIO' && (
              <div className="flex flex-wrap gap-1 mt-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${etiquetaEntrega(orden).cls}`}>{etiquetaEntrega(orden).texto}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${etiquetaCobro(orden).cls}`}>{etiquetaCobro(orden).texto}</span>
              </div>
            )}
            <p className="text-sm mt-2 text-gray-800">
              Tomó la orden: <span className="font-bold">{orden.mesero?.name ?? (orden.pendienteAceptar ? 'nadie aún' : '—')}</span>
            </p>
            <p className="text-xs opacity-70">Abierta {fmtTime(orden.openedAt)}</p>
            {orden.direccion && <p className="text-xs opacity-70 mt-1 truncate" title={orden.direccion}>📍 {orden.direccion}</p>}
            <p className="text-xs opacity-70 mt-2">Total: {fmt(orden.total)}</p>
          </div>
        ))}
        {orders.length === 0 && <p className="text-gray-400 col-span-full text-center py-8">Sin órdenes para llevar activas</p>}
      </div>

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
