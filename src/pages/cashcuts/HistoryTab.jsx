import { useEffect, useState } from 'react'
import { getCashCutCashiers, getCashCutMovements, getCashCutSummary, getCashCuts } from '../../api/cashCuts'
import { getCashPeople } from '../../api/cashRegisters'
import ResolveArqueoModal, { ARQUEO_RESOLUTION_LABELS } from './ResolveArqueoModal'
import { resolveMediaUrl } from '../../utils/media'
import { filaClick, FILA_CLICK } from '../../utils/filaClick'
import IconButton from '../../components/IconButton'
import { CountBadge, Modal, Pagination, SummaryRow, fmt, fmtDate } from './common'
import CutMovementsTable from './CutMovementsTable'
import useTableSort from '../../hooks/useTableSort'
import SortableTh from '../../components/SortableTh'

const EMPTY_FILTERS = { from: '', to: '', status: '', userId: '', arqueoStatus: '' }

// Un corte cerrado sin `closedBy` lo cerró el job automático del backend: "Sistema".
const closedByLabel = (c) => c.status !== 'CLOSED' ? '—' : (c.closedBy?.name ?? 'Sistema')

/**
 * Pestaña "Historial" (admin/supervisor): todos los cortes de la tienda con filtros y
 * paginación server-side. Los filtros aplican solos al cambiar (son fechas/selects, sin
 * debounce). El filtro "Cajero" sale de `GET /cash-cuts/cashiers` para no depender de que
 * el admin tenga la sección Usuarios.
 */
