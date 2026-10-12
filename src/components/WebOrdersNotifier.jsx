import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getWebPendingOrders, acceptWebOrder, cancelOrder } from '../api/ordenes'
import { useNotify } from '../context/NotifyContext'
import { playChime } from '../utils/sound'
import { useLiveRefresh } from '../utils/liveEvents'
import { useEscapeKey } from '../hooks/useEscapeKey'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))
const PAGO_LABEL = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia' }

/**
 * Aviso global de pedidos de la página web por aceptar (ver PublicSite.jsx): se actualiza en
 * tiempo real (ver liveEvents.js) y, mientras haya alguno, muestra un panel fijo arriba en cualquier pantalla con
 * "Aceptar" (queda a nombre de quien acepta y pasa a cocina) o "Rechazar" (cancela con
 * motivo, que el cliente ve en su página). Suena y avisa cuando llega uno nuevo.
 */
export default function WebOrdersNotifier() {
  const navigate = useNavigate()
  const { notify } = useNotify()
  const [orders, setOrders] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [minimized, setMinimized] = useState(false)
  // Pedido que se está rechazando (modal con el motivo, que el cliente ve en su página).
  const [rejecting, setRejecting] = useState(null)
  const [motivo, setMotivo] = useState('')
  useEscapeKey(() => setRejecting(null), !!rejecting)
  const seenRef = useRef(new Set())

  function load() {
    getWebPendingOrders()
      .then((r) => {
        const data = r.data.data ?? []
        const nuevos = data.filter((o) => !seenRef.current.has(o.id))
        seenRef.current = new Set(data.map((o) => o.id))
        setOrders(data)
        if (nuevos.length > 0) {
          setMinimized(false)
          playChime()
          const msg = `🌐 ${nuevos.length === 1 ? 'Nuevo pedido web' : `${nuevos.length} pedidos web nuevos`} por aceptar`
          notify(msg, 'info')
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            try { new Notification('Pedido web nuevo', { body: nuevos.map((o) => `${o.clienteNombre} · ${fmt(o.total)}`).join('\n') }) } catch { /* ignorar */ }
          }
        }
      })
      .catch(() => {})
  }

  useEffect(() => { load() }, [])
  useLiveRefresh(load, { filtro: (e) => e.name === 'orden' })

  async function aceptar(o) {
    setBusyId(o.id)
    try {
      await acceptWebOrder(o.id)
      notify(`Pedido #${o.id} aceptado — ya está en cocina`, 'success')
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo aceptar el pedido', 'error')
    } finally { setBusyId(null) }
  }

  function rechazar(o) {
    setMotivo('No podemos atender tu pedido en este momento')
    setRejecting(o)
  }

  async function confirmarRechazo() {
    const o = rejecting
    setRejecting(null)
    setBusyId(o.id)
    try {
      await cancelOrder(o.id, motivo.trim() || 'Pedido rechazado')
      notify(`Pedido #${o.id} rechazado`, 'success')
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo rechazar el pedido', 'error')
    } finally { setBusyId(null) }
  }

  if (orders.length === 0) return null

  const rejectModal = rejecting && (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={() => setRejecting(null)}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900">Rechazar pedido #{rejecting.id}</h3>
        <p className="text-sm text-gray-500 mt-1">{rejecting.clienteNombre} verá este motivo en su página.</p>
        <textarea className="input mt-3" rows={3} maxLength={255} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <div className="flex gap-2 justify-end mt-4">
          <button className="btn-secondary" onClick={() => setRejecting(null)}>Cancelar</button>
          <button className="btn-danger" onClick={confirmarRechazo}>Rechazar pedido</button>
        </div>
      </div>
    </div>
  )

  if (minimized) {
    return (
      <>
      {rejectModal}
      <button type="button" onClick={() => setMinimized(false)}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[95] rounded-full bg-blue-600 px-5 py-2.5 text-base font-extrabold text-white shadow-xl animate-pulse hover:bg-blue-700">
        🌐 {orders.length} pedido{orders.length === 1 ? '' : 's'} web por aceptar
      </button>
      </>
    )
  }

  return (
    <>
    {rejectModal}
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[95] w-[calc(100vw-2rem)] max-w-lg rounded-xl border-2 border-blue-500 bg-white shadow-2xl">
      <div className="flex items-center justify-between rounded-t-lg bg-blue-600 px-4 py-2.5 text-white">
        <p className="text-lg font-extrabold">🌐 {orders.length} pedido{orders.length === 1 ? '' : 's'} web por aceptar</p>
        <button type="button" title="Minimizar" onClick={() => setMinimized(true)} className="w-7 h-7 rounded-full hover:bg-white/20 font-bold">—</button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto divide-y divide-gray-100">
        {orders.map((o) => {
          const platillos = (o.items ?? []).filter((i) => !i.cargoExtra && i.estado !== 'CANCELADO')
          return (
            <div key={o.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-gray-900">#{o.id} · {o.clienteNombre}</p>
                  <p className="text-sm text-gray-600">
                    📞 <a href={`tel:${o.clienteTelefono}`} className="hover:underline">{o.clienteTelefono}</a>
                    {' · '}{o.tipoEntrega === 'DOMICILIO' ? '🛵 Domicilio' : '🛍️ Recoger'}
                    {' · '}{PAGO_LABEL[o.metodoPago] ?? o.metodoPago}
                  </p>
                  {o.direccion && <p className="text-sm text-gray-600">📍 {o.direccion}</p>}
                </div>
                <p className="font-bold text-gray-900 shrink-0">{fmt(o.total)}</p>
              </div>
              <ul className="mt-1 text-sm text-gray-700">
                {platillos.map((i) => (
                  <li key={i.id}>
                    <span className="font-semibold">{Number(i.cantidad)}×</span> {i.productoNombre}
                    {(i.modificadores ?? []).length > 0 && <span className="text-xs text-gray-500"> ({i.modificadores.map((m) => m.nombre).join(', ')})</span>}
                  </li>
                ))}
              </ul>
              {o.notas && <p className="text-sm text-gray-700 mt-1">📝 {o.notas}</p>}
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busyId === o.id} onClick={() => aceptar(o)}
                  className="flex-1 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">✅ Aceptar</button>
                <button type="button" disabled={busyId === o.id} onClick={() => rechazar(o)}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40">Rechazar</button>
                <button type="button" onClick={() => navigate(`/orders/${o.id}`)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Ver</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
    </>
  )
}
