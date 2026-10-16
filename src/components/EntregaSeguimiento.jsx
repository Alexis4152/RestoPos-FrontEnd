import { useEffect, useState } from 'react'
import { getOrderDelivery } from '../api/ordenes'
import ComprobanteImagen from './ComprobanteImagen'

const hora = (d) => (d ? new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '')
const fechaHora = (d) => (d ? new Date(d).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

const PASOS = [
  { key: 'SIN_REPARTIDOR', label: 'Sin repartidor', icono: '⏳' },
  { key: 'TOMADO', label: 'Lo tomó', icono: '🙋' },
  { key: 'EN_CAMINO', label: 'En camino', icono: '🛵' },
  { key: 'ENTREGADO', label: 'Entregado', icono: '✅' },
]
const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))
const METODO_PAGO = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia' }
const METODO_ACORDADO = { EFECTIVO: 'efectivo', TARJETA: 'tarjeta', TRANSFERENCIA: 'transferencia' }
const EVENTO_LABEL = { TOMADO: 'Lo tomó', SOLTADO: 'Lo soltó', EN_CAMINO: 'Salió en camino', ENTREGADO: 'Entregado' }
const EVENTO_ICONO = { TOMADO: '🙋', SOLTADO: '↩️', EN_CAMINO: '🛵', ENTREGADO: '✅' }

/**
 * Seguimiento de un envío a domicilio en el punto de venta: en qué paso va (sin repartidor →
 * lo tomó → en camino → entregado) y el histórico de cada movimiento del repartidor con su
 * hora (incluido si lo soltó y lo tomó otro). `version` cambia cuando la orden cambia, para
 * recargar (la orden ya se refresca en tiempo real en OrderDetail).
 */
