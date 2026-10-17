import { useEffect, useState } from 'react'
import { getCashPeople, getCashRegisters } from '../../api/cashRegisters'
import { getPendingReimbursementTotal, getReimbursements, payReimbursement } from '../../api/reimbursements'
import { useAuth } from '../../context/AuthContext'
import { useNotify } from '../../context/NotifyContext'
import { resolveMediaUrl } from '../../utils/media'
import { Modal, Pagination, PersonSelect, ReceiptInput, fmt, fmtDate } from './common'

const METHOD_LABELS = { TRANSFER: 'Transferencia', EXTERNAL_CASH: 'Efectivo externo' }

/**
 * Pestaña "Reembolsos" (admin/supervisor): lo que la tienda le debe a quien puso efectivo
 * de su bolsa, en Pendientes/Pagados. Pagar siempre pregunta de dónde sale el dinero.
 */
export default function ReimbursementsTab({ onChanged }) {
  const [status, setStatus] = useState('PENDING')
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(20)
  const [data, setData] = useState({ content: [], totalPages: 0, totalElements: 0 })
  const [pendingTotal, setPendingTotal] = useState(0)
  const [paying, setPaying] = useState(null)

  function load() {
    getReimbursements({ status, page, size })
      .then((r) => setData(r.data.data ?? { content: [], totalPages: 0, totalElements: 0 }))
      .catch(() => setData({ content: [], totalPages: 0, totalElements: 0 }))
    getPendingReimbursementTotal().then((r) => setPendingTotal(r.data.data ?? 0)).catch(() => {})
  }
  useEffect(() => { load() }, [status, page, size])

  const rows = data.content ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div role="tablist" className="flex gap-2">
          {[{ key: 'PENDING', label: 'Pendientes' }, { key: 'PAID', label: 'Pagados' }].map((t) => (
            <button
              key={t.key} role="tab" aria-selected={status === t.key}
              className={`min-h-[40px] px-4 rounded-full text-sm font-semibold ${status === t.key ? 'bg-purple-600 text-white' : 'bg-white border border-gray-300 text-gray-700'}`}
              onClick={() => { setStatus(t.key); setPage(0) }}
            >{t.label}</button>
          ))}
        </div>
        <div className="card !py-3 !px-5">
          <p className="text-sm text-gray-500">Total pendiente</p>
          <p className="text-2xl font-bold text-amber-800">{fmt(pendingTotal)}</p>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-gray-50">
              <tr>
                {['Persona', 'Motivo', 'Corte', 'Fecha', 'Monto', status === 'PENDING' ? '' : 'Pago'].map((h, i) => (
                  <th key={i} className={`px-4 py-2 font-medium text-gray-600 ${h === 'Monto' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2 font-medium">{r.person?.name}</td>
                  <td className="px-4 py-2">{r.reason ?? '—'}</td>
                  <td className="px-4 py-2">{r.sourceCutId ? `#${r.sourceCutId}` : '—'}</td>
                  <td className="px-4 py-2 text-gray-500">{fmtDate(r.createdAt)}</td>
                  <td className="px-4 py-2 text-right font-bold">{fmt(r.amount)}</td>
                  <td className="px-4 py-2">
                    {r.status === 'PENDING' ? (
                      <button className="btn-secondary !py-1 !px-3 text-xs whitespace-nowrap" onClick={() => setPaying(r)}>Marcar como pagado</button>
                    ) : (
                      <div className="text-xs text-gray-600 space-y-0.5">
                        <div className="font-medium text-gray-800">
                          {r.paymentSource === 'CASH_CUT' ? `De la caja · corte #${r.paymentCutId}` : `${METHOD_LABELS[r.externalMethod] ?? 'Por fuera'} · pagó ${r.externalPaidBy?.name ?? '—'}`}
                        </div>
                        <div>{fmtDate(r.paidAt)} · registró {r.paidRegisteredBy?.name ?? '—'}</div>
                        {r.reference && <div>Ref. {r.reference}</div>}
                        {r.receiptPath && <a className="text-purple-700 hover:underline" href={resolveMediaUrl(r.receiptPath)} target="_blank" rel="noopener noreferrer">Ver comprobante</a>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">{status === 'PENDING' ? 'No hay reembolsos pendientes' : 'Sin reembolsos pagados'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page} size={size} totalElements={data.totalElements ?? 0} totalPages={data.totalPages ?? 0}
          count={rows.length} onPageChange={setPage} onSizeChange={(n) => { setSize(n); setPage(0) }}
        />
      </div>
      <p className="text-sm text-gray-500">
        Al marcarlo como pagado se pregunta de dónde sale el dinero: de una caja abierta (se registra como salida en ese corte) o por fuera de la caja (solo queda la constancia de quién lo pagó y cuándo).
      </p>

      {paying && (
        <PayReimbursementModal
          reimbursement={paying}
          onClose={() => setPaying(null)}
          onPaid={() => { setPaying(null); load(); onChanged?.() }}
        />
      )}
    </div>
  )
}

/**
 * Pagar un reembolso: de la caja de un corte abierto (deshabilitado si no hay ninguno o
 * ninguno alcanza) o por fuera de la caja (método, quién pagó, referencia y comprobante).
 */
function PayReimbursementModal({ reimbursement, onClose, onPaid }) {
  const { user } = useAuth()
  const { notify, confirmDialog } = useNotify()
  const amount = Number(reimbursement.amount)
  const [openCuts, setOpenCuts] = useState(null)
  const [people, setPeople] = useState([])
  const [source, setSource] = useState(null)
  const [cutId, setCutId] = useState(null)
  const [method, setMethod] = useState('TRANSFER')
  const [paidById, setPaidById] = useState(user?.id ?? null)
  const [reference, setReference] = useState('')
  const [receiptPath, setReceiptPath] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getCashRegisters().then((r) => {
      const cuts = (r.data.data ?? []).filter((x) => x.openCut).map((x) => ({ ...x.openCut, registerName: x.name }))
      setOpenCuts(cuts)
      const enough = cuts.find((c) => Number(c.expectedCash) >= amount)
      setCutId(enough?.id ?? null)
      setSource(enough ? 'CASH_CUT' : 'EXTERNAL')
    }).catch(() => { setOpenCuts([]); setSource('EXTERNAL') })
    getCashPeople().then((r) => setPeople(r.data.data ?? [])).catch(() => {})
  }, [amount])

  const usableCuts = (openCuts ?? []).filter((c) => Number(c.expectedCash) >= amount)
  const selectedCut = usableCuts.find((c) => c.id === cutId)
  const cashDisabledReason = openCuts == null ? 'Cargando…'
    : openCuts.length === 0 ? 'No hay ninguna caja abierta. Abre un corte para pagar desde la caja.'
    : usableCuts.length === 0 ? `Ninguna caja abierta tiene ${fmt(amount)} disponibles.` : null

  async function handleSubmit(e) {
    e.preventDefault()
    if (source === 'CASH_CUT' && !selectedCut) { notify('Elige la caja de la que sale el dinero', 'error'); return }
    if (reference.length > 100) { notify('La referencia no puede tener más de 100 caracteres', 'error'); return }
    const msg = source === 'CASH_CUT'
      ? `¿Pagar ${fmt(amount)} a ${reimbursement.person?.name} con efectivo de ${selectedCut.registerName} (corte #${selectedCut.id})?`
      : `¿Registrar que se le pagaron ${fmt(amount)} a ${reimbursement.person?.name} por fuera de la caja?`
    if (!(await confirmDialog(msg, { confirmText: 'Confirmar pago', danger: false }))) return
    setLoading(true)
    try {
      await payReimbursement(reimbursement.id, source === 'CASH_CUT'
        ? { source, cashCutId: selectedCut.id }
        : { source, method, paidById, reference: reference.trim() || null, receiptPath: receiptPath || null })
      notify('Reembolso pagado', 'success')
      onPaid()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo pagar el reembolso', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="Pagar reembolso" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="flex justify-between font-bold"><span>{reimbursement.person?.name}</span><span>{fmt(amount)}</span></div>
          {reimbursement.reason && <p className="text-sm text-gray-600">{reimbursement.reason}</p>}
          <p className="text-xs text-gray-500">{reimbursement.sourceCutId ? `Aportado en corte #${reimbursement.sourceCutId} · ` : ''}{fmtDate(reimbursement.createdAt)}</p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-gray-600 mb-1">¿De dónde sale el dinero?</legend>
          <label className={`flex gap-3 items-start p-3 rounded-xl ${cashDisabledReason ? 'border border-dashed border-gray-300 bg-gray-50 cursor-not-allowed'
            : source === 'CASH_CUT' ? 'border-2 border-purple-600 bg-purple-50 cursor-pointer' : 'border border-gray-200 cursor-pointer'}`}>
            <input type="radio" name="pay-source" className="mt-1 w-4 h-4" disabled={!!cashDisabledReason} checked={source === 'CASH_CUT'} onChange={() => setSource('CASH_CUT')} />
            <span className="flex-1">
              <span className={`block font-semibold text-sm ${cashDisabledReason ? 'text-gray-500' : ''}`}>De la caja</span>
              {cashDisabledReason
                ? <span className="block text-sm text-red-700">{cashDisabledReason}</span>
                : usableCuts.length === 1
                  ? <span className="block text-sm text-gray-500">{usableCuts[0].registerName} · corte #{usableCuts[0].id} de {usableCuts[0].userName} · disponible {fmt(usableCuts[0].expectedCash)}</span>
                  : (
                    <select className="input mt-1" value={cutId ?? ''} onChange={(e) => setCutId(Number(e.target.value))} onClick={() => setSource('CASH_CUT')}>
                      {usableCuts.map((c) => <option key={c.id} value={c.id}>{c.registerName} · corte #{c.id} de {c.userName} · disponible {fmt(c.expectedCash)}</option>)}
                    </select>
                  )}
            </span>
          </label>
          <label className={`flex gap-3 items-start p-3 rounded-xl cursor-pointer ${source === 'EXTERNAL' ? 'border-2 border-purple-600 bg-purple-50' : 'border border-gray-200'}`}>
            <input type="radio" name="pay-source" className="mt-1 w-4 h-4" checked={source === 'EXTERNAL'} onChange={() => setSource('EXTERNAL')} />
            <span>
              <span className="block font-semibold text-sm">Por fuera de la caja</span>
              <span className="block text-sm text-gray-500">Transferencia o efectivo que no pasa por ningún corte.</span>
            </span>
          </label>
        </fieldset>

        {source === 'CASH_CUT' && selectedCut && (
          <div className="text-sm text-blue-900 bg-blue-50 rounded-lg p-3 space-y-1">
            <p className="font-semibold">Qué va a pasar</p>
            <p>Se registra una salida de −{fmt(amount)} en el corte #{selectedCut.id} ({selectedCut.registerName}) con el concepto «Reembolso a {reimbursement.person?.name}».</p>
            <p>El efectivo esperado de ese corte baja a {fmt(Number(selectedCut.expectedCash) - amount)}.</p>
          </div>
        )}

        {source === 'EXTERNAL' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="pay-method" className="text-xs font-medium text-gray-600 block mb-1">Método</label>
                <select id="pay-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <PersonSelect id="pay-by" label="¿Quién pagó?" people={people} value={paidById} onChange={setPaidById} />
            </div>
            <div>
              <label htmlFor="pay-reference" className="text-xs font-medium text-gray-600 block mb-1">Referencia (opcional)</label>
              <input id="pay-reference" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Número o clave de rastreo de la transferencia" />
            </div>
            <ReceiptInput value={receiptPath} onChange={setReceiptPath} label="Comprobante (opcional): captura o foto" />
            <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">No se toca ningún corte de caja. Solo queda la constancia de quién pagó, cuándo y cómo.</p>
          </>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={loading || !source}>{loading ? '...' : 'Confirmar pago'}</button>
        </div>
      </form>
    </Modal>
  )
}
