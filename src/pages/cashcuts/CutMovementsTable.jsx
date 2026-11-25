import { useState } from 'react'
import { resolveMediaUrl } from '../../utils/media'
import useTableSort from '../../hooks/useTableSort'
import SortableTh from '../../components/SortableTh'
import IconButton from '../../components/IconButton'
import { CancelledByOtherNotice, cancelledToMovements, refundsToMovements, useCutPayments } from './CutPayments'
import { beforeOpeningToMovements, useBeforeOpeningMovements } from './BeforeOpening'
import { MovementBadge, Pagination, SignedAmount, fmtTime, signedCashAmount } from './common'

// Valor por el que se ordena cada columna. El monto va con signo (salidas negativas), igual que se muestra.
const SORT_VALUE = {
  time: (m) => m.createdAt ?? '',
  type: (m) => m.type ?? '',
  concept: (m) => (m.concept ?? '').toLowerCase(),
  by: (m) => (m.registeredBy?.name ?? '').toLowerCase(),
  amount: signedCashAmount,
}

/** Ordenados por la columna elegida; sin orden elegido, del más reciente al más antiguo. */
function sortMovements(movements, sort) {
  const value = sort && SORT_VALUE[sort.key]
  if (!value) return [...movements].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  const factor = sort.dir === 'desc' ? -1 : 1
  return [...movements].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    return (va < vb ? -1 : va > vb ? 1 : 0) * factor
  })
}

/**
 * Tabla "Movimientos del turno": los movimientos de efectivo del corte más sus cobros
 * cancelados (con quién los canceló), las devoluciones y lo registrado antes de abrir,
 * ordenable y paginada en pantalla (un turno tiene pocos). La usan "Mi caja" (el cajero), el
 * detalle del corte y "Ver movimientos del turno" en Cajas (admin/supervisor).
 *
 * @param cutId      corte del que se piden cobros cancelados, devoluciones y lo de antes de abrir
 * @param movements  movimientos de efectivo del corte (ya cargados por quien la usa)
 * @param reloadKey  cambia para volver a pedir lo demás
 * @param pendingIds ids de reembolsos pendientes, para la etiqueta de los aportes reembolsables
 * @param sortKey    llave de localStorage del orden elegido
 */
export default function CutMovementsTable({ cutId, movements: cashMovements, reloadKey, pendingIds, sortKey = 'sort:myCashMovements', card = true }) {
  const { cancelled, refunds } = useCutPayments(cutId, reloadKey)
  const beforeOpening = useBeforeOpeningMovements(cutId, reloadKey)
  const movements = [
    ...cashMovements, ...cancelledToMovements(cancelled), ...refundsToMovements(refunds),
    ...beforeOpeningToMovements(beforeOpening),
  ]
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(10)
  const movSort = useTableSort(sortKey)
  const onSort = (k) => { movSort.toggle(k); setPage(0) }

  const totalPages = Math.ceil(movements.length / size)
  const safePage = Math.min(page, Math.max(totalPages - 1, 0))
  const paged = sortMovements(movements, movSort.sort).slice(safePage * size, (safePage + 1) * size)

  return (
    <div className={card ? 'card p-0 overflow-hidden' : 'border border-gray-100 rounded-lg overflow-hidden'}>
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap justify-between gap-2">
        <h3 className="font-semibold text-gray-900">Movimientos del turno</h3>
        <span className="text-xs text-gray-500">Esperado = fondo + ventas en efectivo + entradas − salidas</span>
      </div>
      {cancelled.some((r) => r.byOther) && <div className="px-4 pt-3"><CancelledByOtherNotice rows={cancelled} /></div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-gray-50">
            <tr>
              <SortableTh label="Hora" sortKey="time" sort={movSort.sort} onSort={onSort} className="px-4 py-2 font-medium text-gray-600 text-left" />
              <SortableTh label="Tipo" sortKey="type" sort={movSort.sort} onSort={onSort} className="px-4 py-2 font-medium text-gray-600 text-left" />
              <SortableTh label="Concepto" sortKey="concept" sort={movSort.sort} onSort={onSort} className="px-4 py-2 font-medium text-gray-600 text-left" />
              <SortableTh label="Registró" sortKey="by" sort={movSort.sort} onSort={onSort} className="px-4 py-2 font-medium text-gray-600 text-left" />
              <th className="px-4 py-2 font-medium text-gray-600 text-left">Comprobante</th>
              <SortableTh label="Monto" sortKey="amount" sort={movSort.sort} onSort={onSort} className="px-4 py-2 font-medium text-gray-600 text-right" align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {paged.map((m) => (
              <tr key={m.id} className={m.byOther ? 'bg-amber-50/60' : ''}>
                <td className="px-4 py-2 text-gray-500">{fmtTime(m.createdAt)}</td>
                <td className="px-4 py-2"><MovementBadge type={m.type} /></td>
                <td className="px-4 py-2">
                  <div className="[overflow-wrap:anywhere]">{m.concept ?? '—'}</div>
                  {m.detail && <div className="text-xs text-gray-500">{m.detail}</div>}
                  {m.person && <div className="text-xs text-gray-500">{m.type === 'CONTRIBUTION' ? 'Puso' : 'Persona'}: {m.person.name}</div>}
                  {m.type === 'CONTRIBUTION' && m.reimbursementId && pendingIds && (
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold ${pendingIds.has(m.reimbursementId) ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                      Reembolsable · {pendingIds.has(m.reimbursementId) ? 'pendiente' : 'pagado'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">{m.registeredBy?.name ?? '—'}</td>
                <td className="px-4 py-2">
                  {m.receiptPath ? <IconButton icon="documento" label="Ver foto del comprobante" variant="purple" href={resolveMediaUrl(m.receiptPath)} /> : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap"><SignedAmount type={m.type} amount={m.amount} cashEffect={m.cashEffect} /></td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Sin movimientos en este turno</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        page={safePage} size={size} totalElements={movements.length} totalPages={totalPages}
        count={paged.length} onPageChange={setPage} onSizeChange={(n) => { setSize(n); setPage(0) }}
      />
    </div>
  )
}
