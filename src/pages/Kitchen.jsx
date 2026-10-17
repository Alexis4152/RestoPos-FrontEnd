import { useEffect, useState } from 'react'
import { getKitchenOrders, getKitchenDeliveredToday } from '../api/kitchen'
import { updateOrderItemStatus } from '../api/ordenes'
import { useNotify } from '../context/NotifyContext'
import { useLiveRefresh } from '../utils/liveEvents'
import Icon from '../components/Icon'

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'

const ITEM_ESTADO = {
  PENDIENTE: { label: 'Pendiente', cls: 'bg-[#F1EFEA] text-gray-700' },
  PREPARANDO: { label: 'Preparando', cls: 'bg-[#E6EDF8] text-[#1E4585]' },
  LISTO: { label: 'Listo', cls: 'bg-[#E7F3EC] text-[#22603C]' },
  ENTREGADO_MESERO: { label: 'Entregado a mesero', cls: 'bg-purple-50 text-purple-800' },
  ENTREGADO: { label: 'Entregado', cls: 'bg-[#E7F3EC] text-[#22603C]' },
}
/** Minutos desde que se abrió la orden, y su color: a los 20 min ámbar, a los 35 rojo. */
function espera(desde) {
  if (!desde) return { texto: '', cls: 'text-gray-600' }
  const min = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60000))
  const texto = min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
  return { texto, cls: min >= 35 ? 'bg-red-100 text-red-800' : min >= 20 ? 'bg-[#FBF0DC] text-[#7A4A00]' : 'bg-[#F1EFEA] text-gray-700' }
}
const itemEstadoLabel = (item, orden) => {
  if (item.estado === 'ENTREGADO_MESERO') return 'Entregado a mesero'
  if (item.estado === 'ENTREGADO') return orden.mesa ? 'Entregado a mesa' : 'Entregado para llevar'
  return ITEM_ESTADO[item.estado]?.label ?? item.estado
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
  const [, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t) }, [])
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

  const filtros = [
    { key: '', label: 'Todo' },
    ...mesasConOrden.map((m) => ({ key: String(m.id), label: `Mesa ${m.numero}` })),
    ...(hayParaLlevar ? [{ key: 'TAKEAWAY', label: 'Para llevar' }] : []),
  ]

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-[28px] font-extrabold tracking-tight">Cocina</h1>
          <p className="text-sm text-gray-600">
            {verEntregados ? 'Lo que entregaste hoy, lo más reciente primero' : `${conPendientes.length} orden${conPendientes.length === 1 ? '' : 'es'} por preparar, la más antigua primero`}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2" aria-label="Filtrar comandas">
        {filtros.map((f) => (
          <button key={f.key || 'todo'} type="button" aria-pressed={mesaFilter === f.key} onClick={() => setMesaFilter(f.key)}
            className={`chip min-h-[44px] text-[15px] ${mesaFilter === f.key ? 'chip-on' : ''}`}>{f.label}</button>
        ))}
        <span className="flex-1" />
        <button type="button" aria-pressed={verEntregados} onClick={() => setMesaFilter(verEntregados ? '' : VER_ENTREGADOS)}
          className={`chip min-h-[44px] text-[15px] ${verEntregados ? 'chip-on' : ''}`}>Ya entregados hoy</button>
      </div>

      {!loading && filteredOrders.length === 0 && (
        <p className="text-gray-600 text-center py-14 text-lg">{verEntregados ? 'Todavía no has entregado nada hoy' : 'Sin pedidos pendientes'}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {filteredOrders.map((orden) => {
          const pendientes = (orden.items ?? []).filter(pendienteCocina)
          const t = espera(orden.openedAt)
          return (
            <article key={orden.id} className="bg-white border border-[#E4E1DA] rounded-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-[#FBFAF7] border-b border-[#ECE9E2]">
                <div className="flex-1 min-w-0">
                  <p className="text-xl font-extrabold">{orden.mesa ? `Mesa ${orden.mesa.numero}` : (orden.clienteNombre ? `Para llevar · ${orden.clienteNombre}` : 'Para llevar')}</p>
                  <p className="text-[13px] text-gray-600 truncate">
                    {[orden.mesa?.zona?.nombre, orden.mesero?.name, `#${orden.id}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {!verEntregados && (
                  <span className={`inline-flex items-center gap-1 text-sm font-extrabold px-2.5 py-1 rounded-lg ${t.cls}`}>
                    <Icon name="reloj" className="w-4 h-4" /> {t.texto}
                  </span>
                )}
              </div>

              <ul className="divide-y divide-[#F0EEE8]">
                {itemsVisibles(orden).map((item) => (
                  <li key={item.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start gap-3">
                      <span className="text-xl font-extrabold w-8 shrink-0">{Number(item.cantidad).toString()}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-lg font-bold leading-snug">{item.productoNombre}</p>
                        {item.comensal && <p className="text-[13px] text-gray-600">Comensal {item.comensal.numero}</p>}
                      </div>
                      <span className={`text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap ${ITEM_ESTADO[item.estado]?.cls ?? 'bg-[#F1EFEA] text-gray-700'}`}>
                        {itemEstadoLabel(item, orden)}
                      </span>
                    </div>
                    {/* Modificadores y notas grandes: es lo que el cocinero más necesita leer de un vistazo. */}
                    {(item.modificadores ?? []).length > 0 && (
                      <ul className="ml-11 space-y-1">
                        {item.modificadores.map((m) => (
                          <li key={m.id} className="text-lg font-extrabold leading-tight text-[#6B4100] bg-[#FBF0DC] rounded-lg px-2.5 py-1">
                            {m.grupoNombre && <span className="font-semibold text-gray-700">{m.grupoNombre}: </span>}{m.nombre}
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.observaciones && (
                      <p className="ml-11 text-lg font-extrabold leading-tight text-red-800 bg-red-50 rounded-lg px-2.5 py-1">
                        <span className="font-semibold text-gray-700">Nota: </span>{item.observaciones}
                      </p>
                    )}
                    {verEntregados && item.entregadoCocinaAt && <p className="ml-11 text-[13px] text-gray-600">Entregado a las {fmtTime(item.entregadoCocinaAt)}</p>}
                    {pendienteCocina(item) && (
                      <div className="ml-11">
                        <button type="button" disabled={updatingIds.has(item.id)} onClick={() => handleMarcarEntregado(orden, item)}
                          className="min-h-[44px] px-4 rounded-xl border border-purple-300 bg-purple-50 text-purple-800 text-sm font-bold hover:bg-purple-100 disabled:opacity-40">
                          Entregado a mesero
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {!verEntregados && pendientes.length > 1 && (
                <div className="px-4 py-3 border-t border-[#ECE9E2]">
                  <button type="button" disabled={bulkUpdatingOrderIds.has(orden.id)} onClick={() => handleMarcarTodoEntregado(orden)}
                    className="btn-primary w-full min-h-[48px] text-base">
                    {bulkUpdatingOrderIds.has(orden.id) ? '...' : `Todo listo · entregar ${pendientes.length} al mesero`}
                  </button>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
