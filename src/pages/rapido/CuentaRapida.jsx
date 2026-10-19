import { useState } from 'react'
import { Link } from 'react-router-dom'
import { createAccount, getTicketPdf } from '../../api/cuentas'
import { createPayment } from '../../api/pagos'
import { printAccountTicket } from '../../utils/printer'
import { useNotify } from '../../context/NotifyContext'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const r2 = (n) => Math.round(Number(n) * 100) / 100
const METODOS = [['CASH', 'Efectivo'], ['CARD', 'Tarjeta'], ['TRANSFER', 'Transferencia']]
const PROPINAS = [0, 10, 15]
const EN_COCINA = ['PENDIENTE', 'PREPARANDO', 'LISTO', 'ENTREGADO_MESERO']

/** Billetes rápidos para el efectivo: exacto y los siguientes montos redondos que cubren el total. */
function billetes(total) {
  const out = []
  for (const paso of [50, 100, 200, 500, 1000]) {
    const v = Math.ceil(total / paso) * paso
    if (v > total && !out.includes(v)) out.push(v)
  }
  return out.slice(0, 3)
}

/** Imprime el ticket en la térmica; si no hay impresora configurada, abre el PDF. */
async function imprimir(cuentaId) {
  try {
    await printAccountTicket(cuentaId)
  } catch {
    const r = await getTicketPdf(cuentaId)
    window.open(URL.createObjectURL(r.data), '_blank', 'noopener')
  }
}

/** Pantalla final tras cobrar (la muestra OrdenRapida aunque la orden ya esté cerrada). */
export function CobroExitoso({ cobro }) {
  const { notify } = useNotify()
  return (
    <div className="max-w-md mx-auto bg-white border border-[#E4E1DA] rounded-2xl p-6 text-center space-y-3">
      <p className="text-sm font-bold text-[#22603C]">Cobrado · {/^mesa/i.test(String(cobro.mesa)) ? cobro.mesa : `Mesa ${cobro.mesa}`} liberada</p>
      <p className="text-3xl font-extrabold">{fmt(cobro.total)}</p>
      {cobro.cambio > 0 && <p className="text-2xl font-extrabold">Cambio: {fmt(cobro.cambio)}</p>}
      <div className="flex flex-wrap gap-2 justify-center pt-2">
        <button type="button" className="btn-secondary min-h-[44px]" onClick={() => imprimir(cobro.cuentaId).catch(() => notify('No se pudo imprimir', 'error'))}>Reimprimir ticket</button>
        <Link to="/tables" className="btn-primary min-h-[44px] inline-flex items-center">Volver a mis mesas</Link>
      </div>
    </div>
  )
}

/**
 * Modo rápido · cuenta de una mesa en un paso: "Cobrar y liberar mesa" genera la cuenta total,
 * registra el pago y libera la mesa. Lo que el sistema no tenga como entregado (cocina no
 * siempre lo marca) se marca solo al cobrar, sin pasos extra (CuentaCreateRequest.marcarEntregados,
 * queda en la auditoría). Dividir por persona o en
 * partes, o una mesa que ya tiene varias cuentas, se hace en la vista detallada.
 */
