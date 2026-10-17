import { useEffect, useState } from 'react'
import { getSales } from '../api/sales'
import { printAccountTicket } from '../utils/printer'
import { useNotify } from '../context/NotifyContext'
import { useEscapeKey } from '../hooks/useEscapeKey'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const fmtDate = (d) => d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'

const PAGE_SIZES = [10, 20, 50, 100]
const EMPTY_FILTERS = { from: '', to: '', estado: '', metodo: '' }
const ESTADOS = ['PENDIENTE', 'PAGADA', 'CANCELADA']
const METODOS = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia' }
const TIPO_LABEL = { TOTAL: 'Total', POR_COMENSAL: 'Por comensal', PERSONALIZADA: 'Personalizada' }

const ESTADO_STYLE = {
  PAGADA: 'bg-green-100 text-green-700',
  CANCELADA: 'bg-gray-100 text-gray-500',
  PENDIENTE: 'bg-orange-100 text-orange-700',
}

/**
 * Pantalla "Ventas": lista de solo lectura de lo que se ha vendido, agrupada por ORDEN — una
 * orden puede haberse cobrado con una mezcla de cuentas Total, Por comensal y Personalizada, y
 * aquí se resume en un solo renglón con el total combinado, en vez de una fila por cada cuenta
 * suelta (eso confundía: una misma mesa aparecía repetida varias veces). El desglose de cuentas
 * que componen la orden — tipo, folio, monto y método de pago de cada una — se ve al abrir
 * "Ver". Con filtros por fecha, estado (agregado de la orden) y método de pago. Sirve a los
 * roles con la sección `SALES` habilitada.
 */
