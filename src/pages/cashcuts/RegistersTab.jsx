import { useEffect, useState } from 'react'
import { getCashPeople, getCashRegisters, getHandovers, reopenCashRegisterDay } from '../../api/cashRegisters'
import { useNotify } from '../../context/NotifyContext'
import { ClosedMovementModal, ForceCloseModal, RegisterFormModal, ResolveHandoverModal } from './RegisterModals'
import { CountBadge, Pagination, PendingBreakdown, fmt, fmtDate, fmtTime } from './common'


const STATUS_BADGE = {
  OK: ['De acuerdo', 'bg-green-100 text-green-800'],
  DIFFERENCE: ['Diferencia', 'bg-red-100 text-red-800'],
  RESOLVED: ['Resuelta', 'bg-gray-100 text-gray-700'],
}
const RESOLUTION_LABELS = { UNREGISTERED_WITHDRAWAL: 'Retiro no registrado', SHORTAGE: 'Diferencia confirmada', COUNT_ERROR: 'Error de conteo' }

/**
 * Pestaña "Cajas" (admin/supervisor): una tarjeta por caja con su estado — en uso (cajero,
 * corte, efectivo esperado y "Forzar cierre") o cerrada (desglose de lo que recibirá el
 * siguiente turno, "Retirar" y "Agregar efectivo") — y el historial de entregas entre
 * turnos, con "Resolver" para las que tienen diferencia.
 */
