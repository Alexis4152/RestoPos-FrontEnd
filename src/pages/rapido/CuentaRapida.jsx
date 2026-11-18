import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createAccount } from '../../api/cuentas'
import { createPayment, nuevaLlavePago } from '../../api/pagos'
import { deliverAllItems } from '../../api/ordenes'
import { cobroAnticipado } from '../../utils/tipoPedido'
import { printCuentaPorPagar, abrirCajon, reimprimirCuenta } from '../../utils/printer'
import { puedeImprimirCuenta, quienImprimeTexto } from '../../utils/imprimeCuenta'
import { EstadoEstacion } from '../../components/PrintStation'
import { useNotify } from '../../context/NotifyContext'
import { useVolver } from '../../utils/navegacion'
import { useAuth } from '../../context/AuthContext'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const r2 = (n) => Math.round(Number(n) * 100) / 100
const METODOS = [['CASH', 'Efectivo'], ['CARD', 'Tarjeta'], ['TRANSFER', 'Transferencia']]
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

/**
 * Reimprime la cuenta ya cobrada en sus 2 copias (cliente / comercio), sin volver a abrir el
 * cajón; si no hay impresora térmica configurada, abre el PDF. Al cobrar ya NO se imprime
 * nada (el mesero imprimió la cuenta): esto es solo para cuando de verdad se necesite.
 */
export const imprimir = reimprimirCuenta

