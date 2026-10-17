import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getOrders } from '../api/ordenes'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const fmtDate = (d) => d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'

const PAGE_SIZES = [10, 20, 50, 100]
const EMPTY_FILTERS = { from: '', to: '', estado: '' }
const ESTADOS = ['ABIERTA', 'EN_PROCESO', 'LISTA', 'PENDIENTE_PAGO', 'PAGADA', 'CANCELADA']

/** Historial paginado de órdenes, con filtros por fecha y estado. */
export default function Orders() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(20)
  const [pageData, setPageData] = useState({ content: [], totalElements: 0, totalPages: 0 })

  function load() {
    const params = {
      page, size,
      estado: appliedFilters.estado || undefined,
      from: appliedFilters.from ? `${appliedFilters.from}T00:00:00` : undefined,
      to: appliedFilters.to ? `${appliedFilters.to}T23:59:59` : undefined,
    }
    getOrders(params)
      .then((r) => setPageData(r.data.data ?? { content: [], totalElements: 0, totalPages: 0 }))
      .catch(() => setPageData({ content: [], totalElements: 0, totalPages: 0 }))
  }
  useEffect(() => { load() }, [page, size, appliedFilters])

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

  const orders = pageData.content ?? []
  const totalPages = pageData.totalPages ?? 0
  const totalElements = pageData.totalElements ?? 0
  const from = totalElements === 0 ? 0 : page * size + 1
  const to = Math.min(totalElements, page * size + orders.length)

  return (
    <div>
      <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900 mb-6">Órdenes</h1>

      <form onSubmit={handleApplyFilters} className="card mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
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
        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1">Filtrar</button>
          <button type="button" className="btn-secondary" onClick={handleClearFilters}>Limpiar</button>
        </div>
      </form>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['#', 'Mesa', 'Mesero', 'Apertura', 'Total', 'Estado', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">#{o.id}</td>
                  <td className="px-4 py-3 text-gray-700">{o.mesa ? `Mesa ${o.mesa.numero}` : 'Para llevar'}</td>
                  <td className="px-4 py-3 text-gray-700">{o.mesero?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(o.openedAt)}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">{fmt(o.total)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      o.estado === 'PAGADA' ? 'bg-green-100 text-green-700'
                        : o.estado === 'CANCELADA' ? 'bg-gray-100 text-gray-500'
                        : 'bg-orange-100 text-orange-700'
                    }`}>{o.estado}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-blue-600 hover:underline text-xs" onClick={() => navigate(`/orders/${o.id}`)}>Ver</button>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Sin órdenes</td></tr>
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
    </div>
  )
}
