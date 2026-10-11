import { useEffect, useState } from 'react'
import { getKitchenOrders, getKitchenDeliveredToday } from '../api/kitchen'
import { updateOrderItemStatus } from '../api/ordenes'
import { useNotify } from '../context/NotifyContext'
import { useLiveRefresh } from '../utils/liveEvents'

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'

const ESTADO_LABEL = {
  ABIERTA: 'Abierta', EN_PROCESO: 'En proceso', LISTA: 'Lista', PENDIENTE_PAGO: 'Pendiente de pago',
}
const ESTADO_STYLE = {
  ABIERTA: 'border-blue-200 bg-blue-50/40',
  EN_PROCESO: 'border-orange-200 bg-orange-50/40',
  LISTA: 'border-green-200 bg-green-50/40',
  PENDIENTE_PAGO: 'border-gray-200 bg-gray-50',
}
const ITEM_ESTADO_STYLE = {
  PENDIENTE: 'bg-gray-100 text-gray-600',
  PREPARANDO: 'bg-orange-100 text-orange-700',
  LISTO: 'bg-green-100 text-green-700',
  ENTREGADO_MESERO: 'bg-purple-100 text-purple-700',
  ENTREGADO: 'bg-blue-100 text-blue-600',
}
const itemEstadoLabel = (item, orden) => {
  if (item.estado === 'ENTREGADO_MESERO') return 'Entregado a mesero'
  if (item.estado === 'ENTREGADO') return orden.mesa ? 'Entregado a mesa' : 'Entregado para llevar'
  return item.estado
}
// Para cocina, un producto ya salió en cuanto se le entrega al mesero.
const pendienteCocina = (i) => !['ENTREGADO_MESERO', 'ENTREGADO', 'CANCELADO'].includes(i.estado)
// Valor especial del select de mesas: en vez de filtrar por mesa, muestra lo ya entregado.
const VER_ENTREGADOS = 'DELIVERED'


/**
 * Pantalla "Cocina": una tarjeta por mesa/orden activa (ni pagada ni cancelada), con sus
 * productos en el mismo orden en que se fueron pidiendo (más viejo primero), filtrable por
 * mesa. Se refresca sola en tiempo real (liveEvents.js) para reflejar pedidos nuevos sin que el cocinero
 * tenga que recargar la página a mano.
 *
 * Cada producto que cocina no ha entregado tiene un botón "Entregado a mesero" (estado
 * ENTREGADO_MESERO) para marcarlo de uno en uno, y cada tarjeta de orden tiene además
 * "Marcar todo entregado a mesero" para hacerlo de un jalón sobre todos sus productos
 * pendientes. Después el mesero lo marca como entregado a mesa / para llevar (ENTREGADO) — mismo endpoint (`PATCH /orders/{id}/items/{itemId}/estado`, una
 * llamada por producto) que puede usar el mesero desde el detalle de la orden (ver
 * `OrderDetail.jsx`); aquí lo puede usar además un rol cocinero (sección KITCHEN, sin
 * necesitar ORDERS/TAKEAWAY — ver el `@PreAuthorize` del endpoint).
 */
