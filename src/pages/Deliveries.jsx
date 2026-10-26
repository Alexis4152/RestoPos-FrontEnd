import { useEffect, useRef, useState } from 'react'
import { getDeliveries, getDeliveryTransferInfo, takeDelivery, releaseDelivery, deliverOrder, startDelivery, getDeliveryHistory } from '../api/deliveries'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { playChime } from '../utils/sound'
import { useLiveRefresh } from '../utils/liveEvents'
import { useEscapeKey } from '../hooks/useEscapeKey'
import ComprobanteImagen from '../components/ComprobanteImagen'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—')
const PAGO_PREF = { EFECTIVO: '💵 Efectivo', TARJETA: '💳 Tarjeta', TRANSFERENCIA: '🏦 Transferencia' }
const POR_PAGINA = 10
const fmtFechaHora = (d) => (d ? new Date(d).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null)

/** Costo de envío del pedido (cargos extra no cancelados). */
const costoEnvio = (o) => (o.items ?? [])
  .filter((i) => i.cargoExtra && i.estado !== 'CANCELADO')
  .reduce((s, i) => s + Number(i.subtotal ?? 0), 0)

// Pedido web por transferencia: el cliente sube la foto del comprobante desde su seguimiento.
const esTransferWeb = (o) => o.origen === 'WEB' && o.metodoPago === 'TRANSFERENCIA'
// Si el cliente dijo que su transferencia NO incluye el envío, el repartidor lo cobra en efectivo.
const envioEnEfectivo = (o) => (o.comprobantePath && o.transferenciaIncluyeEnvio === false ? costoEnvio(o) : 0)

/** ¿Ya salieron de cocina todos sus platillos? (para saber si el pedido está listo para llevarse). */
// ¿El restaurante ya le entregó la bolsa al repartidor? ("Entregado para llevar" en el punto
// de venta: todos los platillos en ENTREGADO). Solo entonces se habilita "Voy en camino".
const entregadoAlRepartidor = (o) => (o.items ?? [])
  .filter((i) => !i.cargoExtra && i.estado !== 'CANCELADO')
  .every((i) => i.estado === 'ENTREGADO')

/** Etapa del envío para el repartidor, de la más temprana a la más avanzada. */
function etapa(o) {
  if (o.enCaminoAt) return { label: '🛵 En camino', cls: 'bg-purple-100 text-purple-800' }
  if (entregadoAlRepartidor(o)) return { label: '📦 Ya te lo entregaron — sal cuando estés listo', cls: 'bg-blue-100 text-blue-800' }
  if (listoEnCocina(o)) return { label: '✅ Listo en cocina — espera a que te lo entreguen', cls: 'bg-green-100 text-green-800' }
  return { label: '⏳ En preparación', cls: 'bg-yellow-100 text-yellow-800' }
}

const listoEnCocina = (o) => (o.items ?? [])
  .filter((i) => !i.cargoExtra && i.estado !== 'CANCELADO')
  .every((i) => ['LISTO', 'ENTREGADO_MESERO', 'ENTREGADO'].includes(i.estado))

/**
 * Pantalla "Entregas" del repartidor (sección DELIVERY), pensada para usarse en el celular:
 * envíos a domicilio pendientes (de la página web o capturados en "Para llevar" con envío),
 * "Lo llevo yo" para apartarlos, "Voy en camino" en cuanto el restaurante se lo entrega (desde
 * ahí el cliente lo ve "En camino") y "Entregar" para marcarlos como entregados diciendo cómo
 * pagó el cliente (efectivo con cuánto, o transferencia). El repartidor NO maneja caja: el
 * dinero lo entrega en el restaurante y la caja lo cobra en su propio corte ("Dinero por
 * recibir de repartidores" en Para llevar). "Historial": sus entregas y si la caja ya recibió
 * el dinero de cada una.
 */
