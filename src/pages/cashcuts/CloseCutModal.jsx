import { useState } from 'react'
import { closeCashCut, endOfDayCashCut } from '../../api/cashCuts'
import { useNotify } from '../../context/NotifyContext'
import {
  AmountField, LargeDifferenceConfirm, Modal, SummaryRow, fmt, isLargeDifference, isUnreasonableCount, toAmount, MAX_AMOUNT,
} from './common'

/**
 * Traspaso de caja (o, con `endOfDay`, Corte de fin de día) con arqueo: el cajero cuenta
 * el efectivo y se compara contra el esperado
 * (fondo + ventas en efectivo + entradas − gastos − retiros − reembolsos). Lo contado queda
 * en la caja para quien la abra después.
 *
 * Contra errores de dedo: un monto no razonable (sobran dígitos) no deja cerrar, y una
 * diferencia grande pide volver a escribir el monto. Con conteo ciego (`blind`) el cajero no
 * ve el esperado: captura lo que contó, cierra, y solo entonces ve la diferencia — la
 * confirmación reforzada la pide el backend (`data.largeDifference`), sin revelar cifras.
 */
export default function CloseCutModal({ cut, summary, blind = false, endOfDay = false, onClose, onClosed }) {
  // Traspaso: el efectivo pasa al siguiente turno. Fin de día: además se manda el reporte
  // del día de esa caja y la caja queda cerrada hasta el día siguiente.
  const actionLabel = endOfDay ? 'Corte de fin de día' : 'Traspaso de caja'
  const registerName = cut.cashRegister?.name ?? 'la caja'
  const { notify, confirmDialog } = useNotify()
  const [counted, setCounted] = useState('')
  const [confirmValue, setConfirmValue] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  // Conteo ciego: el backend pidió la confirmación reforzada (con su mensaje).
  const [serverConfirm, setServerConfirm] = useState(null)
  // Conteo ciego: el corte ya cerrado, para mostrar la diferencia antes de salir.
  const [result, setResult] = useState(null)

  const expected = blind ? null : Number(summary?.expectedCash ?? 0)
  const countedNum = toAmount(counted)
  const diff = !blind && countedNum != null ? Math.round((countedNum - expected) * 100) / 100 : null
  const unreasonable = !blind && countedNum != null && isUnreasonableCount(expected, countedNum)
  const large = blind ? !!serverConfirm : (!unreasonable && countedNum != null && isLargeDifference(expected, countedNum))
  const confirmed = toAmount(confirmValue) === countedNum

  function changeCounted(v) {
    setCounted(v)
    setConfirmValue('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = {}
    if (countedNum == null) errs.counted = 'Captura cuánto efectivo contaste'
    if (countedNum != null && countedNum > MAX_AMOUNT) errs.counted = ''
    if (unreasonable) errs.counted = ''
    if (large && !confirmed) errs.confirm = 'Vuelve a escribir el monto para confirmarlo'
    if (!blind && diff != null && diff !== 0 && !notes.trim()) errs.notes = 'La nota es obligatoria si no cuadra'
    if (notes.length > 200) errs.notes = 'Las notas no pueden tener más de 200 caracteres'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    const base = blind
      ? ` con ${fmt(countedNum)} contados? Después verás la diferencia.`
      : `? Quedarán ${fmt(countedNum)} en ${registerName}${endOfDay ? ' para el día siguiente' : ' para el siguiente turno'}.`
    const msg = endOfDay
      ? `¿Hacer el corte de fin de día${base} Se enviará el reporte del día de ${registerName} y la caja no se podrá volver a abrir hasta mañana.`
      : `¿Hacer el traspaso de caja${base}`
    if (!(await confirmDialog(msg, { confirmText: actionLabel }))) return
    // Fin de día: segunda confirmación, porque bloquea la caja hasta mañana y manda el reporte.
    if (endOfDay && !(await confirmDialog(
      `Confirma de nuevo: ${registerName} quedará CERRADA hasta mañana y se enviará el reporte del día. Esta acción no se puede deshacer.`,
      { confirmText: 'Sí, cerrar el día' },
    ))) return
    setLoading(true)
    try {
      const payload = { countedAmount: countedNum, notes: notes.trim() || null, largeDifferenceConfirmed: large && confirmed }
      const r = endOfDay ? await endOfDayCashCut(cut.id, payload) : await closeCashCut(cut.id, payload)
      notify(endOfDay ? 'Corte de fin de día realizado; se envió el reporte del día' : 'Traspaso de caja realizado', 'success')
      if (blind) setResult(r.data.data)
      else onClosed()
    } catch (err) {
      if (err.response?.data?.data?.largeDifference) {
        setServerConfirm(err.response.data.message)
        setConfirmValue('')
      } else {
        notify(err.response?.data?.message ?? 'No se pudo cerrar el corte', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  // Conteo ciego, ya cerrado: ahora sí se muestra cómo quedó.
  if (result) {
    const d = Number(result.cashDifference ?? 0)
    return (
      <Modal title={endOfDay ? 'Corte de fin de día realizado' : 'Traspaso realizado'} subtitle={`Corte #${result.id}${result.cashRegister ? ` · ${result.cashRegister.name}` : ''}`} onClose={onClosed}>
        <div className="space-y-3 text-sm">
          <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
            <SummaryRow label="Contaste">{fmt(result.countedAmount)}</SummaryRow>
            <SummaryRow label="Efectivo esperado">{fmt(result.closingAmount)}</SummaryRow>
          </div>
          {d === 0 ? (
            <div className="flex justify-between bg-green-50 text-green-800 rounded-lg p-3 font-semibold"><span>✓ Cuadra</span><span>{fmt(0)}</span></div>
          ) : (
            <div className={`flex justify-between rounded-lg p-3 font-semibold ${d < 0 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
              <span>{d < 0 ? 'Faltante' : 'Sobrante'}</span><span>{d < 0 ? '−' : '+'}{fmt(Math.abs(d))}</span>
            </div>
          )}
          {d !== 0 && <p className="text-gray-600">La diferencia queda registrada en tu corte para que el administrador la revise.</p>}
          <div className="flex justify-end pt-1"><button type="button" className="btn-primary" onClick={onClosed}>Entendido</button></div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`${actionLabel}${cut.cashRegister ? ` · ${cut.cashRegister.name}` : ''}`} subtitle={`Corte #${cut.id}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {blind ? (
          <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
            <strong>Conteo ciego:</strong> cuenta todo el efectivo de la caja y captura el total. Verás si cuadra después de cerrar.
          </p>
        ) : (
          <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm">
            <SummaryRow label={cut.previousUserName ? `Fondo recibido de ${cut.previousUserName}` : 'Fondo inicial'}>{fmt(summary?.openingAmount)}</SummaryRow>
            <SummaryRow label="Ventas en efectivo">{fmt(summary?.cashSales)}</SummaryRow>
            <SummaryRow label="Entradas"><span className="text-green-700">+{fmt(summary?.entriesTotal)}</span></SummaryRow>
            <SummaryRow label="Gastos"><span className="text-red-700">−{fmt(summary?.expensesTotal)}</span></SummaryRow>
            <SummaryRow label="Retiros"><span className="text-red-700">−{fmt(summary?.withdrawalsTotal)}</span></SummaryRow>
            {Number(summary?.reimbursementsTotal) > 0 && (
              <SummaryRow label="Reembolsos pagados"><span className="text-red-700">−{fmt(summary?.reimbursementsTotal)}</span></SummaryRow>
            )}
            {Number(summary?.loansOutTotal) > 0 && (
              <SummaryRow label="Préstamos a otras cajas (no es gasto)"><span className="text-red-700">−{fmt(summary?.loansOutTotal)}</span></SummaryRow>
            )}
            <div className="border-t border-gray-200 pt-1.5"><SummaryRow label="Efectivo esperado" strong>{fmt(expected)}</SummaryRow></div>
            <p className="text-xs text-gray-500 pt-1">
              Ventas tarjeta/transferencia: {fmt(Number(summary?.cardSales ?? 0) + Number(summary?.transferSales ?? 0))} (no son efectivo).
              {summary?.cancelledCount > 0 && ` · ${summary.cancelledCount} venta(s) cancelada(s) por ${fmt(summary.cancelledTotal)}.`}
            </p>
          </div>
        )}

        <div>
          <AmountField id="close-counted" label="Efectivo contado ($)" value={counted} onChange={changeCounted} error={errors.counted} autoFocus />
          <p className="text-xs text-gray-500 mt-1">Cuenta billetes y monedas antes de cerrar.</p>
        </div>

        {unreasonable && (
          <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
            <strong>Este monto no es razonable</strong> para esta caja (esperado {fmt(expected)}). Revisa que no sobren dígitos.
          </p>
        )}

        {large && (
          <LargeDifferenceConfirm
            id="close-confirm"
            message={blind ? serverConfirm : `La diferencia es muy grande (${diff < 0 ? '−' : '+'}${fmt(Math.abs(diff))}). ¿Seguro que contaste ${fmt(countedNum)}?`}
            amount={countedNum} confirmValue={confirmValue} onChange={setConfirmValue} error={errors.confirm}
          />
        )}

        {!blind && diff != null && !unreasonable && !large && (
          diff === 0 ? (
            <div className="flex justify-between items-center bg-green-50 text-green-800 rounded-lg p-3 font-semibold text-sm">
              <span>✓ Cuadra</span><span>Diferencia {fmt(0)}</span>
            </div>
          ) : (
            <div className={`flex justify-between items-center rounded-lg p-3 font-semibold text-sm ${diff < 0 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
              <span>{diff < 0 ? 'Faltante' : 'Sobrante'}</span><span>{diff < 0 ? '−' : '+'}{fmt(Math.abs(diff))}</span>
            </div>
          )
        )}

        <div>
          <label htmlFor="close-notes" className="text-xs font-medium text-gray-600 block mb-1">
            Notas {!blind && diff != null && diff !== 0 ? <span className="text-red-500">*</span> : '(opcional)'}
          </label>
          <textarea id="close-notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {errors.notes && <p className="text-red-600 text-xs mt-1">{errors.notes}</p>}
        </div>

        {cut.cashRegister && countedNum != null && !unreasonable && (
          <div className="border-2 border-purple-600 bg-purple-50 rounded-xl p-3 text-sm text-purple-900">
            <div className="flex justify-between font-bold"><span>{endOfDay ? 'Queda en la caja para mañana' : 'Queda en la caja para el siguiente turno'}</span><span>{fmt(countedNum)}</span></div>
            <p className="mt-1">Lo recibe quien abra {cut.cashRegister.name} después de ti; tendrá que contarlo y dar su de acuerdo.</p>
          </div>
        )}

        {endOfDay && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-900 space-y-1">
            <p className="font-semibold">Este es el último corte del día de {registerName}.</p>
            <p>Se enviará un correo con el Excel de los cortes de hoy de esta caja (traspasos y este corte) a los destinatarios configurados, y {registerName} no se podrá volver a abrir hasta mañana. Las demás cajas siguen operando.</p>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-danger disabled:opacity-50 disabled:cursor-not-allowed" disabled={loading || unreasonable}>{loading ? '...' : actionLabel}</button>
        </div>
      </form>
    </Modal>
  )
}