export default function CuentaRapida({ order, cuentas, vistaDetallada, onCambio, onCobrada }) {
  const { notify } = useNotify()
  const [metodo, setMetodo] = useState('CASH')
  const [propinaPct, setPropinaPct] = useState(0)
  const [recibido, setRecibido] = useState(null) // null = exacto
  const [otroMonto, setOtroMonto] = useState('')
  const [referencia, setReferencia] = useState('')
  const [busy, setBusy] = useState(false)

  const vivos = (order.items ?? []).filter((i) => i.estado !== 'CANCELADO')
  const restante = (i) => Number(i.cantidad) - Number(i.cantidadFacturada || 0)
  const porCobrar = vivos.filter((i) => restante(i) > 0)
  // Lo que el sistema aún no tiene como entregado (cocina no siempre lo marca): al cobrar se
  // marca solo (CuentaCreateRequest.marcarEntregados, queda en la auditoría). Solo se avisa.
  const sinEntregar = porCobrar.filter((i) => !i.cargoExtra && EN_COCINA.includes(i.estado))
  const piezasSinEntregar = sinEntregar.reduce((n, i) => n + restante(i), 0)
  const pendientes = cuentas.filter((c) => c.estado === 'PENDIENTE')
  // Una sola cuenta total pendiente y nada más por facturar (ej. ya se imprimió la cuenta): se cobra esa.
  const cuentaLista = pendientes.length === 1 && porCobrar.length === 0 && Number(pendientes[0].totalPagado || 0) === 0 ? pendientes[0] : null
  const complicada = !cuentaLista && pendientes.length > 0

  const lineas = cuentaLista ? [] : porCobrar.map((i) => ({
    id: i.id, nombre: i.productoNombre, cantidad: restante(i),
    importe: r2((Number(i.subtotal) / Number(i.cantidad)) * restante(i)),
  }))
  const subtotal = cuentaLista ? Number(cuentaLista.total) : r2(lineas.reduce((s, l) => s + l.importe, 0))
  const propina = r2((subtotal * propinaPct) / 100)
  const total = r2(subtotal + propina)
  const recibidoNum = metodo === 'CASH' ? (recibido === 'otro' ? Number(otroMonto) || 0 : recibido ?? total) : total
  const cambio = metodo === 'CASH' ? r2(recibidoNum - total) : 0
  const faltaEfectivo = metodo === 'CASH' && recibidoNum < total

  async function cobrar() {
    setBusy(true)
    let cuenta = cuentaLista
    try {
      if (!cuenta) {
        const r = await createAccount(order.id, { tipo: 'TOTAL', marcarEntregados: true })
        cuenta = r.data.data
      }
      await createPayment(cuenta.id, {
        metodo,
        monto: r2(Number(cuenta.total) + propina),
        recibido: metodo === 'CASH' ? recibidoNum : undefined,
        referencia: metodo === 'TRANSFER' && referencia.trim() ? referencia.trim() : undefined,
        propinaMonto: propina > 0 ? propina : undefined,
      })
      imprimir(cuenta.id).catch(() => notify('No se pudo imprimir el ticket', 'error'))
      onCobrada?.({
        cuentaId: cuenta.id, mesa: order.mesa?.numero, total: r2(Number(cuenta.total) + propina),
        cambio: metodo === 'CASH' ? r2(recibidoNum - Number(cuenta.total) - propina) : 0,
      })
    } catch (err) {
      const msg = err.response?.data?.message ?? 'No se pudo cobrar'
      notify(cuenta && !cuentaLista ? `${msg}. La cuenta quedó generada: cóbrala aquí mismo o en la vista detallada.` : msg, 'error')
      onCambio?.()
    } finally { setBusy(false) }
  }

  async function soloImprimir() {
    setBusy(true)
    try {
      const r = await createAccount(order.id, { tipo: 'TOTAL', marcarEntregados: true })
      await imprimir(r.data.data.id)
      notify('Cuenta impresa', 'success')
      onCambio?.()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo generar la cuenta', 'error')
    } finally { setBusy(false) }
  }

  if (complicada) {
    return (
      <div className="bg-white border border-[#E4E1DA] rounded-2xl p-5 space-y-3">
        <p className="text-sm text-gray-700">Esta mesa ya tiene {pendientes.length} cuenta{pendientes.length === 1 ? '' : 's'} generada{pendientes.length === 1 ? '' : 's'} (dividida o con pagos parciales). Termínala en la vista detallada.</p>
        <Link to={vistaDetallada} className="btn-primary inline-block">Abrir vista detallada</Link>
      </div>
    )
  }
  if (!cuentaLista && porCobrar.length === 0) {
    return <p className="bg-white border border-[#E4E1DA] rounded-2xl p-5 text-sm text-gray-700">No hay nada por cobrar todavía.</p>
  }

  return (
    <div className="space-y-3">
      {sinEntregar.length > 0 && !cuentaLista && (
        <p className="rounded-2xl bg-[#F1EFEA] px-4 py-3 text-sm text-gray-700">
          {piezasSinEntregar} platillo{piezasSinEntregar === 1 ? '' : 's'} sin marcar como entregado{piezasSinEntregar === 1 ? '' : 's'}
          ({[...new Set(sinEntregar.map((i) => i.productoNombre))].join(', ')}): al cobrar se marcan solos.
        </p>
      )}

      <section className="bg-white border border-[#E4E1DA] rounded-2xl p-4 space-y-2.5">
        <h3 className="text-sm font-extrabold text-gray-600">¿Cómo pagan?</h3>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" aria-pressed="true" className="min-h-[48px] rounded-xl border-2 border-purple-600 bg-purple-50 text-purple-800 text-sm font-extrabold">Todo junto</button>
          <Link to={vistaDetallada} className="min-h-[48px] rounded-xl border border-[#D9D5CC] bg-white text-sm font-bold text-gray-700 flex items-center justify-center text-center">Por persona</Link>
          <Link to={vistaDetallada} className="min-h-[48px] rounded-xl border border-[#D9D5CC] bg-white text-sm font-bold text-gray-700 flex items-center justify-center text-center">En partes</Link>
        </div>
        <p className="text-xs text-gray-600">Dividir la cuenta abre la vista detallada.</p>
      </section>

      <section className="bg-white border border-[#E4E1DA] rounded-2xl p-4 space-y-2 text-sm">
        {cuentaLista ? (
          <p className="text-gray-700">Cuenta {cuentaLista.ticketFolio ?? `#${cuentaLista.id}`} ya impresa.</p>
        ) : lineas.map((l) => (
          <div key={l.id} className="flex justify-between gap-3"><span>{l.cantidad} × {l.nombre}</span><span className="font-bold">{fmt(l.importe)}</span></div>
        ))}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-gray-600 font-semibold">Propina</span>
          {PROPINAS.map((p) => (
            <button key={p} type="button" aria-pressed={propinaPct === p} onClick={() => setPropinaPct(p)}
              className={`min-h-[36px] px-3 rounded-full text-[13px] font-bold border ${propinaPct === p ? 'bg-gray-900 border-gray-900 text-white' : 'border-[#D9D5CC] bg-white text-gray-700'}`}>
              {p === 0 ? 'Sin' : `${p}%`}
            </button>
          ))}
          {propina > 0 && <span className="ml-auto font-bold">{fmt(propina)}</span>}
        </div>
        <div className="border-t border-[#ECE9E2] pt-2.5 flex justify-between items-baseline">
          <span className="font-extrabold">Total</span><span className="text-2xl font-extrabold">{fmt(total)}</span>
        </div>
      </section>

      <section className="bg-white border border-[#E4E1DA] rounded-2xl p-4 space-y-2.5">
        <h3 className="text-sm font-extrabold text-gray-600">Cobrar con</h3>
        <div className="grid grid-cols-3 gap-2">
          {METODOS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={metodo === k} onClick={() => setMetodo(k)}
              className={`min-h-[48px] rounded-xl text-sm font-bold ${metodo === k ? 'border-2 border-purple-600 bg-purple-50 text-purple-800' : 'border border-[#D9D5CC] bg-white text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
        {metodo === 'CASH' && (
          <>
            <div className="grid grid-cols-4 gap-2">
              <button type="button" aria-pressed={recibido === null} onClick={() => setRecibido(null)}
                className={`min-h-[44px] rounded-xl text-sm font-extrabold ${recibido === null ? 'border-2 border-gray-900' : 'border border-[#D9D5CC]'} bg-white`}>Exacto</button>
              {billetes(total).map((b) => (
                <button key={b} type="button" aria-pressed={recibido === b} onClick={() => setRecibido(b)}
                  className={`min-h-[44px] rounded-xl text-sm font-extrabold ${recibido === b ? 'border-2 border-gray-900' : 'border border-[#D9D5CC]'} bg-white`}>
                  {fmt(b).replace('.00', '')}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="otro-monto" className="text-sm font-semibold text-gray-600 shrink-0">Otro monto</label>
              <input id="otro-monto" type="number" min={0} inputMode="decimal" className="input no-spinner" placeholder="Ej. 1000"
                value={recibido === 'otro' ? otroMonto : ''} onChange={(e) => { setRecibido('otro'); setOtroMonto(e.target.value) }} />
            </div>
            {/* Mismo tamaño que el Total: es lo que el mesero le dice al cliente. */}
            <div className="border-t border-[#ECE9E2] pt-2.5 flex justify-between items-baseline" aria-live="polite">
              {faltaEfectivo
                ? <><span className="font-extrabold text-red-700">Falta</span><span className="text-2xl font-extrabold text-red-700">{fmt(total - recibidoNum)}</span></>
                : <><span className="font-extrabold text-[#22603C]">Cambio</span><span className="text-2xl font-extrabold text-[#22603C]">{fmt(cambio)}</span></>}
            </div>
          </>
        )}
        {metodo === 'TRANSFER' && (
          <div>
            <label htmlFor="ref-transfer" className="text-sm font-semibold text-gray-600">Referencia (opcional)</label>
            <input id="ref-transfer" className="input" maxLength={100} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          </div>
        )}
      </section>

      <button type="button" disabled={busy || faltaEfectivo} onClick={cobrar}
        className="w-full min-h-[56px] rounded-2xl bg-gray-900 text-white text-base font-extrabold disabled:opacity-50 disabled:cursor-not-allowed">
        {busy ? 'Cobrando…' : `Cobrar ${fmt(total)} y liberar mesa`}
      </button>
      {!cuentaLista && (
        <button type="button" disabled={busy} onClick={soloImprimir}
          className="block mx-auto min-h-[40px] text-sm font-bold text-purple-700 hover:underline disabled:opacity-50">
          Solo imprimir la cuenta
        </button>
      )}
    </div>
  )
}