export default function EntregaSeguimiento({ ordenId, version }) {
  const [data, setData] = useState(null)
  const [verHistorico, setVerHistorico] = useState(false)

  useEffect(() => {
    getOrderDelivery(ordenId).then((r) => setData(r.data.data)).catch(() => setData(null))
  }, [ordenId, version])

  if (!data) return null
  if (data.estado === 'CANCELADO') return <p className="text-sm text-gray-500">🛵 Envío cancelado</p>

  const idx = PASOS.findIndex((p) => p.key === data.estado)
  const horaDe = { TOMADO: data.tomadoAt, EN_CAMINO: data.enCaminoAt, ENTREGADO: data.entregadoAt }

  return (
    <div className="mt-2 max-w-xl rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">🛵 Envío a domicilio</p>
        {data.eventos.length > 0 && (
          <button type="button" onClick={() => setVerHistorico((v) => !v)} className="text-xs font-semibold text-purple-700 hover:underline">
            {verHistorico ? 'Ocultar histórico' : `Ver histórico (${data.eventos.length})`}
          </button>
        )}
      </div>
      <ol className="mt-2 grid grid-cols-4 gap-1">
        {PASOS.map((p, i) => {
          const hecho = i <= idx
          const actual = i === idx
          return (
            <li key={p.key} className="flex flex-col items-center text-center">
              <div className="flex items-center w-full">
                <span className={`h-1 flex-1 ${i === 0 ? 'invisible' : hecho ? 'bg-green-500' : 'bg-gray-200'}`} />
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${
                  actual ? 'bg-purple-600 text-white ring-4 ring-purple-100' : hecho ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  {p.icono}
                </span>
                <span className={`h-1 flex-1 ${i === PASOS.length - 1 ? 'invisible' : i < idx ? 'bg-green-500' : 'bg-gray-200'}`} />
              </div>
              <span className={`mt-1 text-[11px] leading-tight ${actual ? 'font-bold text-purple-700' : hecho ? 'font-semibold text-gray-700' : 'text-gray-400'}`}>
                {p.label}
              </span>
              {hecho && horaDe[p.key] && <span className="text-[11px] text-gray-500">{hora(horaDe[p.key])}</span>}
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-sm text-gray-700">
        {data.estado === 'SIN_REPARTIDOR' && 'Esperando a que un repartidor lo tome.'}
        {data.estado === 'TOMADO' && <>Lo tomó <b>{data.repartidor}</b>; aún no sale.</>}
        {data.estado === 'EN_CAMINO' && <><b>{data.repartidor}</b> va en camino.</>}
        {data.estado === 'ENTREGADO' && <>Entregado por <b>{data.repartidor ?? '—'}</b>.</>}
      </p>
      {data.cobro && <CobroEnvio cobro={data.cobro} ordenId={ordenId} />}
      {verHistorico && (
        <ul className="mt-2 border-t border-gray-100 pt-2 space-y-1">
          {data.eventos.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
              <span className="w-24 shrink-0 text-gray-500">{fechaHora(e.fecha)}</span>
              <span>
                {EVENTO_ICONO[e.tipo]} {EVENTO_LABEL[e.tipo] ?? e.tipo}{e.repartidor ? ` · ${e.repartidor}` : ''}
                {e.porOtro && <span className="text-gray-500"> (lo hizo {e.porOtro})</span>}
                {e.detalle && <span className="text-gray-500"> — {e.detalle}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Estado del cobro del envío: cobrado (con cada pago: método, monto, quién y a qué hora) o
 * pendiente (cuánto falta, cómo dijo el cliente que pagaría y si ya subió su comprobante).
 */
function CobroEnvio({ cobro, ordenId }) {
  const parcial = !cobro.cobrado && Number(cobro.pagado) > 0
  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${cobro.cobrado ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <p className="font-semibold">
        {cobro.cobrado
          ? `💰 Cobrado · ${fmt(cobro.pagado)}`
          : `💰 Pendiente de cobro · ${fmt(cobro.pendiente)}${parcial ? ` (ya se cobró ${fmt(cobro.pagado)} de ${fmt(cobro.total)})` : ''}`}
      </p>
      {!cobro.cobrado && cobro.metodoAcordado && cobro.metodoAcordado !== 'TRANSFERENCIA' && (
        <p className="text-xs mt-0.5">El cliente pagará con {METODO_ACORDADO[cobro.metodoAcordado] ?? cobro.metodoAcordado}</p>
      )}
      {cobro.transferencia && <TransferenciaEnvio t={cobro.transferencia} total={cobro.total} ordenId={ordenId} />}
      {cobro.pagos.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs">
          {cobro.pagos.map((p, i) => (
            <li key={i}>
              {METODO_PAGO[p.metodo] ?? p.metodo} {fmt(p.monto)}{p.cobradoPor ? ` · cobró ${p.cobradoPor}` : ''}{p.fecha ? ` · ${fechaHora(p.fecha)}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Pago por transferencia de un pedido web: estado (sin comprobante / por confirmar /
 * confirmada), si incluye el envío o el envío se cobra en efectivo, y la foto del comprobante.
 */
function TransferenciaEnvio({ t, total, ordenId }) {
  const estado = !t.comprobanteSubido
    ? { texto: '⏳ El cliente aún no sube el comprobante', cls: 'bg-orange-100 text-orange-800' }
    : t.confirmada
      ? { texto: '✅ Transferencia confirmada', cls: 'bg-green-100 text-green-800' }
      : { texto: '🧾 Comprobante subido · pendiente de confirmar', cls: 'bg-blue-100 text-blue-800' }
  const conEnvio = Number(t.costoEnvio) > 0
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2 text-gray-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-gray-500">🏦 Transferencia</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${estado.cls}`}>{estado.texto}</span>
      </div>
      {conEnvio && t.incluyeEnvio === true && (
        <p className="text-xs mt-1">Transfiere <b>todo</b> {fmt(total)}, <b>incluye el envío</b> ({fmt(t.costoEnvio)}).</p>
      )}
      {conEnvio && t.incluyeEnvio === false && (
        <p className="text-xs mt-1">
          Transfiere <b>solo los platillos</b> {fmt(t.montoTransferencia)}. <b>El envío ({fmt(t.envioEnEfectivo)}) se cobra en efectivo</b> al entregar.
        </p>
      )}
      {conEnvio && t.incluyeEnvio == null && (
        <p className="text-xs mt-1 text-gray-500">Aún no indica si su transferencia incluye el envío ({fmt(t.costoEnvio)}).</p>
      )}
      {!conEnvio && <p className="text-xs mt-1">Transfiere {fmt(total)} (envío sin costo).</p>}
      {t.comprobanteSubido && (
        <div className="mt-2">
          <p className="text-[11px] text-gray-500 mb-1">Comprobante subido {fechaHora(t.comprobanteAt)} · toca la imagen para verla completa</p>
          <div className="max-w-[14rem]"><ComprobanteImagen ordenId={ordenId} version={t.comprobanteAt} /></div>
        </div>
      )}
    </div>
  )
}

/** Etiqueta corta del cobro para tarjetas (tablero "Para llevar"). */
export function etiquetaCobro(orden) {
  if (orden.estado === 'PAGADA') return { texto: '💰 Cobrado', cls: 'bg-green-100 text-green-800' }
  if (orden.metodoPago === 'TRANSFERENCIA' && orden.comprobanteAt) {
    const sinEnvio = orden.transferenciaIncluyeEnvio === false
    return { texto: `🧾 Comprobante subido${sinEnvio ? ' · envío en efectivo' : ''} · por confirmar`, cls: 'bg-blue-100 text-blue-800' }
  }
  if (orden.metodoPago === 'TRANSFERENCIA') return { texto: '⏳ Transferencia sin comprobante', cls: 'bg-orange-100 text-orange-800' }
  return { texto: `💰 Por cobrar ${fmt(orden.total)}`, cls: 'bg-amber-100 text-amber-800' }
}

/** Etiqueta corta del paso del envío para tarjetas (tablero "Para llevar"). */
export function etiquetaEntrega(orden) {
  if (orden.entregadaAt) return { texto: '✅ Entregado', cls: 'bg-green-100 text-green-800' }
  if (orden.enCaminoAt) return { texto: `🛵 En camino${orden.repartidor ? ` · ${orden.repartidor.name}` : ''}`, cls: 'bg-blue-100 text-blue-800' }
  if (orden.repartidor) return { texto: `🙋 Lo tomó ${orden.repartidor.name}`, cls: 'bg-purple-100 text-purple-800' }
  return { texto: '⏳ Sin repartidor', cls: 'bg-amber-100 text-amber-800' }
}