export default function HistoryTab({ onChanged }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  // Orden de la tabla por encabezado (se aplica en el servidor; ver useTableSort).
  const tableSort = useTableSort('sort:cashcuts')
  const onSort = (k) => { tableSort.toggle(k); setPage(0) }
  const [size, setSize] = useState(20)
  const [pageData, setPageData] = useState({ content: [], totalElements: 0, totalPages: 0 })
  const [cashiers, setCashiers] = useState([])
  const [detail, setDetail] = useState(null)
  const [resolving, setResolving] = useState(null)
  const [people, setPeople] = useState([])
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const params = {
      page, size, ...tableSort.params,
      status: filters.status || undefined,
      userId: filters.userId || undefined,
      arqueoStatus: filters.arqueoStatus || undefined,
      from: filters.from ? `${filters.from}T00:00:00` : undefined,
      to: filters.to ? `${filters.to}T23:59:59` : undefined,
    }
    getCashCuts(params)
      .then((r) => setPageData(r.data.data ?? { content: [], totalElements: 0, totalPages: 0 }))
      .catch(() => setPageData({ content: [], totalElements: 0, totalPages: 0 }))
  }, [page, size, filters, reloadKey, tableSort.sort])

  useEffect(() => {
    getCashCutCashiers().then((r) => setCashiers(r.data.data ?? [])).catch(() => setCashiers([]))
    getCashPeople().then((r) => setPeople(r.data.data ?? [])).catch(() => setPeople([]))
  }, [])

  function setFilter(patch) {
    setFilters((prev) => ({ ...prev, ...patch }))
    setPage(0)
  }
  const hasFilters = filters.from || filters.to || filters.status || filters.userId || filters.arqueoStatus

  const cuts = pageData.content ?? []
  const totalPages = pageData.totalPages ?? 0
  const totalElements = pageData.totalElements ?? 0

  return (
    <>
      <div className="card mb-4 flex flex-wrap gap-3 items-end">
        <div className="w-36">
          <label className="text-xs font-medium text-gray-600 block mb-1">Desde</label>
          <input type="date" className="input" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} />
        </div>
        <div className="w-36">
          <label className="text-xs font-medium text-gray-600 block mb-1">Hasta</label>
          <input type="date" className="input" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} />
        </div>
        <div className="w-40">
          <label className="text-xs font-medium text-gray-600 block mb-1">Estado</label>
          <select className="input" value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
            <option value="">Todos</option>
            <option value="OPEN">Abierto</option>
            <option value="CLOSED">Cerrado</option>
          </select>
        </div>
        <div className="w-48">
          <label className="text-xs font-medium text-gray-600 block mb-1">Cajero</label>
          <select className="input" value={filters.userId} onChange={(e) => setFilter({ userId: e.target.value })}>
            <option value="">Todos</option>
            {cashiers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="w-48">
          <label className="text-xs font-medium text-gray-600 block mb-1">Diferencia de arqueo</label>
          <select className="input" value={filters.arqueoStatus} onChange={(e) => setFilter({ arqueoStatus: e.target.value })}>
            <option value="">Todas</option>
            <option value="DIFFERENCE">Pendiente de resolver</option>
            <option value="RESOLVED">Resuelta</option>
          </select>
        </div>
        {hasFilters && (
          <button type="button" className="btn-secondary text-sm" onClick={() => { setFilters(EMPTY_FILTERS); setPage(0) }}>Limpiar filtros</button>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <SortableTh label="#" sortKey="id" sort={tableSort.sort} onSort={onSort} className="text-left px-4 py-3 font-medium text-gray-600" align="left" />
                <SortableTh label="Caja" sortKey="register" sort={tableSort.sort} onSort={onSort} className="text-left px-4 py-3 font-medium text-gray-600" align="left" />
                <SortableTh label="Apertura" sortKey="opened" sort={tableSort.sort} onSort={onSort} className="text-left px-4 py-3 font-medium text-gray-600" align="left" />
                <SortableTh label="Cierre" sortKey="closed" sort={tableSort.sort} onSort={onSort} className="text-left px-4 py-3 font-medium text-gray-600" align="left" />
                <SortableTh label="Cajero" sortKey="cashier" sort={tableSort.sort} onSort={onSort} className="text-left px-4 py-3 font-medium text-gray-600" align="left" />
                <th className="text-left px-4 py-3 font-medium text-gray-600">Cerrado por</th>
                <SortableTh label="Ventas" sortKey="sales" sort={tableSort.sort} onSort={onSort} className="text-left px-4 py-3 font-medium text-gray-600" align="left" />
                <th className="text-left px-4 py-3 font-medium text-gray-600">Arqueo</th>
                <SortableTh label="Estado" sortKey="status" sort={tableSort.sort} onSort={onSort} className="text-left px-4 py-3 font-medium text-gray-600" align="left" />
                <th className="text-left px-4 py-3 font-medium text-gray-600"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {cuts.map((c) => {
                const diff = c.cashDifference != null ? Number(c.cashDifference) : null
                return (
                  <tr key={c.id} {...filaClick(() => setDetail(c))} className={`${FILA_CLICK} hover:bg-gray-50`}>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">#{c.id}</td>
                    <td className="px-4 py-3 text-gray-700">{c.cashRegister?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(c.openedAt)}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(c.closedAt)}</td>
                    <td className="px-4 py-3 text-gray-700">{c.user?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{closedByLabel(c)}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{fmt(c.totalSales)}</td>
                    <td className="px-4 py-3">
                      {c.status !== 'CLOSED' ? '—'
                        : diff == null ? <span className="text-xs text-amber-800">No contado</span>
                        : diff === 0 ? <span className="text-xs text-green-700 font-semibold">Cuadra</span>
                        : <span className={`text-xs font-semibold ${diff < 0 ? 'text-red-700' : 'text-amber-800'}`}>{diff < 0 ? 'Faltante' : 'Sobrante'} {fmt(Math.abs(diff))}</span>}
                      {c.arqueoStatus === 'DIFFERENCE' && (
                        <button type="button" className="block mt-1 btn-secondary !py-0.5 !px-2 text-xs" onClick={() => setResolving(c)}>Resolver</button>
                      )}
                      {c.arqueoStatus === 'RESOLVED' && (
                        <span className="block mt-0.5 text-xs text-gray-500">Resuelta · {ARQUEO_RESOLUTION_LABELS[c.arqueoResolution]}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${c.status === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {c.status === 'OPEN' ? 'Abierto' : 'Cerrado'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <IconButton icon="ver" label="Ver corte" variant="primary" onClick={() => setDetail(c)} />
                    </td>
                  </tr>
                )
              })}
              {cuts.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Sin cortes</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page} size={size} totalElements={totalElements} totalPages={totalPages} count={cuts.length}
          onPageChange={setPage} onSizeChange={(n) => { setSize(n); setPage(0) }}
        />
      </div>

      {detail && <CutDetailModal cut={detail} onClose={() => setDetail(null)} />}
      {resolving && (
        <ResolveArqueoModal
          cut={resolving} people={people} onClose={() => setResolving(null)}
          onSaved={() => { setResolving(null); setReloadKey((k) => k + 1); onChanged?.() }}
        />
      )}
    </>
  )
}

/**
 * Detalle de un corte: recepción (de quién y cuánto), ventas por método, movimientos de
 * efectivo, efectivo esperado y arqueo. Si sigue abierto, los totales se piden en vivo.
 */
export function CutDetailModal({ cut, onClose }) {
  const [summary, setSummary] = useState(null)
  const [movements, setMovements] = useState([])

  useEffect(() => {
    getCashCutSummary(cut.id).then((r) => setSummary(r.data.data)).catch(() => setSummary(null))
    getCashCutMovements(cut.id).then((r) => setMovements(r.data.data ?? [])).catch(() => setMovements([]))
  }, [cut.id])

  const s = summary ?? cut
  const closed = cut.status === 'CLOSED'
  const diff = cut.cashDifference != null ? Number(cut.cashDifference) : null

  return (
    <Modal title={`Corte #${cut.id}`} subtitle={`${cut.cashRegister?.name ? `${cut.cashRegister.name} · ` : ''}${cut.user?.name ?? ''}`} onClose={onClose} wide="xl">
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <SummaryRow label="Apertura">{fmtDate(cut.openedAt)}</SummaryRow>
          <SummaryRow label="Cierre">{fmtDate(cut.closedAt)}</SummaryRow>
          <SummaryRow label="Cerrado por">{closedByLabel(cut)}</SummaryRow>
        </div>

        {cut.expectedOpeningAmount != null && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-semibold text-gray-600">Recepción de la caja</p>
            <SummaryRow label={`Debía recibir${cut.previousUserName ? ` (de ${cut.previousUserName})` : ''}`}>{fmt(cut.expectedOpeningAmount)}</SummaryRow>
            <SummaryRow label="Contó al recibir">{fmt(Number(cut.expectedOpeningAmount) + Number(cut.handoverDifference ?? 0))}</SummaryRow>
            {Number(cut.handoverDifference ?? 0) !== 0 && (
              <p className={cut.handoverStatus === 'RESOLVED' ? 'text-gray-600' : 'text-red-700'}>
                Diferencia {fmt(cut.handoverDifference)} · {cut.handoverStatus === 'RESOLVED' ? 'resuelta' : 'pendiente de resolver'}
              </p>
            )}
            {cut.receiveNote && <p className="text-gray-600">«{cut.receiveNote}»</p>}
          </div>
        )}

        <div className="space-y-1.5">
          <SummaryRow label="Fondo inicial">{fmt(s.openingAmount)}</SummaryRow>
          <SummaryRow label="Transacciones">{s.totalTransactions ?? 0}</SummaryRow>
          <SummaryRow label="  · Efectivo">{fmt(s.cashSales)}</SummaryRow>
          <SummaryRow label="  · Tarjeta">{fmt(s.cardSales)}</SummaryRow>
          <SummaryRow label="  · Transferencia">{fmt(s.transferSales)}</SummaryRow>
          <SummaryRow label="Total ventas">{fmt(s.totalSales)}</SummaryRow>
          {s.cancelledCount > 0 && <p className="text-red-600">Cobros cancelados ({s.cancelledCount}): −{fmt(s.cancelledTotal)}</p>}
          {Number(summary?.cardRefunds) > 0 && (
            <SummaryRow label="Devoluciones con tarjeta (informativo)">{fmt(summary.cardRefunds)}</SummaryRow>
          )}
          {Number(summary?.transferRefunds) > 0 && (
            <SummaryRow label="Devoluciones con transferencia (informativo)">{fmt(summary.transferRefunds)}</SummaryRow>
          )}
          <SummaryRow label="Entradas">+{fmt(summary?.entriesTotal ?? cut.entriesTotal)}</SummaryRow>
          <SummaryRow label="Gastos">−{fmt(summary?.expensesTotal ?? cut.expenses)}</SummaryRow>
          <SummaryRow label="Retiros">−{fmt(summary?.withdrawalsTotal ?? cut.withdrawalsTotal)}</SummaryRow>
          <SummaryRow label="Reembolsos pagados">−{fmt(summary?.reimbursementsTotal ?? cut.reimbursementsTotal)}</SummaryRow>
          {Number(summary?.loansOutTotal ?? cut.loansOutTotal) > 0 && (
            <SummaryRow label="Préstamos a otras cajas">−{fmt(summary?.loansOutTotal ?? cut.loansOutTotal)}</SummaryRow>
          )}
          {Number(summary?.refundsTotal ?? cut.refundsTotal) > 0 && (
            <SummaryRow label="Devoluciones en efectivo">−{fmt(summary?.refundsTotal ?? cut.refundsTotal)}</SummaryRow>
          )}
          <div className="border-t border-gray-100 pt-1.5">
            <SummaryRow label="Efectivo esperado" strong>{fmt(closed ? cut.closingAmount : summary?.expectedCash)}</SummaryRow>
          </div>
        </div>

        {closed && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-semibold text-gray-600">Arqueo</p>
            {cut.countedAmount != null ? (
              <>
                <SummaryRow label="Contado">{fmt(cut.countedAmount)}</SummaryRow>
                <SummaryRow label="Diferencia">
                  <span className={diff === 0 ? 'text-green-700' : diff < 0 ? 'text-red-700' : 'text-amber-800'}>
                    {diff === 0 ? 'Cuadra' : `${diff < 0 ? 'Faltante' : 'Sobrante'} ${fmt(Math.abs(diff))}`}
                  </span>
                </SummaryRow>
              </>
            ) : <p className="text-amber-800">No se contó el efectivo.</p>}
            <CountBadge method={cut.countMethod} name={cut.countedBy?.name} />
            {cut.countEvidencePath && (
              <a className="block text-purple-700 hover:underline" href={resolveMediaUrl(cut.countEvidencePath)} target="_blank" rel="noopener noreferrer">Ver evidencia del conteo</a>
            )}
            {cut.handoverAmount != null && <SummaryRow label="Dejó en caja">{fmt(cut.handoverAmount)}</SummaryRow>}
            {cut.arqueoStatus === 'RESOLVED' && (
              <p className="text-gray-600">
                Resuelta como <strong>{ARQUEO_RESOLUTION_LABELS[cut.arqueoResolution]}</strong> por {cut.arqueoResolvedBy?.name ?? '—'}
                {cut.arqueoResolutionNote ? ` · «${cut.arqueoResolutionNote}»` : ''}
              </p>
            )}
            {cut.arqueoStatus === 'DIFFERENCE' && <p className="text-red-700 font-semibold">Diferencia pendiente de resolver</p>}
          </div>
        )}

        <CutMovementsTable cutId={cut.id} movements={movements} sortKey="sort:cutDetailMovements" card={false} />

        {cut.notes && <p className="text-gray-500 text-xs">{cut.notes}</p>}
      </div>
    </Modal>
  )
}