/** Pantalla final tras cobrar (la muestra OrdenRapida aunque la orden ya esté cerrada). */
export function CobroExitoso({ cobro }) {
  const { notify } = useNotify()
  const volver = useVolver()
  const destino = cobro.lugar ? '/takeaway' : '/tables'
  const [entregando, setEntregando] = useState(false)

  async function yaSeEntrego() {
    setEntregando(true)
    try {
      await deliverAllItems(cobro.ordenId)
      volver(destino)
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo marcar como entregado', 'error')
      setEntregando(false)
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white border border-[#E4E1DA] rounded-2xl p-6 text-center space-y-3">
      <p className="text-sm font-bold text-[#22603C]">
        Cobrado · {cobro.lugar ?? `${/^mesa\b/i.test(String(cobro.mesa)) ? cobro.mesa : `Mesa ${cobro.mesa}`}${cobro.porEntregar ? '' : ' liberada'}`}
      </p>
      <p className="text-3xl font-extrabold">{fmt(cobro.total)}</p>
      {cobro.cambio > 0 && <p className="text-2xl font-extrabold">Cambio: {fmt(cobro.cambio)}</p>}
      {cobro.porEntregar && <p className="text-sm text-gray-700">Falta entregar: cocina lo sigue viendo y la orden se cierra al entregarlo.</p>}
      <div className="flex flex-wrap gap-2 justify-center pt-2">
        <button type="button" className="btn-secondary min-h-[44px]" onClick={() => imprimir(cobro.cuentaId).catch(() => notify('No se pudo imprimir', 'error'))}>Reimprimir (2 copias)</button>
        {/* Regresa a donde venía (Mis mesas, Órdenes, Para llevar...). */}
        {cobro.porEntregar && (
          <button type="button" className="btn-secondary min-h-[44px]" disabled={entregando} onClick={yaSeEntrego}>{entregando ? '...' : 'Ya se entregó'}</button>
        )}
        <button type="button" className="btn-primary min-h-[44px]" onClick={() => volver(destino)}>Listo</button>
      </div>
    </div>
  )
}

/**
 * Modo rápido · cuenta de una mesa en un paso: "Cobrar y liberar mesa" genera la cuenta total,
 * registra el pago y libera la mesa. Lo que el sistema no tenga como entregado (cocina no
 * siempre lo marca) se marca solo al cobrar, sin pasos extra (CuentaCreateRequest.marcarEntregados,
 * queda en la auditoría). Para llevar, comer aquí y recoger no: se paga antes de recibir, cobrar no
 * toca cocina y la orden se cierra al entregar. Dividir por persona o en
 * partes, o una mesa que ya tiene varias cuentas, se hace en la vista detallada.
 */
export default function CuentaRapida({ order, cuentas, vistaDetallada, onCambio, onCobrada }) {
  const { notify } = useNotify()
  // Cobrar = sección CASH_CUTS (cajero/admin). El mesero imprime la cuenta y el cliente paga en caja.
  const { user, hasSection, isAdmin } = useAuth()
  const puedeCobrar = hasSection('CASH_CUTS')
  // Quién imprime la cuenta por pagar lo define el SUPER_ADMIN por tienda (ver utils/imprimeCuenta).
  const puedeImprimir = puedeImprimirCuenta(user, puedeCobrar, isAdmin)
  // Tope de propina de la tienda ("Datos de la tienda"), 50% por default; el backend lo vuelve a validar.
  const topePropina = Number(user?.tienda?.propinaMaxPorcentaje) || 50
  const [metodo, setMetodo] = useState('CASH')
  // Propina: igual que en la vista detallada (sin propina, monto fijo $ u otro %), más 10% y
  // 15% de un toque. propinaModo: 'NONE' | '10' | '15' | 'MONTO' | 'PORCENTAJE'.
  const [propinaModo, setPropinaModo] = useState('NONE')
  const [propinaValor, setPropinaValor] = useState('')
  const propinaTipo = propinaModo === '10' || propinaModo === '15' ? 'PORCENTAJE' : propinaModo
  const [recibido, setRecibido] = useState(null) // null = exacto
  const [otroMonto, setOtroMonto] = useState('')
  const [referencia, setReferencia] = useState('')
  const [busy, setBusy] = useState(false)
  const [entregando, setEntregando] = useState(false)
  // Una llave por cobro: un reintento o doble toque no crea otro pago. Se renueva al terminar.
  const llavePago = useRef(nuevaLlavePago())
  const anticipado = cobroAnticipado(order)

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
  const propinaNum = propinaModo === '10' || propinaModo === '15' ? Number(propinaModo)
    : propinaValor === '' ? null : Number(propinaValor)
  const propinaMaxMonto = Math.floor(subtotal * topePropina) / 100
  const propinaExcede = propinaNum != null && !Number.isNaN(propinaNum)
    && (propinaTipo === 'PORCENTAJE' ? propinaNum > topePropina : propinaNum > propinaMaxMonto)
  const propinaNegativa = propinaNum != null && propinaNum < 0
  const propinaInvalida = propinaExcede || propinaNegativa || (propinaNum != null && Number.isNaN(propinaNum))
  // Misma fórmula que el backend (PagoService): porcentaje sobre el subtotal, redondeado a centavos.
  const propina = propinaTipo === 'NONE' || propinaNum == null || propinaInvalida ? 0
    : propinaTipo === 'PORCENTAJE' ? Math.round(subtotal * propinaNum) / 100 : r2(propinaNum)
  const total = r2(subtotal + propina)
  const recibidoNum = metodo === 'CASH' ? (recibido === 'otro' ? Number(otroMonto) || 0 : recibido ?? total) : total
  const cambio = metodo === 'CASH' ? r2(recibidoNum - total) : 0
  const faltaEfectivo = metodo === 'CASH' && recibidoNum < total

  async function cobrar() {
    setBusy(true)
    let cuenta = cuentaLista
    try {
      if (!cuenta) {
        const r = await createAccount(order.id, { tipo: 'TOTAL', marcarEntregados: !anticipado })
        cuenta = r.data.data
      }
      await createPayment(cuenta.id, {
        metodo,
        monto: r2(Number(cuenta.total) + propina),
        recibido: metodo === 'CASH' ? recibidoNum : undefined,
        referencia: metodo === 'TRANSFER' && referencia.trim() ? referencia.trim() : undefined,
        idempotencyKey: llavePago.current,
        propinaPorcentaje: propina > 0 && propinaTipo === 'PORCENTAJE' ? propinaNum : undefined,
        propinaMonto: propina > 0 && propinaTipo === 'MONTO' ? propina : undefined,
      })
      llavePago.current = nuevaLlavePago()
      // Ya no se imprime al cobrar (el mesero imprimió la cuenta en 2 copias); solo se abre
      // el cajón si fue en efectivo. "Reimprimir" queda en la pantalla de cobro exitoso.
      abrirCajon(cuenta.id).catch((err) => notify(err.message ?? 'No se pudo abrir el cajón', 'error'))
      onCobrada?.({
        cuentaId: cuenta.id, ordenId: order.id, mesa: order.mesa?.numero,
        porEntregar: anticipado && vivos.some((i) => !i.cargoExtra && i.estado !== 'ENTREGADO'), total: r2(Number(cuenta.total) + propina),
        lugar: order.mesa ? null : `Pedido #${order.id}${order.clienteNombre ? ` · ${order.clienteNombre}` : ''}`,
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
      const r = await createAccount(order.id, { tipo: 'TOTAL', marcarEntregados: !anticipado })
      if (puedeImprimir) {
        await printCuentaPorPagar(r.data.data.id)
        notify('Cuenta impresa: entrégale su copia al cliente para que pague en caja', 'success')
      } else {
        notify(`Cuenta generada: ${quienImprimeTexto(user)} la imprime y cobra en caja`, 'success')
      }
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
  if (order.pagadoAt && !cuentaLista && porCobrar.length === 0) {
    return (
      <div className="bg-white border border-[#E4E1DA] rounded-2xl p-5 space-y-3">
        <p className="font-extrabold text-[#22603C]">Pagado · falta entregar</p>
        <p className="text-sm text-gray-700">Cocina lo sigue viendo. La orden se cierra al entregarlo.</p>
        <button type="button" className="btn-primary w-full min-h-[48px]" disabled={entregando} onClick={async () => {
          setEntregando(true)
          try { await deliverAllItems(order.id); onCambio?.() }
          catch (err) { notify(err.response?.data?.message ?? 'No se pudo marcar como entregado', 'error') }
          finally { setEntregando(false) }
        }}>{entregando ? '...' : 'Ya se entregó'}</button>
      </div>
    )
  }
  if (!cuentaLista && porCobrar.length === 0) {
    return <p className="bg-white border border-[#E4E1DA] rounded-2xl p-5 text-sm text-gray-700">No hay nada por cobrar todavía.</p>
  }

  if (!puedeCobrar) {
    return (
      <div className="space-y-3">
        {sinEntregar.length > 0 && !cuentaLista && (
          <p className="rounded-2xl bg-[#F1EFEA] px-4 py-3 text-sm text-gray-700">
            {piezasSinEntregar} platillo{piezasSinEntregar === 1 ? '' : 's'} sin marcar como entregado{piezasSinEntregar === 1 ? '' : 's'}: {anticipado ? 'cocina los sigue viendo.' : 'al generar la cuenta se marcan solos.'}
          </p>
        )}
        <section className="bg-white border border-[#E4E1DA] rounded-2xl p-4 space-y-2 text-sm">
          {cuentaLista ? (
            <p className="text-gray-700">Cuenta {cuentaLista.ticketFolio ?? `#${cuentaLista.id}`} generada · el cliente paga en caja.</p>
          ) : lineas.map((l) => (
            <div key={l.id} className="flex justify-between gap-3"><span>{l.cantidad} × {l.nombre}</span><span className="font-bold">{fmt(l.importe)}</span></div>
          ))}
          <div className="border-t border-[#ECE9E2] pt-2.5 flex justify-between items-baseline">
            <span className="font-extrabold">Total</span><span className="text-2xl font-extrabold">{fmt(subtotal)}</span>
          </div>
        </section>
        <p className="rounded-2xl bg-[#E6EDF8] px-4 py-3 text-sm text-[#1E4585]">
          {puedeImprimir
            ? <>Se imprimen 2 copias: entrégale la <b>copia cliente</b>; con ella paga en caja (la propina se agrega al pagar).</>
            : <>En esta tienda <b>{quienImprimeTexto(user)}</b> imprime la cuenta y cobra en caja; tú solo la generas.</>}
        </p>
        {(puedeImprimir || !cuentaLista) && (
          <button type="button" disabled={busy}
            onClick={cuentaLista
              ? () => printCuentaPorPagar(cuentaLista.id).catch(() => notify('No se pudo imprimir', 'error'))
              : soloImprimir}
            className="w-full min-h-[56px] rounded-2xl bg-gray-900 text-white text-base font-extrabold disabled:opacity-50">
            {busy ? 'Generando…' : cuentaLista ? 'Reimprimir cuenta' : `${puedeImprimir ? 'Imprimir' : 'Generar'} cuenta ${fmt(subtotal)}`}
          </button>
        )}
        {!cuentaLista && (
          <Link to={vistaDetallada} className="block text-center min-h-[40px] text-sm font-bold text-purple-700 hover:underline">Dividir la cuenta (vista detallada)</Link>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Aquí ya solo llega quien cobra (cajero/admin/supervisor). */}
      <EstadoEstacion />
      {sinEntregar.length > 0 && !cuentaLista && (
        <p className="rounded-2xl bg-[#F1EFEA] px-4 py-3 text-sm text-gray-700">
          {piezasSinEntregar} platillo{piezasSinEntregar === 1 ? '' : 's'} sin marcar como entregado{piezasSinEntregar === 1 ? '' : 's'}
          ({[...new Set(sinEntregar.map((i) => i.productoNombre))].join(', ')}): {anticipado ? 'cocina los sigue viendo; la orden se cierra al entregarlos.' : 'al cobrar se marcan solos.'}
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
        <div className="border border-[#ECE9E2] rounded-xl p-3 space-y-2 mt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-gray-600 font-semibold">Propina (opcional)</span>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Tipo de propina">
              {[['NONE', 'Sin propina'], ['10', '10%'], ['15', '15%'], ['MONTO', '$'], ['PORCENTAJE', 'Otro %']]
                .filter(([v]) => !(v === '10' || v === '15') || Number(v) <= topePropina).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={propinaModo === v}
                  onClick={() => { setPropinaModo(v); setPropinaValor('') }}
                  className={`min-h-[36px] min-w-[44px] px-3 rounded-lg text-[13px] font-bold border ${propinaModo === v ? 'bg-purple-600 border-purple-600 text-white' : 'border-[#D9D5CC] bg-white text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {(propinaModo === '10' || propinaModo === '15') && propina > 0 && (
            <p className="text-xs text-gray-600">Propina ({propinaModo}%): <span className="font-bold text-gray-800">{fmt(propina)}</span></p>
          )}
          {(propinaModo === 'MONTO' || propinaModo === 'PORCENTAJE') && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="propina-valor" className="sr-only">{propinaTipo === 'PORCENTAJE' ? 'Porcentaje de propina' : 'Monto de propina'}</label>
              <input id="propina-valor" className="input !w-28" type="number" min="0" step="0.01" inputMode="decimal" autoFocus
                placeholder={propinaTipo === 'PORCENTAJE' ? 'Ej. 10' : 'Ej. 20.00'}
                value={propinaValor} onChange={(e) => setPropinaValor(e.target.value)} />
              {propinaExcede ? (
                <p className="text-xs text-red-600">{propinaTipo === 'PORCENTAJE' ? `La propina no puede pasar del ${topePropina}%` : `La propina no puede pasar del ${topePropina}% de la cuenta (${fmt(propinaMaxMonto)})`}</p>
              ) : propinaNegativa ? (
                <p className="text-xs text-red-600">La propina no puede ser negativa</p>
              ) : propina > 0 && (
                <p className="text-xs text-gray-600">Propina: <span className="font-bold text-gray-800">{fmt(propina)}</span></p>
              )}
            </div>
          )}
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
            <label htmlFor="ref-transfer" className="text-sm font-semibold text-gray-600">Referencia o folio (obligatoria)</label>
            <input id="ref-transfer" className="input" maxLength={100} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            <p className="text-xs text-gray-600 mt-1">Queda por verificar hasta que un administrador confirme que llegó al banco.</p>
          </div>
        )}
      </section>

      <button type="button" disabled={busy || faltaEfectivo || propinaInvalida || (metodo === 'TRANSFER' && !referencia.trim())} onClick={cobrar}
        className="w-full min-h-[56px] rounded-2xl bg-gray-900 text-white text-base font-extrabold disabled:opacity-50 disabled:cursor-not-allowed">
        {busy ? 'Cobrando…' : `Cobrar ${fmt(total)}${order.mesa && !anticipado ? ' y liberar mesa' : ''}`}
      </button>
      {!cuentaLista && puedeImprimir && (
        <button type="button" disabled={busy} onClick={soloImprimir}
          className="block mx-auto min-h-[40px] text-sm font-bold text-purple-700 hover:underline disabled:opacity-50">
          Solo imprimir la cuenta
        </button>
      )}
      {/* La cuenta ya la generó el mesero: si aquí toca imprimirla (cajero), se imprime antes de cobrar. */}
      {cuentaLista && puedeImprimir && (
        <button type="button" disabled={busy}
          onClick={() => printCuentaPorPagar(cuentaLista.id).catch(() => notify('No se pudo imprimir', 'error'))}
          className="block mx-auto min-h-[40px] text-sm font-bold text-purple-700 hover:underline disabled:opacity-50">
          Imprimir cuenta (2 copias)
        </button>
      )}
    </div>
  )
}
