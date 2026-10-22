import { useEffect, useState } from 'react'
import { getCashRegisters } from '../../api/cashRegisters'
import { getPendingShortageTotal, getShortagePayments, getShortages, payShortage } from '../../api/shortages'
import { useNotify } from '../../context/NotifyContext'
import { resolveMediaUrl } from '../../utils/media'
import { filaClick, FILA_CLICK } from '../../utils/filaClick'
import { AmountField, Modal, Pagination, ReceiptInput, SummaryRow, fmt, fmtDate, toAmount, MAX_AMOUNT } from './common'

export const SHORTAGE_METHOD_LABELS = {
  CASH_REGISTER: 'Efectivo a la caja',
  TRANSFER: 'Transferencia',
  EXTERNAL_CASH: 'Efectivo al administrador',
  PAYROLL: 'Descuento de nómina',
}

/**
 * Pestaña "Faltantes" (admin/supervisor): lo que una persona debe cubrir porque faltó en
 * una entrega de caja (se generan al resolver una diferencia como faltante confirmado). Cada
 * faltante se salda con "Pagar faltante" (lo que resta, completo) o "Abonar" (una parte);
 * el dinero puede entrar a una caja abierta o cubrirse por fuera.
 */
export default function ShortagesTab({ onChanged }) {
  const [paid, setPaid] = useState(false)
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(20)
  const [data, setData] = useState({ content: [], totalPages: 0, totalElements: 0 })
  const [pendingTotal, setPendingTotal] = useState(0)
  // { shortage, full: boolean } — full = "Pagar faltante" (lo que resta), si no "Abonar".
  const [paying, setPaying] = useState(null)
  const [history, setHistory] = useState(null)

  function load() {
    getShortages({ paid, page, size })
      .then((r) => setData(r.data.data ?? { content: [], totalPages: 0, totalElements: 0 }))
      .catch(() => setData({ content: [], totalPages: 0, totalElements: 0 }))
    getPendingShortageTotal().then((r) => setPendingTotal(Number(r.data.data ?? 0))).catch(() => {})
  }
  useEffect(() => { load() }, [paid, page, size])

  const rows = data.content ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div role="tablist" className="flex gap-2">
          {[{ key: false, label: 'Pendientes' }, { key: true, label: 'Pagados' }].map((t) => (
            <button
              key={String(t.key)} role="tab" aria-selected={paid === t.key}
              className={`min-h-[40px] px-4 rounded-full text-sm font-semibold ${paid === t.key ? 'bg-purple-600 text-white' : 'bg-white border border-gray-300 text-gray-700'}`}
              onClick={() => { setPaid(t.key); setPage(0) }}
            >{t.label}</button>
          ))}
        </div>
        <div className="card !py-3 !px-5">
          <p className="text-sm text-gray-500">Total por cubrir</p>
          <p className="text-2xl font-bold text-red-700">{fmt(pendingTotal)}</p>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead className="bg-gray-50">
              <tr>
                {['Responsable', 'Origen', 'Motivo', 'Faltante', 'Abonado', 'Resta', ''].map((h, i) => (
                  <th key={i} className={`px-4 py-2 font-medium text-gray-600 ${['Faltante', 'Abonado', 'Resta'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((s) => (
                <tr key={s.id} {...filaClick(Number(s.paidAmount) > 0 ? () => setHistory(s) : null)}
                  className={`align-top ${Number(s.paidAmount) > 0 ? `${FILA_CLICK} hover:bg-gray-50` : ''}`}>
                  <td className="px-4 py-2 font-medium">
                    {s.person?.name}
                    {s.status === 'PARTIAL' && <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">Con abonos</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className="block text-xs font-semibold text-gray-600">{s.origin === 'CLOSE' ? 'Arqueo al cerrar' : 'Al recibir la caja'}</span>
                    {s.registerName ?? 'Caja'}{s.sourceCutId ? ` · corte #${s.sourceCutId}` : ''}
                    <div className="text-xs text-gray-500">{fmtDate(s.createdAt)} · registró {s.createdBy?.name ?? '—'}</div>
                  </td>
                  <td className="px-4 py-2 max-w-[220px]">{s.reason ?? '—'}</td>
                  <td className="px-4 py-2 text-right">{fmt(s.amount)}</td>
                  <td className="px-4 py-2 text-right text-green-700">{fmt(s.paidAmount)}</td>
                  <td className="px-4 py-2 text-right font-bold text-red-700">{fmt(s.remaining)}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap justify-end gap-2">
                      {s.status !== 'PAID' && (
                        <>
                          <button className="btn-primary !py-1 !px-3 text-xs whitespace-nowrap" onClick={() => setPaying({ shortage: s, full: true })}>Pagar faltante</button>
                          <button className="btn-secondary !py-1 !px-3 text-xs" onClick={() => setPaying({ shortage: s, full: false })}>Abonar</button>
                        </>
                      )}
                      {Number(s.paidAmount) > 0 && (
                        <button className="text-xs text-purple-700 hover:underline whitespace-nowrap" onClick={() => setHistory(s)}>Ver pagos</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">{paid ? 'Sin faltantes pagados' : 'No hay faltantes pendientes'}</td></tr>
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
        Los faltantes se generan al resolver una diferencia de entrega como «faltante confirmado» (pestaña Cajas). El pago puede entrar a una caja abierta — queda como entrada en ese corte — o cubrirse por fuera.
      </p>

      {paying && (
        <PayShortageModal
          shortage={paying.shortage} full={paying.full}
          onClose={() => setPaying(null)}
          onPaid={() => { setPaying(null); load(); onChanged?.() }}
        />
      )}
      {history && <ShortagePaymentsModal shortage={history} onClose={() => setHistory(null)} />}
    </div>
  )
}

/**
 * Pagar (lo que resta, completo) o abonar (una parte) a un faltante. El dinero entra a una
 * caja abierta (se elige el corte) o se cubre por fuera: transferencia, efectivo al
 * administrador o descuento de nómina.
 */
function PayShortageModal({ shortage, full, onClose, onPaid }) {
  const { notify, confirmDialog } = useNotify()
  const remaining = Number(shortage.remaining)
  const [amount, setAmount] = useState(full ? String(remaining) : '')
  const [method, setMethod] = useState('CASH_REGISTER')
  const [openCuts, setOpenCuts] = useState(null)
  const [cutId, setCutId] = useState(null)
  const [reference, setReference] = useState('')
  const [receiptPath, setReceiptPath] = useState('')
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getCashRegisters().then((r) => {
      const cuts = (r.data.data ?? []).filter((x) => x.openCut).map((x) => ({ ...x.openCut, registerName: x.name }))
      setOpenCuts(cuts)
      setCutId(cuts[0]?.id ?? null)
      if (cuts.length === 0) setMethod('TRANSFER')
    }).catch(() => { setOpenCuts([]); setMethod('TRANSFER') })
  }, [])

  const amountNum = toAmount(amount)
  const selectedCut = (openCuts ?? []).find((c) => c.id === cutId)
  const noOpenCuts = openCuts != null && openCuts.length === 0

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = {}
    if (amountNum == null || amountNum <= 0) errs.amount = 'Captura un monto mayor a cero'
    else if (amountNum > MAX_AMOUNT) errs.amount = ''
    else if (amountNum > remaining) errs.amount = `No puede ser mayor a lo que resta (${fmt(remaining)})`
    if (method === 'CASH_REGISTER' && !selectedCut) errs.cut = 'Elige la caja a la que entra el dinero'
    if (reference.length > 100) errs.reference = 'La referencia no puede tener más de 100 caracteres'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    const what = amountNum === remaining ? `el pago de ${fmt(amountNum)} (salda el faltante)` : `un abono de ${fmt(amountNum)}`
    const where = method === 'CASH_REGISTER' ? ` que entra a ${selectedCut.registerName} (corte #${selectedCut.id})` : ` por ${SHORTAGE_METHOD_LABELS[method].toLowerCase()}`
    if (!(await confirmDialog(`¿Registrar ${what} de ${shortage.person?.name}${where}?`, { confirmText: 'Registrar pago', danger: false }))) return
    setLoading(true)
    try {
      await payShortage(shortage.id, {
        amount: amountNum, method,
        cashCutId: method === 'CASH_REGISTER' ? selectedCut.id : null,
        reference: reference.trim() || null, receiptPath: receiptPath || null,
      })
      notify(amountNum === remaining ? 'Faltante pagado' : 'Abono registrado', 'success')
      onPaid()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo registrar el pago', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={full ? 'Pagar faltante' : 'Abonar al faltante'} subtitle={`${shortage.person?.name} · ${shortage.registerName ?? 'Caja'}${shortage.sourceCutId ? ` · corte #${shortage.sourceCutId}` : ''}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm">
          <SummaryRow label="Faltante">{fmt(shortage.amount)}</SummaryRow>
          <SummaryRow label="Ya abonado"><span className="text-green-700">{fmt(shortage.paidAmount)}</span></SummaryRow>
          <div className="border-t border-gray-200 pt-1.5"><SummaryRow label="Resta" strong><span className="text-red-700">{fmt(remaining)}</span></SummaryRow></div>
        </div>

        <AmountField id="shortage-amount" label={full ? 'Monto a pagar ($)' : 'Monto del abono ($)'} value={amount} onChange={setAmount} error={errors.amount} readOnly={full} autoFocus={!full} />
        {!full && amountNum != null && amountNum > 0 && amountNum <= remaining && (
          <p className="text-xs text-gray-500 -mt-2">Después de este abono restarán {fmt(remaining - amountNum)}.</p>
        )}

        <div>
          <label htmlFor="shortage-method" className="text-xs font-medium text-gray-600 block mb-1">¿Cómo paga?</label>
          <select id="shortage-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(SHORTAGE_METHOD_LABELS).map(([k, v]) => (
              <option key={k} value={k} disabled={k === 'CASH_REGISTER' && noOpenCuts}>{v}{k === 'CASH_REGISTER' && noOpenCuts ? ' (no hay cajas abiertas)' : ''}</option>
            ))}
          </select>
        </div>

        {method === 'CASH_REGISTER' && (
          <div>
            <label htmlFor="shortage-cut" className="text-xs font-medium text-gray-600 block mb-1">Caja a la que entra el dinero</label>
            <select id="shortage-cut" className="input" value={cutId ?? ''} onChange={(e) => setCutId(Number(e.target.value))}>
              {(openCuts ?? []).map((c) => <option key={c.id} value={c.id}>{c.registerName} · corte #{c.id} de {c.userName}</option>)}
            </select>
            {errors.cut && <p className="text-red-600 text-xs mt-1">{errors.cut}</p>}
            <p className="text-xs text-gray-500 mt-1">Se registra como entrada en ese corte y sube su efectivo esperado.</p>
          </div>
        )}

        {method !== 'CASH_REGISTER' && (
          <>
            <div>
              <label htmlFor="shortage-reference" className="text-xs font-medium text-gray-600 block mb-1">Referencia (opcional)</label>
              <input id="shortage-reference" className="input" value={reference} onChange={(e) => setReference(e.target.value)}
                placeholder={method === 'PAYROLL' ? 'Ej. Nómina 2ª quincena de octubre' : 'Folio, clave de rastreo, etc.'} />
              {errors.reference && <p className="text-red-600 text-xs mt-1">{errors.reference}</p>}
            </div>
            <ReceiptInput value={receiptPath} onChange={setReceiptPath} />
          </>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={loading || openCuts == null}>{loading ? '...' : 'Registrar pago'}</button>
        </div>
      </form>
    </Modal>
  )
}

/** Historial de pagos/abonos de un faltante. */
function ShortagePaymentsModal({ shortage, onClose }) {
  const [payments, setPayments] = useState(null)
  useEffect(() => {
    getShortagePayments(shortage.id).then((r) => setPayments(r.data.data ?? [])).catch(() => setPayments([]))
  }, [shortage.id])

  return (
    <Modal title="Pagos del faltante" subtitle={`${shortage.person?.name} · faltante de ${fmt(shortage.amount)}`} onClose={onClose}>
      {payments == null ? <p className="text-sm text-gray-400">Cargando…</p> : (
        <ul className="divide-y divide-gray-100 text-sm">
          {payments.map((p) => (
            <li key={p.id} className="py-2 flex justify-between gap-3">
              <span>
                <span className="block font-medium">{SHORTAGE_METHOD_LABELS[p.method]}{p.cashCutId ? ` · corte #${p.cashCutId}` : ''}</span>
                <span className="block text-xs text-gray-500">{fmtDate(p.createdAt)} · registró {p.registeredBy?.name ?? '—'}{p.reference ? ` · ref. ${p.reference}` : ''}</span>
                {p.receiptPath && <a className="text-xs text-purple-700 hover:underline" href={resolveMediaUrl(p.receiptPath)} target="_blank" rel="noopener noreferrer">Ver comprobante</a>}
              </span>
              <span className="font-semibold text-green-700">{fmt(p.amount)}</span>
            </li>
          ))}
          {payments.length === 0 && <li className="py-2 text-gray-400">Sin pagos</li>}
        </ul>
      )}
    </Modal>
  )
}