export default function Deliveries() {
  const { user } = useAuth()
  const { notify } = useNotify()
  const [orders, setOrders] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState('mias')
  // Historial: sus entregas (por default los últimos 7 días); también da lo que trae por entregar en caja.
  const [historial, setHistorial] = useState([])
  const [rango, setRango] = useState({ desde: '', hasta: '' })
  const [pagina, setPagina] = useState(0)
  const [detalle, setDetalle] = useState(null) // entrega del historial abierta
  const [busyId, setBusyId] = useState(null)
  const [cobro, setCobro] = useState(null) // orden que se está entregando
  const [soltando, setSoltando] = useState(null) // orden que se suelta (pide el motivo)
  const [motivo, setMotivo] = useState('')
  useEscapeKey(() => { if (detalle) setDetalle(null); else if (soltando) setSoltando(null); else setCobro(null) }, !!(cobro || soltando || detalle))
  const seenRef = useRef(null)

  function load() {
    getDeliveries()
      .then((r) => {
        const data = r.data.data ?? []
        // Pitido cuando aparece un envío nuevo disponible (no en la primera carga).
        const ids = new Set(data.map((o) => o.id))
        if (seenRef.current && data.some((o) => !seenRef.current.has(o.id) && !o.repartidor)) {
          playChime()
          notify('🛵 Hay un pedido nuevo para entregar', 'info')
        }
        seenRef.current = ids
        setOrders(data)
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }
  function loadHistorial() {
    getDeliveryHistory({ desde: rango.desde || undefined, hasta: rango.hasta || undefined })
      .then((r) => setHistorial(r.data.data ?? [])).catch(() => setHistorial([]))
  }

  useEffect(() => { load() }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadHistorial(); setPagina(0) }, [rango.desde, rango.hasta])
  useLiveRefresh(() => { load(); loadHistorial() }, { filtro: (e) => e.name === 'orden' })

  // Lo entregado que la caja todavía no recibe: el dinero lo trae él.
  const porEntregar = historial.filter((o) => o.estado !== 'PAGADA' && o.estado !== 'CANCELADA')
  const efectivoPorEntregar = porEntregar.reduce((s, o) => s + efectivoDe(o), 0)

  const myId = user?.userId
  const mias = orders.filter((o) => o.repartidor?.id === myId)
  const disponibles = orders.filter((o) => !o.repartidor)
  const deOtros = orders.filter((o) => o.repartidor && o.repartidor.id !== myId)
  const lista = tab === 'mias' ? mias : tab === 'disponibles' ? disponibles : []

  async function tomar(o) {
    setBusyId(o.id)
    try {
      await takeDelivery(o.id)
      notify(`Pedido #${o.id} es tuyo. Cuando el restaurante te lo entregue, marca "Voy en camino".`, 'success')
      setTab('mias')
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo tomar el pedido', 'error') }
    finally { setBusyId(null) }
  }

  async function enCamino(o) {
    setBusyId(o.id)
    try {
      await startDelivery(o.id)
      notify(`Pedido #${o.id}: el cliente ya ve que vas en camino`, 'success')
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo marcar en camino', 'error') }
    finally { setBusyId(null) }
  }

  // Soltar pide el motivo; se puede aunque ya vayas en camino: el pedido vuelve a estar
  // disponible para otro repartidor y el cliente ve que se le busca otro.
  async function soltar() {
    const o = soltando
    setBusyId(o.id)
    try {
      await releaseDelivery(o.id, motivo.trim())
      setSoltando(null)
      notify('Pedido liberado: ya lo puede tomar otro repartidor', 'success')
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo soltar el pedido', 'error') }
    finally { setBusyId(null) }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-2xl font-bold text-gray-900">🛵 Entregas</h2>
      </div>

      {porEntregar.length > 0 && (
        <p className="mb-4 rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          {efectivoPorEntregar > 0
            ? <>Traes <b>{fmt(efectivoPorEntregar)}</b> en efectivo para entregar en caja</>
            : <>Tienes entregas por reportar en caja</>}
          {' '}({porEntregar.length} pedido{porEntregar.length === 1 ? '' : 's'}). Cuando lo entregues, la caja lo marca como recibido.
        </p>
      )}

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('mias')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 ${tab === 'mias' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-200'}`}>
          Mis entregas ({mias.length})
        </button>
        <button onClick={() => setTab('disponibles')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 ${tab === 'disponibles' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-200'}`}>
          Por tomar ({disponibles.length})
        </button>
        <button onClick={() => setTab('historial')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 ${tab === 'historial' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-200'}`}>
          Historial
        </button>
      </div>

      {tab === 'historial' && (
        <section aria-label="Historial de entregas" className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold text-gray-600">Desde
              <input type="date" className="input mt-1" value={rango.desde} onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))} />
            </label>
            <label className="text-xs font-semibold text-gray-600">Hasta
              <input type="date" className="input mt-1" value={rango.hasta} onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))} />
            </label>
            {(rango.desde || rango.hasta) && (
              <button type="button" className="text-sm font-semibold text-purple-700 hover:underline mb-2" onClick={() => setRango({ desde: '', hasta: '' })}>Últimos 7 días</button>
            )}
          </div>
          <p className="text-sm text-gray-600">
            {historial.length} entrega{historial.length === 1 ? '' : 's'} · {fmt(historial.reduce((s, o) => s + Number(o.total ?? 0), 0))} en total
          </p>
          {historial.length === 0 && <p className="text-center text-gray-400 py-10">Sin entregas en estas fechas.</p>}
          {historial.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA).map((o) => {
            const recibido = o.estado === 'PAGADA'
            return (
              <button type="button" key={o.id} onClick={() => setDetalle(o)} aria-label={`Ver detalle del pedido ${o.id}`}
                className="card border border-gray-100 !p-4 w-full text-left hover:border-purple-300">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900">#{o.id} · {o.clienteNombre ?? 'Cliente'}</p>
                    <p className="text-xs text-gray-500">
                      Entregado {new Date(o.entregadaAt).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {o.metodoPago ? ` · ${PAGO_PREF[o.metodoPago] ?? o.metodoPago}` : ''}
                    </p>
                    {o.direccion && <p className="text-xs text-gray-500 truncate">📍 {o.direccion}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-extrabold">{fmt(o.total)}</p>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${recibido ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>
                      {recibido ? 'Entregado en caja' : 'Por entregar en caja'}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
          {historial.length > POR_PAGINA && (
            <nav aria-label="Páginas del historial" className="flex items-center justify-between gap-2 pt-1">
              <button type="button" className="btn-secondary min-h-[44px]" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>← Anterior</button>
              <span className="text-sm text-gray-600">Página {pagina + 1} de {Math.ceil(historial.length / POR_PAGINA)}</span>
              <button type="button" className="btn-secondary min-h-[44px]" disabled={(pagina + 1) * POR_PAGINA >= historial.length}
                onClick={() => setPagina((p) => p + 1)}>Siguiente →</button>
            </nav>
          )}
        </section>
      )}
      {detalle && <DetalleEntrega o={detalle} onClose={() => setDetalle(null)} />}

      {loaded && tab !== 'historial' && lista.length === 0 && (
        <p className="text-center text-gray-400 py-12">
          {tab === 'mias' ? 'No llevas ningún pedido. Revisa "Por tomar".' : 'No hay pedidos a domicilio por tomar.'}
        </p>
      )}

      <div className="space-y-3">
        {lista.map((o) => {
          const et = etapa(o)
          const entregado = entregadoAlRepartidor(o)
          const pagado = o.estado === 'PAGADA'
          // Transferencia web con comprobante: para el repartidor ya está pagado (se registra al entregar).
          const transferido = !pagado && esTransferWeb(o) && !!o.comprobantePath
          const envioCash = transferido ? envioEnEfectivo(o) : 0
          const platillos = (o.items ?? []).filter((i) => !i.cargoExtra && i.estado !== 'CANCELADO')
          return (
            <div key={o.id} className="card border-2 border-gray-100">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-bold text-gray-900">#{o.id} · {o.clienteNombre ?? 'Cliente'}</p>
                  <p className="text-xs text-gray-500">Pedido {fmtTime(o.openedAt)}{o.origen === 'WEB' ? ' · 🌐 web' : ''}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-extrabold text-gray-900">{fmt(o.total)}</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${pagado || transferido ? 'bg-green-600 text-white' : 'bg-orange-500 text-white'}`}>
                    {pagado ? 'PAGADO' : transferido ? 'PAGADO · TRANSF.' : 'POR COBRAR'}
                  </span>
                  {envioCash > 0 && <p className="text-xs font-semibold text-orange-700 mt-1">Cobra envío {fmt(envioCash)} en efectivo</p>}
                </div>
              </div>

              <span className={`inline-block mt-2 text-xs font-bold px-2 py-0.5 rounded-md ${et.cls}`}>{et.label}</span>

              {o.direccion && (
                <a className="block mt-2 text-sm text-blue-700 hover:underline" target="_blank" rel="noreferrer"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.direccion)}`}>
                  📍 {o.direccion}
                </a>
              )}
              {o.clienteTelefono && (
                <a className="block mt-1 text-sm text-blue-700 hover:underline" href={`tel:${o.clienteTelefono}`}>📞 {o.clienteTelefono}</a>
              )}
              {o.metodoPago && !pagado && <p className="text-sm text-gray-600 mt-1">El cliente dijo que paga con: <span className="font-semibold">{PAGO_PREF[o.metodoPago] ?? o.metodoPago}</span></p>}
              {o.metodoPago === 'EFECTIVO' && !pagado && o.pagaCon != null && (
                <p className="text-sm mt-1 rounded-lg bg-green-50 text-green-800 px-2.5 py-1.5">
                  💵 Paga con <b>{fmt(o.pagaCon)}</b>{Number(o.pagaCon) > Number(o.total) ? <> · lleva <b>{fmt(Number(o.pagaCon) - Number(o.total))}</b> de cambio</> : ' (exacto)'}
                </p>
              )}
              {esTransferWeb(o) && !pagado && !o.comprobantePath && (
                <p className="text-xs font-semibold text-orange-700 mt-1">⏳ El cliente aún no sube el comprobante de su transferencia</p>
              )}
              {o.notas && <p className="text-sm text-gray-700 mt-1">📝 {o.notas}</p>}

              <ul className="mt-2 text-sm text-gray-700 border-t border-gray-100 pt-2">
                {platillos.map((i) => (
                  <li key={i.id}><span className="font-semibold">{Number(i.cantidad)}×</span> {i.productoNombre}</li>
                ))}
              </ul>

              <div className="mt-3 flex gap-2">
                {tab === 'disponibles' ? (
                  <button disabled={busyId === o.id} onClick={() => tomar(o)}
                    className="flex-1 rounded-xl bg-purple-600 py-2.5 font-bold text-white hover:bg-purple-700 disabled:opacity-40">🛵 Lo llevo yo</button>
                ) : (
                  <>
                    {/* 1) Esperar a que el restaurante lo entregue → 2) "Voy en camino" → 3) Entregar y cobrar */}
                    {!o.enCaminoAt ? (
                      <button disabled={busyId === o.id || !entregado} onClick={() => enCamino(o)}
                        title={entregado ? undefined : 'Se habilita cuando el restaurante te entregue el pedido'}
                        className="flex-1 rounded-xl bg-purple-600 py-2.5 font-bold text-white hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed">
                        {entregado ? '🛵 Voy en camino' : '⏳ Esperando que te lo entreguen'}
                      </button>
                    ) : (
                      <button disabled={busyId === o.id} onClick={() => setCobro(o)}
                        className="flex-1 rounded-xl bg-green-600 py-2.5 font-bold text-white hover:bg-green-700 disabled:opacity-40">
                        ✅ Entregar
                      </button>
                    )}
                    <button disabled={busyId === o.id} onClick={() => { setMotivo(''); setSoltando(o) }}
                      className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">Soltar</button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {tab === 'disponibles' && deOtros.length > 0 && (
        <p className="text-xs text-gray-400 mt-4">
          En camino con otros repartidores: {deOtros.map((o) => `#${o.id} (${o.repartidor.name})`).join(', ')}
        </p>
      )}

      {soltando && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setSoltando(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="soltar-titulo" onClick={(e) => e.stopPropagation()}
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-5 space-y-3">
            <h3 id="soltar-titulo" className="text-lg font-extrabold">Soltar el pedido #{soltando.id}</h3>
            {soltando.enCaminoAt && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                <b>Ya vas en camino con este pedido.</b> Si lo sueltas, el cliente verá que le estamos buscando otro repartidor y
                quien lo tome tendrá que pasar por la comida. ¿Seguro que no puedes llevarlo?
              </p>
            )}
            <p className="text-sm text-gray-600">
              Vuelve a quedar disponible para otro repartidor y la caja recibe el aviso con tu motivo.
            </p>
            <div className="flex flex-wrap gap-2">
              {['Se ponchó la llanta', 'Falla de la moto', 'Emergencia personal', 'No encuentro la dirección', 'Tengo demasiados pedidos'].map((m) => (
                <button key={m} type="button" aria-pressed={motivo === m} onClick={() => setMotivo(m)}
                  className={`min-h-[40px] px-3 rounded-full text-sm font-semibold border ${motivo === m ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700'}`}>
                  {m}
                </button>
              ))}
            </div>
            <label htmlFor="motivo-soltar" className="block text-sm font-semibold text-gray-700">Motivo <span className="text-red-600">*</span></label>
            <textarea id="motivo-soltar" className="input" rows={2} maxLength={100} placeholder="¿Por qué lo sueltas?"
              value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setSoltando(null)}>Volver</button>
              <button type="button" className="btn-danger" disabled={motivo.trim().length < 3 || busyId === soltando.id} onClick={soltar}>
                {soltando.enCaminoAt ? 'Sí, soltar pedido' : 'Soltar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cobro && (
        <CobroModal orden={cobro} onClose={() => setCobro(null)}
          onDone={() => { setCobro(null); load(); loadHistorial() }} />
      )}
    </div>
  )
}

/** Captura del efectivo recibido con el cambio a entregar o lo que falta por cobrar. */
function EfectivoRecibido({ label, recibido, setRecibido, recibidoExcede, cambio, falta }) {
  return (
    <>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <input className="input mt-1" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00"
        value={recibido} onChange={(e) => setRecibido(e.target.value)} />
      {recibidoExcede && (
        <p className="text-red-600 text-xs mt-1">El número es excesivamente grande — el máximo permitido es 9,999,999,999.99</p>
      )}
      {!recibidoExcede && recibido !== '' && (
        cambio != null && cambio >= 0 ? (
          <div className="mt-2 rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-center overflow-hidden">
            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Cambio a entregar</p>
            <p className="font-bold text-green-700 text-2xl mt-0.5 break-words">{fmt(cambio)}</p>
          </div>
        ) : (
          <div className="mt-2 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-center overflow-hidden">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Falta por cobrar</p>
            <p className="font-bold text-red-600 text-2xl mt-0.5 break-words">{fmt(falta)}</p>
          </div>
        )
      )}
    </>
  )
}

/** Efectivo que el repartidor trae de un pedido entregado (todo, o solo el envío si la transferencia no lo incluyó). */
function efectivoDe(o) {
  if (o.metodoPago === 'EFECTIVO') return Number(o.total ?? 0)
  if (o.metodoPago === 'TRANSFERENCIA') return envioEnEfectivo(o)
  return 0
}

/**
 * Modal de entrega: si falta pagar, el repartidor dice cómo pagó el cliente (efectivo con
 * cuánto, para el cambio, o transferencia). No cobra en caja: el dinero lo entrega en el
 * restaurante. En pedidos web la transferencia se comprueba con la foto del cliente.
 */
function CobroModal({ orden, onClose, onDone }) {
  const { notify } = useNotify()
  const pagado = orden.estado === 'PAGADA'
  const [metodo, setMetodo] = useState(orden.metodoPago === 'TRANSFERENCIA' ? 'TRANSFER' : 'CASH')
  const [recibido, setRecibido] = useState(orden.pagaCon != null ? String(Number(orden.pagaCon)) : '')
  const [referencia, setReferencia] = useState('')
  const [banco, setBanco] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { getDeliveryTransferInfo().then((r) => setBanco(r.data.data ?? {})).catch(() => setBanco({})) }, [])

  // Mismas reglas que "Registrar pago" en el detalle de la orden (OrderDetail.jsx): en
  // efectivo es obligatorio capturar con cuánto paga, el cambio no puede quedar negativo y
  // el monto no puede pasar del máximo de Pago.recibido (NUMERIC(12,2)).
  const total = Number(orden.total)
  // Transferencia de pedido web: se comprueba con la foto que sube el cliente (no con folio).
  // Si el cliente dijo que no incluye el envío, el envío se cobra aquí en efectivo.
  const transferWeb = metodo === 'TRANSFER' && esTransferWeb(orden)
  const sinComprobante = transferWeb && !orden.comprobantePath
  const envioCash = transferWeb ? envioEnEfectivo(orden) : 0
  // Lo que se cobra en efectivo: todo (efectivo) o solo el envío (transferencia sin envío).
  const montoEfectivo = metodo === 'CASH' ? total : envioCash
  const pideEfectivo = montoEfectivo > 0
  const recibidoNum = recibido === '' ? null : Number(recibido)
  const cambio = pideEfectivo && recibidoNum != null && !Number.isNaN(recibidoNum) ? recibidoNum - montoEfectivo : null
  const recibidoExcede = pideEfectivo && recibidoNum != null && recibidoNum > 9999999999.99
  const faltaEfectivo = pideEfectivo && (cambio === null || cambio < 0)
  const bloqueado = saving || (!pagado && (faltaEfectivo || recibidoExcede || sinComprobante))

  async function confirmar() {
    setSaving(true)
    try {
      await deliverOrder(orden.id, pagado ? {} : {
        metodo,
        recibido: pideEfectivo ? recibidoNum : undefined,
        referencia: metodo === 'TRANSFER' && !transferWeb ? referencia.trim() || undefined : undefined,
      })
      notify(pagado ? `Pedido #${orden.id} entregado`
        : `Pedido #${orden.id} entregado. ${montoEfectivo > 0 ? `Lleva ${fmt(montoEfectivo)} en efectivo a la caja.` : 'Avisa en caja que se pagó por transferencia.'}`, 'success')
      onDone()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo marcar como entregado', 'error')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-bold">Entregar pedido #{orden.id}</h3>
        <p className="text-sm text-gray-500">{orden.clienteNombre}</p>

        {pagado && (
          <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-center">
            <p className="text-xs font-semibold text-gray-500 uppercase">Ya pagado</p>
            <p className="text-3xl font-extrabold text-gray-900">{fmt(total)}</p>
          </div>
        )}

        {!pagado && (
          <>
            <div className="grid grid-cols-2 gap-2 mt-4">
              {[['CASH', '💵 Efectivo'], ['TRANSFER', '🏦 Transferencia']].map(([k, label]) => (
                <button key={k} type="button" onClick={() => setMetodo(k)}
                  className={`rounded-xl border-2 py-3 font-bold ${metodo === k ? 'border-purple-600 bg-purple-50 text-purple-800' : 'border-gray-200 text-gray-700'}`}>{label}</button>
              ))}
            </div>
            <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-center">
              <p className="text-xs font-semibold text-gray-500 uppercase">Total del pedido</p>
              <p className="text-3xl font-extrabold text-gray-900">{fmt(total)}</p>
            </div>

            {metodo === 'CASH' ? (
              <div className="mt-4">
                <EfectivoRecibido label="¿Con cuánto paga el cliente?" recibido={recibido} setRecibido={setRecibido}
                  recibidoExcede={recibidoExcede} cambio={cambio} falta={montoEfectivo - (recibidoNum ?? 0)} />
              </div>
            ) : transferWeb ? (
              <div className="mt-4">
                {orden.comprobantePath ? (
                  <>
                    <p className="text-sm font-semibold text-green-800">✅ El cliente subió su comprobante</p>
                    <div className="mt-2"><ComprobanteImagen ordenId={orden.id} version={orden.comprobanteAt} /></div>
                    {envioCash > 0 ? (
                      <div className="mt-3 rounded-xl bg-orange-50 border border-orange-200 p-3">
                        <p className="text-sm text-orange-900">La transferencia cubre {fmt(total - envioCash)}. <b>Cobra el envío en efectivo: {fmt(envioCash)}</b></p>
                        <div className="mt-2">
                          <EfectivoRecibido label="¿Con cuánto paga el envío?" recibido={recibido} setRecibido={setRecibido}
                            recibidoExcede={recibidoExcede} cambio={cambio} falta={envioCash - (recibidoNum ?? 0)} />
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-green-800 bg-green-50 rounded-lg px-3 py-2">La transferencia incluye el total, no cobres nada en efectivo.</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-orange-800 bg-orange-50 rounded-lg px-3 py-2">
                    El cliente todavía no sube el comprobante de su transferencia. Pídele que lo suba en el seguimiento de su pedido, o cóbrale en efectivo.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4">
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
                  <p className="font-semibold mb-1">El cliente transfiere a la cuenta de la tienda:</p>
                  {banco === null ? <p>Cargando...</p> : banco.clabe ? (
                    <>
                      {banco.banco && <p>Banco: <span className="font-medium">{banco.banco}</span></p>}
                      {banco.titular && <p>Titular: <span className="font-medium">{banco.titular}</span></p>}
                      <p>CLABE / cuenta: <span className="font-mono font-bold select-all">{banco.clabe}</span></p>
                    </>
                  ) : <p>La tienda no tiene datos bancarios configurados (Configuración → Página web).</p>}
                </div>
                <label className="block text-sm font-medium text-gray-700 mt-3">Referencia / folio de la transferencia (opcional)</label>
                <input className="input mt-1" maxLength={100} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
                <p className="text-xs text-gray-500 mt-1">Confirma en el celular del cliente que la transferencia se hizo antes de entregar.</p>
              </div>
            )}
          </>
        )}

        <div className="flex gap-2 mt-5">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
          <button type="button" disabled={bloqueado} onClick={confirmar}
            className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title={pagado ? undefined
              : sinComprobante ? 'El cliente todavía no sube el comprobante de su transferencia'
              : recibidoExcede ? 'El monto capturado es excesivamente grande'
              : faltaEfectivo ? 'Captura cuánto pagó el cliente en efectivo' : undefined}>
            {saving ? 'Procesando...' : 'Confirmar entrega'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Detalle de una entrega del historial: cliente, lo que pidió, cobro y tiempos. */
function DetalleEntrega({ o, onClose }) {
  const items = (o.items ?? []).filter((i) => i.estado !== 'CANCELADO')
  const productos = items.filter((i) => !i.cargoExtra)
  const envio = items.filter((i) => i.cargoExtra).reduce((s, i) => s + Number(i.subtotal ?? 0), 0)
  const recibido = o.estado === 'PAGADA'
  const tiempos = [
    ['Pedido', o.openedAt], ['Lo tomaste', o.tomadaAt], ['Salió en camino', o.enCaminoAt], ['Entregado', o.entregadaAt],
  ].filter(([, t]) => t)
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="detalle-entrega-titulo" onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl max-h-[92vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="detalle-entrega-titulo" className="text-xl font-extrabold">Pedido #{o.id}</h2>
            <span className={`inline-block mt-1 text-xs font-bold px-2 py-0.5 rounded-md ${recibido ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>
              {recibido ? 'Entregado en caja' : 'Por entregar en caja'}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="w-10 h-10 rounded-full hover:bg-gray-100 text-gray-500">✕</button>
        </div>

        <section className="space-y-1 text-sm">
          <h3 className="font-bold text-gray-900">Cliente</h3>
          <p className="text-gray-800">{o.clienteNombre ?? 'Sin nombre'}</p>
          {o.clienteTelefono && <a href={`tel:${o.clienteTelefono}`} className="block text-purple-700 font-semibold">📞 {o.clienteTelefono}</a>}
          {o.direccion && <p className="text-gray-700">📍 {o.direccion}</p>}
          {o.notas && <p className="text-gray-600 italic">"{o.notas}"</p>}
        </section>

        <section className="space-y-2 text-sm">
          <h3 className="font-bold text-gray-900">Lo que pidió</h3>
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
            {productos.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{Number(i.cantidad)} × {i.productoNombre}</p>
                  {(i.modificadores ?? []).length > 0 && (
                    <p className="text-xs text-gray-600">{i.modificadores.map((m) => `${m.grupoNombre} ${m.nombre}`).join(' · ')}</p>
                  )}
                  {i.observaciones && <p className="text-xs text-gray-500 italic">{i.observaciones}</p>}
                </div>
                <span className="font-semibold whitespace-nowrap">{fmt(i.subtotal)}</span>
              </li>
            ))}
          </ul>
          {envio > 0 && <p className="flex justify-between text-gray-600"><span>Envío</span><span>{fmt(envio)}</span></p>}
          <p className="flex justify-between text-base font-extrabold"><span>Total</span><span>{fmt(o.total)}</span></p>
        </section>

        <section className="space-y-1 text-sm">
          <h3 className="font-bold text-gray-900">Cobro</h3>
          <p className="text-gray-700">{PAGO_PREF[o.metodoPago] ?? o.metodoPago ?? 'Sin forma de pago'}</p>
          {o.metodoPago === 'EFECTIVO' && o.pagaCon != null && Number(o.pagaCon) > Number(o.total) && (
            <p className="text-gray-700">Pagó con {fmt(o.pagaCon)} · cambio {fmt(Number(o.pagaCon) - Number(o.total))}</p>
          )}
        </section>

        {tiempos.length > 0 && (
          <section className="space-y-1 text-sm">
            <h3 className="font-bold text-gray-900">Tiempos</h3>
            {tiempos.map(([label, t]) => (
              <p key={label} className="flex justify-between text-gray-700"><span>{label}</span><span>{fmtFechaHora(t)}</span></p>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