export default function Kitchen() {
  const { notify } = useNotify()
  const [orders, setOrders] = useState([])
  const [mesaFilter, setMesaFilter] = useState('')
  const [loading, setLoading] = useState(true)
  // Ids de items con la acción "Entregado" en curso, para deshabilitar su botón y no
  // duplicar la petición si el cocinero hace doble clic.
  const [updatingIds, setUpdatingIds] = useState(() => new Set())
  // Ids de ÓRDENES con "Marcar todo entregado" en curso, aparte de `updatingIds` (que es por
  // item) — deshabilita el botón de la tarjeta completa mientras corren todas sus llamadas.
  const [bulkUpdatingOrderIds, setBulkUpdatingOrderIds] = useState(() => new Set())

  // Vista "Ya entregados": lo que cocina entregó hoy (viene de otro endpoint, incluye órdenes ya cobradas).
  const [entregadosHoy, setEntregadosHoy] = useState([])
  const loadEntregados = () => getKitchenDeliveredToday().then((r) => setEntregadosHoy(r.data.data ?? [])).catch(() => setEntregadosHoy([]))
  useEffect(() => { if (mesaFilter === VER_ENTREGADOS) loadEntregados() }, [mesaFilter])
  useLiveRefresh(loadEntregados, { activo: mesaFilter === VER_ENTREGADOS, filtro: (e) => e.name === 'orden' })

  function load() {
    getKitchenOrders()
      .then((r) => setOrders(r.data.data ?? []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false))
  }
  // Tiempo real: cada orden nueva o producto agregado llega en cuanto se guarda (liveEvents.js).
  useEffect(() => { load() }, [])
  useLiveRefresh(load, { filtro: (e) => e.name === 'orden' })

  async function handleMarcarEntregado(orden, item) {
    setUpdatingIds((prev) => new Set(prev).add(item.id))
    try {
      await updateOrderItemStatus(orden.id, item.id, 'ENTREGADO_MESERO')
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo marcar como entregado a mesero', 'error')
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  /** Marca TODOS los productos pendientes de cocina de una orden como entregados a mesero, de un jalón. */
  async function handleMarcarTodoEntregado(orden) {
    const pendientes = (orden.items ?? []).filter(pendienteCocina)
    if (pendientes.length === 0) return
    setBulkUpdatingOrderIds((prev) => new Set(prev).add(orden.id))
    try {
      await Promise.all(pendientes.map((i) => updateOrderItemStatus(orden.id, i.id, 'ENTREGADO_MESERO')))
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo marcar todo como entregado a mesero', 'error')
    } finally {
      setBulkUpdatingOrderIds((prev) => {
        const next = new Set(prev)
        next.delete(orden.id)
        return next
      })
    }
  }

  // A cocina solo le interesa lo que tiene que preparar: en cuanto entrega un producto al
  // mesero, desaparece de su vista (y la orden completa, cuando ya entregó todo). Lo ya
  // entregado se consulta aparte con la opción "Ya entregados" del mismo select.
  const verEntregados = mesaFilter === VER_ENTREGADOS
  // En "Ya entregados" el backend ya manda solo lo entregado hoy; en la vista normal, lo pendiente.
  const itemsVisibles = (o) => (verEntregados ? (o.items ?? []) : (o.items ?? []).filter(pendienteCocina))
  const conPendientes = orders.filter((o) => (o.items ?? []).some(pendienteCocina))

  // El filtro de mesa solo tiene sentido sobre lo que de verdad hay que preparar ahora
  // mismo, no sobre todas las mesas del local (la mayoría estarán vacías).
  const mesasConOrden = [...new Map(
    conPendientes.filter((o) => o.mesa).map((o) => [o.mesa.id, o.mesa])
  ).values()].sort((a, b) => Number(a.numero) - Number(b.numero))
  const hayParaLlevar = conPendientes.some((o) => !o.mesa)

  const filteredOrders = verEntregados ? entregadosHoy : orders.filter((o) => {
    if (itemsVisibles(o).length === 0) return false
    if (!mesaFilter) return true
    if (mesaFilter === 'TAKEAWAY') return !o.mesa
    return String(o.mesa?.id ?? '') === mesaFilter
  })

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Cocina</h2>
        <select
          className={`!w-auto min-w-[16rem] rounded-xl border-2 px-4 py-3 text-lg font-bold shadow-md cursor-pointer focus:outline-none focus:ring-4 focus:ring-blue-200 ${
            mesaFilter ? 'border-blue-600 bg-blue-600 text-white' : 'border-blue-500 bg-white text-blue-800'}`}
          value={mesaFilter} onChange={(e) => setMesaFilter(e.target.value)}>
          <option value="" className="bg-white text-gray-900">Todas las mesas</option>
          {mesasConOrden.map((m) => (
            <option key={m.id} value={m.id} className="bg-white text-gray-900">Mesa {m.numero}{m.zona?.nombre ? ` (${m.zona.nombre})` : ''}</option>
          ))}
          {hayParaLlevar && <option value="TAKEAWAY" className="bg-white text-gray-900">Para llevar</option>}
          <option disabled className="bg-white text-gray-400">──────────</option>
          <option value={VER_ENTREGADOS} className="bg-white text-gray-900">✅ Ya entregados</option>
        </select>
      </div>

      {verEntregados && (
        <p className="mb-4 text-sm text-gray-500">Lo que entregaste hoy, lo más reciente primero. Vuelve a "Todas las mesas" para ver lo pendiente.</p>
      )}

      {!loading && filteredOrders.length === 0 && (
        <p className="text-gray-400 text-center py-12">{verEntregados ? 'Todavía no has entregado nada hoy' : 'Sin pedidos pendientes'}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredOrders.map((orden) => {
          const pendientes = (orden.items ?? []).filter(pendienteCocina)
          return (
          <div key={orden.id} className={`card border-2 ${ESTADO_STYLE[orden.estado] ?? 'border-gray-100'}`}>
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="font-bold text-gray-900">{orden.mesa ? `Mesa ${orden.mesa.numero}` : 'Para llevar'}</p>
                {orden.mesa?.zona?.nombre && (
                  <p className="text-xs text-gray-400">📍 {orden.mesa.zona.nombre}</p>
                )}
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white border border-gray-100">
                {ESTADO_LABEL[orden.estado] ?? orden.estado}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-xs text-gray-500">{orden.mesero?.name ?? '—'} · Abierta {fmtTime(orden.openedAt)}</p>
              {!verEntregados && pendientes.length > 0 && (
                <button
                  type="button"
                  className="text-xs font-semibold px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 shrink-0"
                  disabled={bulkUpdatingOrderIds.has(orden.id)}
                  onClick={() => handleMarcarTodoEntregado(orden)}
                >
                  ✅ Marcar todo entregado a mesero
                </button>
              )}
            </div>

            <div className="space-y-2">
              {itemsVisibles(orden).map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-2 text-sm border-t border-gray-100 pt-2">
                  <div>
                    <p className="text-base font-semibold text-gray-900">{Number(item.cantidad).toString()}× {item.productoNombre}</p>
                    {/* Modificadores grandes y resaltados: es lo que el cocinero más necesita leer de un vistazo. */}
                    {(item.modificadores ?? []).length > 0 && (
                      <ul className="mt-1 space-y-1">
                        {item.modificadores.map((m) => (
                          <li key={m.id} className="text-lg font-bold leading-tight text-red-700 bg-yellow-100 border-l-4 border-red-500 rounded px-2 py-1">
                            {m.grupoNombre && <span className="font-semibold text-gray-700">{m.grupoNombre}: </span>}
                            {m.nombre}
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.comensal && <p className="text-xs text-gray-400 mt-1">Comensal {item.comensal.numero}</p>}
                    {item.observaciones && (
                      <p className="mt-1 text-lg font-bold leading-tight text-red-700 bg-yellow-100 border-l-4 border-red-500 rounded px-2 py-1">
                        <span className="font-semibold text-gray-700">Nota: </span>{item.observaciones}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ITEM_ESTADO_STYLE[item.estado] ?? 'bg-gray-100 text-gray-500'}`}>
                      {itemEstadoLabel(item, orden)}
                    </span>
                    {verEntregados && item.entregadoCocinaAt && (
                      <span className="text-xs text-gray-500">a las {fmtTime(item.entregadoCocinaAt)}</span>
                    )}
                    {pendienteCocina(item) && (
                      <button
                        type="button"
                        className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40"
                        disabled={updatingIds.has(item.id)}
                        onClick={() => handleMarcarEntregado(orden, item)}
                      >
                        Entregado a mesero
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}
