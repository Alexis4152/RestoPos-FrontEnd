import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPickups, updateOrderItemStatus } from '../api/ordenes'
import { useNotify } from '../context/NotifyContext'
import { playChime } from '../utils/sound'
import { useLiveRefresh } from '../utils/liveEvents'


const ordenLabel = (o) => (o.mesa
  ? `Mesa ${o.mesa.numero}${o.mesa.zona?.nombre ? ` · ${o.mesa.zona.nombre}` : ''}`
  : `Para llevar #${o.id}`)

/**
 * Aviso global "Platos por recoger" para el mesero: en tiempo real (liveEvents.js) los productos de
 * SUS órdenes que cocina ya marcó como "Entregado a mesero" (ver `Kitchen.jsx`) y que él aún
 * no lleva a la mesa / al cliente. Mientras haya alguno, se queda un panel fijo abajo a la
 * derecha en cualquier pantalla; cuando llega un plato nuevo suena un pitido, sale un toast y,
 * si la pestaña no está a la vista, una notificación del navegador.
 *
 * "Ya lo llevé" marca esos productos como ENTREGADO (mismo endpoint que el detalle de la orden).
 */
export default function PickupNotifier() {
  const navigate = useNavigate()
  const { notify } = useNotify()
  const [orders, setOrders] = useState([])
  const [minimized, setMinimized] = useState(false)
  const [busyOrderId, setBusyOrderId] = useState(null)
  // Ids de productos ya avisados, para sonar solo con los nuevos (no en cada consulta).
  const seenRef = useRef(new Set())

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  function load() {
    getPickups()
      .then((r) => {
        const data = r.data.data ?? []
        const nuevos = []
        data.forEach((o) => (o.items ?? []).forEach((i) => {
          if (!seenRef.current.has(i.id)) nuevos.push({ orden: o, item: i })
        }))
        seenRef.current = new Set(data.flatMap((o) => (o.items ?? []).map((i) => i.id)))
        setOrders(data)
        if (nuevos.length > 0) {
          const destinos = [...new Set(nuevos.map((n) => ordenLabel(n.orden)))].join(', ')
          const msg = `🍽️ ${nuevos.length} plato${nuevos.length === 1 ? '' : 's'} por recoger — ${destinos}`
          setMinimized(false)
          playChime()
          notify(msg, 'info')
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            try { new Notification('Platos por recoger', { body: msg.replace('🍽️ ', '') }) } catch { /* ignorar */ }
          }
        }
      })
      .catch(() => { /* sin red o sin permiso: se reintenta en la siguiente consulta */ })
  }

  // Tiempo real: se recarga cuando el servidor avisa que cambió una orden (ver liveEvents.js).
  useEffect(() => { load() }, [])
  useLiveRefresh(load, { filtro: (e) => e.name === 'orden' })

  async function handleLlevado(orden) {
    setBusyOrderId(orden.id)
    try {
      await Promise.all((orden.items ?? []).map((i) => updateOrderItemStatus(orden.id, i.id, 'ENTREGADO')))
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo marcar como entregado', 'error')
    } finally {
      setBusyOrderId(null)
    }
  }

  const total = orders.reduce((sum, o) => sum + (o.items?.length ?? 0), 0)
  if (total === 0) return null

  if (minimized) {
    return (
      <button type="button" onClick={() => setMinimized(false)}
        className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-full bg-orange-500 px-4 py-3 text-base font-extrabold text-white shadow-xl animate-pulse hover:bg-orange-600">
        🍽️ {total} por recoger
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-[90] w-[calc(100vw-2rem)] max-w-sm rounded-xl border-2 border-orange-400 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-2 rounded-t-lg bg-orange-500 px-4 py-2.5 text-white">
        <p className="text-lg font-extrabold">🍽️ {total} plato{total === 1 ? '' : 's'} por recoger</p>
        <button type="button" title="Minimizar" onClick={() => setMinimized(true)}
          className="w-7 h-7 rounded-full hover:bg-white/20 font-bold leading-none">—</button>
      </div>
      <div className="max-h-[50vh] overflow-y-auto divide-y divide-gray-100">
        {orders.map((o) => (
          <div key={o.id} className="px-4 py-3">
            <p className="text-base font-bold text-gray-900">{ordenLabel(o)}</p>
            <ul className="mt-1 space-y-0.5">
              {(o.items ?? []).map((i) => (
                <li key={i.id} className="text-sm text-gray-700">
                  <span className="font-semibold">{Number(i.cantidad).toString()}×</span> {i.productoNombre}
                  {(i.modificadores ?? []).length > 0 && (
                    <span className="text-xs text-gray-500"> ({i.modificadores.map((m) => m.nombre).join(', ')})</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busyOrderId === o.id} onClick={() => handleLlevado(o)}
                className="flex-1 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
                ✅ Ya lo llevé
              </button>
              <button type="button" onClick={() => navigate(`/orders/${o.id}`)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Ver orden
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
