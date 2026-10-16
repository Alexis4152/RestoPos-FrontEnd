import { useEffect, useRef, useState } from 'react'
import { getDeliveries, getDeliveryTransferInfo, takeDelivery, releaseDelivery, deliverOrder, startDelivery } from '../api/deliveries'
import { getOpenCashCut, openCashCut, getCashCutSummary, closeCashCut } from '../api/cashCuts'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { playChime } from '../utils/sound'
import { useLiveRefresh } from '../utils/liveEvents'
import { useEscapeKey } from '../hooks/useEscapeKey'
import ComprobanteImagen from '../components/ComprobanteImagen'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—')
const PAGO_PREF = { EFECTIVO: '💵 Efectivo', TARJETA: '💳 Tarjeta', TRANSFERENCIA: '🏦 Transferencia' }

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
 * ahí el cliente lo ve "En camino") y "Entregar" para marcarlos como
 * entregados cobrando lo que falte en efectivo (con cambio) o por transferencia a la cuenta de
 * la tienda. El cobro cae en el corte de caja del repartidor, así que antes debe iniciar turno.
 */
export default function Deliveries() {
  const { user } = useAuth()
  const { notify } = useNotify()
  const [orders, setOrders] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState('mias')
  const [cashCut, setCashCut] = useState(undefined) // undefined = cargando, null = sin turno
  const [fondo, setFondo] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [cobro, setCobro] = useState(null) // orden que se está entregando
  const [cierre, setCierre] = useState(null) // resumen del turno al cerrarlo
  useEscapeKey(() => { if (cierre) setCierre(null); else setCobro(null) }, !!(cobro || cierre))
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
  function loadCut() {
    getOpenCashCut().then((r) => setCashCut(r.data.data ?? null)).catch(() => setCashCut(null))
  }

  useEffect(() => {
    load()
    loadCut()
  }, [])
  useLiveRefresh(load, { filtro: (e) => e.name === 'orden' })

  const myId = user?.userId
  const mias = orders.filter((o) => o.repartidor?.id === myId)
  const disponibles = orders.filter((o) => !o.repartidor)
  const deOtros = orders.filter((o) => o.repartidor && o.repartidor.id !== myId)
  const lista = tab === 'mias' ? mias : disponibles

  async function iniciarTurno(e) {
    e.preventDefault()
    try {
      await openCashCut({ amount: Number(fondo || 0), notes: 'Turno de repartidor' })
      notify('Turno iniciado', 'success')
      loadCut()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo iniciar el turno', 'error') }
  }

  // Cierre del turno desde aquí mismo (el repartidor ya no necesita entrar a "Cortes de Caja"):
  // muestra lo cobrado en efectivo y transferencia, y cierra su corte.
  async function abrirCierre() {
    try {
      const r = await getCashCutSummary(cashCut.id)
      setCierre(r.data.data)
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo obtener el resumen del turno', 'error') }
  }
  async function confirmarCierre() {
    try {
      await closeCashCut(cashCut.id, { expenses: 0, notes: 'Cierre de turno de repartidor' })
      notify('Turno cerrado. Entrega el efectivo en caja.', 'success')
      setCierre(null)
      loadCut()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo cerrar el turno', 'error') }
  }

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

  async function soltar(o) {
    setBusyId(o.id)
    try {
      await releaseDelivery(o.id)
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo soltar el pedido', 'error') }
    finally { setBusyId(null) }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-2xl font-bold text-gray-900">🛵 Entregas</h2>
        {cashCut && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">Turno abierto</span>
            <button type="button" onClick={abrirCierre} className="text-xs font-semibold px-2.5 py-1 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50">Cerrar turno</button>
          </div>
        )}
      </div>

      {cashCut === null && (
        <form onSubmit={iniciarTurno} className="card border-2 border-orange-300 bg-orange-50 mb-4">
          <p className="font-bold text-orange-900">Inicia tu turno para poder cobrar</p>
          <p className="text-sm text-orange-800 mt-1">Lo que cobres en efectivo o transferencia queda en tu corte de caja. Al terminar, ciérralo en "Cortes de Caja" y entrega el efectivo.</p>
          <div className="flex flex-wrap items-end gap-2 mt-3">
            <label className="text-sm text-gray-700">Efectivo para cambio (opcional)
              <input className="input mt-1 !w-40" type="number" min="0" step="0.01" placeholder="0.00" value={fondo} onChange={(e) => setFondo(e.target.value)} />
            </label>
            <button className="btn-primary">Iniciar turno</button>
          </div>
        </form>
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
      </div>

      {loaded && lista.length === 0 && (
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
                        ✅ {pagado ? 'Marcar entregado' : 'Entregar y cobrar'}
                      </button>
                    )}
                    {!o.enCaminoAt && (
                      <button disabled={busyId === o.id} onClick={() => soltar(o)}
                        className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">Soltar</button>
                    )}
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

      {cierre && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={() => setCierre(null)}>
          <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold">Cerrar turno</h3>
            {mias.length > 0 && (
              <p className="mt-2 text-sm text-orange-800 bg-orange-50 rounded-lg px-3 py-2">
                Todavía llevas {mias.length} pedido{mias.length === 1 ? '' : 's'}. Entrégalo{mias.length === 1 ? '' : 's'} o suéltalo{mias.length === 1 ? '' : 's'} antes de cerrar.
              </p>
            )}
            <div className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><span>Efectivo inicial</span><span>{fmt(cierre.openingAmount)}</span></div>
              <div className="flex justify-between"><span>Cobrado en efectivo</span><span className="font-semibold">{fmt(cierre.cashSales)}</span></div>
              <div className="flex justify-between"><span>Cobrado por transferencia</span><span className="font-semibold">{fmt(cierre.transferSales)}</span></div>
              <div className="flex justify-between"><span>Entregas cobradas</span><span>{cierre.totalTransactions}</span></div>
            </div>
            <div className="mt-4 rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-center">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Efectivo a entregar en caja</p>
              <p className="font-bold text-green-700 text-2xl mt-0.5">{fmt(Number(cierre.openingAmount ?? 0) + Number(cierre.cashSales ?? 0))}</p>
            </div>
            <div className="flex gap-2 mt-5">
              <button type="button" className="btn-secondary flex-1" onClick={() => setCierre(null)}>Cancelar</button>
              <button type="button" className="btn-primary flex-1 disabled:opacity-40" disabled={mias.length > 0} onClick={confirmarCierre}>Cerrar turno</button>
            </div>
          </div>
        </div>
      )}

      {cobro && (
        <CobroModal orden={cobro} turnoAbierto={!!cashCut} onClose={() => setCobro(null)}
          onDone={() => { setCobro(null); load(); loadCut() }} />
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

/**
 * Modal de entrega: si falta pagar, cobra en efectivo (con cambio) o transferencia. En pedidos
 * web la transferencia se comprueba con la foto que sube el cliente; en los de caja, con folio.
 */
function CobroModal({ orden, turnoAbierto, onClose, onDone }) {
  const { notify } = useNotify()
  const pagado = orden.estado === 'PAGADA'
  const [metodo, setMetodo] = useState(orden.metodoPago === 'TRANSFERENCIA' ? 'TRANSFER' : 'CASH')
  const [recibido, setRecibido] = useState('')
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
  const bloqueado = saving || (!pagado && (!turnoAbierto || faltaEfectivo || recibidoExcede || sinComprobante))

  async function confirmar() {
    setSaving(true)
    try {
      await deliverOrder(orden.id, pagado ? {} : {
        metodo,
        recibido: pideEfectivo ? recibidoNum : undefined,
        referencia: metodo === 'TRANSFER' && !transferWeb ? referencia.trim() || undefined : undefined,
      })
      notify(`Pedido #${orden.id} entregado${pagado ? '' : ' y cobrado'}`, 'success')
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
            {!turnoAbierto && (
              <p className="mt-3 text-sm text-orange-800 bg-orange-50 rounded-lg px-3 py-2">Primero inicia tu turno (arriba en Entregas) para poder cobrar.</p>
            )}
            <div className="grid grid-cols-2 gap-2 mt-4">
              {[['CASH', '💵 Efectivo'], ['TRANSFER', '🏦 Transferencia']].map(([k, label]) => (
                <button key={k} type="button" onClick={() => setMetodo(k)}
                  className={`rounded-xl border-2 py-3 font-bold ${metodo === k ? 'border-purple-600 bg-purple-50 text-purple-800' : 'border-gray-200 text-gray-700'}`}>{label}</button>
              ))}
            </div>
            <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-center">
              <p className="text-xs font-semibold text-gray-500 uppercase">Total a cobrar</p>
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
              : !turnoAbierto ? 'Inicia tu turno para poder cobrar'
              : sinComprobante ? 'El cliente todavía no sube el comprobante de su transferencia'
              : recibidoExcede ? 'El monto capturado es excesivamente grande'
              : faltaEfectivo ? 'Captura cuánto pagó el cliente en efectivo' : undefined}>
            {saving ? 'Procesando...' : pagado ? 'Confirmar entrega' : 'Cobrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