export default function RegistersTab({ onChanged }) {
  const { notify, confirmDialog } = useNotify()
  const [registers, setRegisters] = useState([])
  const [people, setPeople] = useState([])
  const [handovers, setHandovers] = useState({ content: [], totalPages: 0 })
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(10)
  // { kind: 'form'|'closed'|'force'|'resolve', register?, handover?, type? }
  const [modal, setModal] = useState(null)

  function loadRegisters() {
    getCashRegisters()
      .then((r) => setRegisters(r.data.data ?? []))
      .catch((err) => notify(err.response?.data?.message ?? 'No se pudieron cargar las cajas', 'error'))
  }
  function loadHandovers() {
    getHandovers({ page, size })
      .then((r) => setHandovers(r.data.data ?? { content: [], totalPages: 0 }))
      .catch(() => setHandovers({ content: [], totalPages: 0 }))
  }

  useEffect(() => { loadRegisters() }, [])
  useEffect(() => { loadHandovers() }, [page, size])
  useEffect(() => { getCashPeople().then((r) => setPeople(r.data.data ?? [])).catch(() => setPeople([])) }, [])

  async function reopenDay(r) {
    if (!(await confirmDialog(`¿Reabrir ${r.name}? Ya hizo su corte de fin de día; al reabrirla, cualquiera podrá volver a abrir corte en ella hoy.`, { confirmText: 'Reabrir caja', danger: false }))) return
    try {
      await reopenCashRegisterDay(r.id)
      notify(`${r.name} reabierta`, 'success')
      afterSave()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo reabrir la caja', 'error')
    }
  }

  function afterSave() {
    setModal(null)
    loadRegisters()
    loadHandovers()
    onChanged?.()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500 max-w-2xl">
          Cada caja es un cajón físico. Lo que queda al cerrar, más o menos lo que muevas con la caja cerrada, lo recibe el siguiente turno de esa caja.
        </p>
        <button className="btn-primary" onClick={() => setModal({ kind: 'form' })}>+ Nueva caja</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {registers.map((r) => {
          const p = r.pending
          return (
            <div key={r.id} className={`card space-y-3 ${r.isActive ? '' : 'opacity-70'}`}>
              <div className="flex justify-between items-center gap-2">
                <span className="text-lg font-bold text-gray-900">{r.name}</span>
                <span className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${!r.isActive ? 'bg-gray-200 text-gray-700' : r.openCut ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                    {!r.isActive ? 'Desactivada' : r.openCut ? 'En uso' : r.dayClosed ? 'Fin de día' : 'Cerrada'}
                  </span>
                  <button type="button" className="text-xs text-purple-700 hover:underline" onClick={() => setModal({ kind: 'form', register: r })}>Editar</button>
                </span>
              </div>

              {r.openCut ? (
                <>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Cajero</span><span className="font-medium">{r.openCut.userName}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Corte</span><span>#{r.openCut.id} · desde {fmtTime(r.openCut.openedAt)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Efectivo esperado</span><span className="font-bold">{fmt(r.openCut.expectedCash)}</span></div>
                  </div>
                  <button className="w-full min-h-[44px] rounded-lg border border-red-600 text-red-700 font-semibold hover:bg-red-50" onClick={() => setModal({ kind: 'force', register: r })}>
                    Forzar cierre
                  </button>
                </>
              ) : (
                <>
                  {p?.amount != null ? (
                    <div className="space-y-2">
                      <PendingBreakdown pending={p} compact />
                      <div className="flex justify-between border-t border-gray-100 pt-2 font-bold text-sm"><span>Queda para recibir</span><span>{fmt(p.amount)}</span></div>
                      <CountBadge method={p.countMethod} name={p.countedByName} />
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Sin entrega pendiente.</p>
                  )}
                  {r.isActive && r.dayClosed && (
                    <button className="w-full min-h-[44px] rounded-lg border border-purple-600 text-purple-700 font-semibold hover:bg-purple-50" onClick={() => reopenDay(r)}>
                      Reabrir caja
                    </button>
                  )}
                  {r.isActive && (
                    <div className="grid grid-cols-2 gap-2">
                      <button className="btn-secondary text-red-700" onClick={() => setModal({ kind: 'closed', register: r, type: 'WITHDRAWAL' })} disabled={!p?.amount}>Retirar</button>
                      <button className="btn-secondary text-green-700" onClick={() => setModal({ kind: 'closed', register: r, type: 'FLOAT' })}>Agregar efectivo</button>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Últimas entregas de caja</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-gray-50">
              <tr>{['Caja', 'Entregó', 'Recibió', 'Debía recibir', 'Recibió', 'Estado'].map((h, i) => (
                <th key={i} className={`px-4 py-2 font-medium text-gray-600 ${i === 3 || i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {handovers.content.map((h) => {
                const [label, cls] = STATUS_BADGE[h.status] ?? ['—', 'bg-gray-100 text-gray-600']
                const diff = Number(h.difference ?? 0)
                return (
                  <tr key={h.cutId} className="align-top">
                    <td className="px-4 py-2">{h.registerName ?? '—'}</td>
                    <td className="px-4 py-2">{h.fromUserName ?? '—'}<div className="text-xs text-gray-500">{fmtDate(h.fromClosedAt)}</div></td>
                    <td className="px-4 py-2">{h.toUserName}<div className="text-xs text-gray-500">{fmtDate(h.toOpenedAt)}</div></td>
                    <td className="px-4 py-2 text-right">{fmt(h.expected)}</td>
                    <td className={`px-4 py-2 text-right ${diff !== 0 ? 'font-bold text-red-700' : ''}`}>{fmt(h.received)}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
                          {label}{diff !== 0 ? ` ${diff < 0 ? '−' : '+'}${fmt(Math.abs(diff))}` : ''}
                        </span>
                        {h.status === 'DIFFERENCE' && (
                          <button className="btn-secondary !py-1 !px-3 text-xs" onClick={() => setModal({ kind: 'resolve', handover: h })}>Resolver</button>
                        )}
                      </div>
                      {h.status === 'RESOLVED' && (
                        <div className="text-xs text-gray-500 mt-1">
                          {RESOLUTION_LABELS[h.resolution]} · {h.resolvedByName}{h.resolutionNote ? ` · «${h.resolutionNote}»` : ''}
                          {h.shortageId && <span className="block font-semibold text-red-700">Faltante a cargo de {h.shortagePersonName}</span>}
                        </div>
                      )}
                      {h.receiveNote && h.status !== 'RESOLVED' && <div className="text-xs text-gray-500 mt-1">«{h.receiveNote}»</div>}
                    </td>
                  </tr>
                )
              })}
              {handovers.content.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Todavía no hay entregas entre turnos</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page} size={size} totalElements={handovers.totalElements ?? 0} totalPages={handovers.totalPages ?? 0}
          count={handovers.content.length} onPageChange={setPage} onSizeChange={(n) => { setSize(n); setPage(0) }}
        />
      </div>

      {modal?.kind === 'form' && <RegisterFormModal register={modal.register} onClose={() => setModal(null)} onSaved={afterSave} />}
      {modal?.kind === 'closed' && (
        <ClosedMovementModal register={modal.register} initialType={modal.type} people={people} onClose={() => setModal(null)} onSaved={afterSave} />
      )}
      {modal?.kind === 'force' && <ForceCloseModal register={modal.register} people={people} onClose={() => setModal(null)} onSaved={afterSave} />}
      {modal?.kind === 'resolve' && <ResolveHandoverModal handover={modal.handover} people={people} onClose={() => setModal(null)} onSaved={afterSave} />}
    </div>
  )
}