export default function Sales() {
  const { notify, confirmDialog } = useNotify()
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(20)
  const [pageData, setPageData] = useState({ content: [], totalElements: 0, totalPages: 0 })
  const [detail, setDetail] = useState(null)
  const [printingId, setPrintingId] = useState(null)

  function load() {
    const params = {
      page, size,
      estado: appliedFilters.estado || undefined,
      metodo: appliedFilters.metodo || undefined,
      from: appliedFilters.from ? `${appliedFilters.from}T00:00:00` : undefined,
      to: appliedFilters.to ? `${appliedFilters.to}T23:59:59` : undefined,
    }
    getSales(params)
      .then((r) => setPageData(r.data.data ?? { content: [], totalElements: 0, totalPages: 0 }))
      .catch(() => setPageData({ content: [], totalElements: 0, totalPages: 0 }))
  }
  useEffect(() => { load() }, [page, size, appliedFilters])

  // Cierra con ESC el modal de detalle de venta — mismo efecto que "Cerrar".
  useEscapeKey(() => {
    setDetail(null)
  }, !!detail)

  function handleApplyFilters(e) {
    e.preventDefault()
    setPage(0)
    setAppliedFilters(filters)
  }
  function handleClearFilters() {
    setFilters(EMPTY_FILTERS)
    setAppliedFilters(EMPTY_FILTERS)
    setPage(0)
  }

  // Métodos de pago no cancelados usados en la orden, juntando los de TODAS sus cuentas
  // (puede haber más de uno: pago mixto dentro de una cuenta, o varias cuentas con métodos
  // distintos, ej. un comensal pagó en efectivo y otro con tarjeta).
  function metodosDe(venta) {
    const pagos = (venta.cuentas ?? []).flatMap((c) => c.pagos ?? [])
    const metodos = [...new Set(pagos.filter((p) => !p.cancelado).map((p) => p.metodo))]
    return metodos.length ? metodos.map((m) => METODOS[m] ?? m).join(' + ') : '—'
  }

  /** Etiqueta de una cuenta dentro del desglose: tipo + comensal si aplica. */
  function tipoLabel(cuenta) {
    if (cuenta.tipo === 'POR_COMENSAL') return `Por comensal ${cuenta.comensal?.numero ?? ''}`.trim()
    return TIPO_LABEL[cuenta.tipo] ?? cuenta.tipo
  }

  /**
   * Reimprime el ticket de una cuenta ya cobrada (misma impresora térmica vía QZ Tray que usa
   * "Registrar pago" en Detalle de orden — ver `utils/printer.js`). Pide confirmación primero
   * porque, a diferencia del ticket que se imprime justo al cobrar, esto es una reimpresión
   * deliberada y gasta papel de la térmica.
   */
  async function handleReprint(cuentaId) {
    if (!(await confirmDialog('¿Reimprimir el ticket de esta cuenta? Se usará papel de la impresora.', { confirmText: 'Reimprimir' }))) return
    setPrintingId(cuentaId)
    try {
      await printAccountTicket(cuentaId)
    } catch (err) {
      notify(err.message ?? 'No se pudo imprimir el ticket', 'error')
    } finally {
      setPrintingId(null)
    }
  }

  const ventas = pageData.content ?? []
  const totalPages = pageData.totalPages ?? 0
  const totalElements = pageData.totalElements ?? 0
  const from = totalElements === 0 ? 0 : page * size + 1
  const to = Math.min(totalElements, page * size + ventas.length)

  return (
    <div>
      <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900 mb-6">Ventas</h1>

      <form onSubmit={handleApplyFilters} className="card mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Desde</label>
          <input type="date" className="input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Hasta</label>
          <input type="date" className="input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Estado</label>
          <select className="input" value={filters.estado} onChange={(e) => setFilters({ ...filters, estado: e.target.value })}>
            <option value="">Todos</option>
            {ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Método de pago</label>
          <select className="input" value={filters.metodo} onChange={(e) => setFilters({ ...filters, metodo: e.target.value })}>
            <option value="">Todos</option>
            {Object.entries(METODOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1">Filtrar</button>
          <button type="button" className="btn-secondary" onClick={handleClearFilters}>Limpiar</button>
        </div>
      </form>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['#', 'Fecha', 'Mesa', 'Vendedor', 'Método', 'Total', 'Estado', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ventas.map((v) => (
                <tr key={v.ordenId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">#{v.ordenId}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(v.fecha)}</td>
                  <td className="px-4 py-3 text-gray-700">{v.mesa ? `Mesa ${v.mesa.numero}` : 'Para llevar'}</td>
                  <td className="px-4 py-3 text-gray-700">{v.mesero?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{metodosDe(v)}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">{fmt(v.total)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${ESTADO_STYLE[v.estado] ?? 'bg-gray-100 text-gray-500'}`}>{v.estado}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-blue-600 hover:underline text-xs" onClick={() => setDetail(v)}>Ver</button>
                  </td>
                </tr>
              ))}
              {ventas.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Sin ventas</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 text-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <span>Mostrar</span>
            <select className="input !w-auto py-1" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0) }}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>por página · {totalElements === 0 ? 'sin resultados' : `${from}–${to} de ${totalElements}`}</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary py-1 px-3 text-xs disabled:opacity-40" disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ Anterior</button>
            <span className="text-gray-500 text-xs">Página {totalPages === 0 ? 0 : page + 1} de {totalPages}</span>
            <button className="btn-secondary py-1 px-3 text-xs disabled:opacity-40" disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}>Siguiente ›</button>
          </div>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Orden #{detail.ordenId}</h3>
              <button className="text-gray-400 hover:text-gray-600" onClick={() => setDetail(null)}>✕</button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm mb-4">
              <div><span className="text-gray-500">Mesa:</span> {detail.mesa ? `Mesa ${detail.mesa.numero}` : 'Para llevar'}</div>
              <div><span className="text-gray-500">Vendedor:</span> {detail.mesero?.name ?? '—'}</div>
              <div><span className="text-gray-500">Fecha:</span> {fmtDate(detail.fecha)}</div>
              <div>
                <span className="text-gray-500">Estado:</span>{' '}
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ESTADO_STYLE[detail.estado] ?? 'bg-gray-100 text-gray-500'}`}>{detail.estado}</span>
              </div>
            </div>

            {/* Desglose: cada cuenta que compone esta orden, con su propio tipo, productos,
                monto y forma de pago — sin repetir mesa/vendedor/fecha, que ya se ven arriba. */}
            <div className="space-y-3 mb-4">
              {(detail.cuentas ?? []).map((cuenta) => (
                <div key={cuenta.id} className="border border-gray-100 rounded-lg p-3 text-sm">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium text-gray-800">{cuenta.ticketFolio ?? `Cuenta #${cuenta.id}`}</p>
                      <p className="text-xs text-gray-500">{tipoLabel(cuenta)}</p>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ESTADO_STYLE[cuenta.estado] ?? 'bg-gray-100 text-gray-500'}`}>{cuenta.estado}</span>
                  </div>

                  <table className="w-full text-xs mb-2">
                    <tbody className="divide-y divide-gray-50">
                      {(cuenta.items ?? []).map((it) => (
                        <tr key={it.id}>
                          <td className="py-1 text-gray-700">
                            {it.ordenDetalle?.productoNombre ?? '—'}
                            {(it.ordenDetalle?.modificadores ?? []).map((m) => (
                              <p key={m.id} className="text-gray-400">{m.grupoNombre} {m.nombre}</p>
                            ))}
                          </td>
                          <td className="py-1 text-gray-500 text-right">{it.cantidad}</td>
                          <td className="py-1 text-gray-900 text-right">{fmt(it.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {Number(cuenta.propina) > 0 && (
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-500">Propina{cuenta.propinaPorcentaje != null ? ` (${Number(cuenta.propinaPorcentaje)}%)` : ''}</span>
                      <span className="text-gray-700">{fmt(cuenta.propina)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-500">Total de la cuenta</span>
                    <span className="font-semibold text-gray-900">{fmt(cuenta.total)}</span>
                  </div>

                  {(cuenta.pagos ?? []).length > 0 && (
                    <div className="space-y-0.5 mb-2">
                      {cuenta.pagos.map((p) => (
                        <div key={p.id} className="flex items-center justify-between text-xs">
                          <span className={p.cancelado ? 'text-gray-400 line-through' : 'text-gray-600'}>{METODOS[p.metodo] ?? p.metodo}</span>
                          <span className={p.cancelado ? 'text-gray-400 line-through' : 'text-gray-800'}>{fmt(p.monto)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {cuenta.estado === 'PAGADA' && (
                    <button
                      className="btn-secondary w-full py-1.5 text-xs disabled:opacity-40"
                      disabled={printingId === cuenta.id}
                      onClick={() => handleReprint(cuenta.id)}
                    >
                      {printingId === cuenta.id ? 'Imprimiendo…' : '🖨️ Reimprimir'}
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-center overflow-hidden">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Total</p>
              <p className="font-bold text-green-700 text-2xl mt-0.5 break-words">{fmt(detail.total)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
