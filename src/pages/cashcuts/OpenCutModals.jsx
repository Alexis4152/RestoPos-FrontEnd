import { useState } from 'react'
import { openCashCut } from '../../api/cashCuts'
import { useNotify } from '../../context/NotifyContext'
import {
  AmountField, CountBadge, LargeDifferenceConfirm, Modal, PendingBreakdown, fmt, fmtTime, isLargeDifference, isUnreasonableCount, toAmount, MAX_AMOUNT,
} from './common'

/**
 * Paso 1 de abrir corte: elegir la caja. Cualquier caja activa y libre de la tienda; las
 * que están en uso salen deshabilitadas con quién las tiene. Cada caja libre muestra cuánto
 * se recibe y por qué (desglose de la entrega pendiente).
 */
export function ChooseRegisterModal({ registers, isAdmin = false, onClose, onContinue }) {
  const { confirmDialog } = useNotify()
  const active = registers.filter((r) => r.isActive)
  const firstFree = active.find((r) => !r.openCut && !r.dayClosed)
  const [selectedId, setSelectedId] = useState(firstFree?.id ?? null)
  const selected = active.find((r) => r.id === selectedId)

  return (
    <Modal title="Abrir corte de caja" subtitle="Elige la caja en la que vas a cobrar." onClose={onClose} wide>
      <fieldset className="space-y-2">
        <legend className="sr-only">Caja</legend>
        {active.length === 0 && <p className="text-sm text-gray-500">No hay cajas activas. Pide a un administrador que dé de alta una.</p>}
        {active.map((r) => {
          // En uso, o ya hizo su corte de fin de día (se reabre con el cierre programado o mañana).
          // Tras su fin de día, solo admin/supervisor la puede volver a abrir hoy.
          const busy = !!r.openCut || (r.dayClosed && !isAdmin)
          const checked = r.id === selectedId
          const p = r.pending
          return (
            <label
              key={r.id}
              className={`flex gap-3 items-start p-3 rounded-xl border ${busy ? 'border-dashed border-gray-300 bg-gray-50 cursor-not-allowed'
                : checked ? 'border-2 border-purple-600 bg-purple-50 cursor-pointer' : 'border-gray-200 cursor-pointer hover:bg-gray-50'}`}
            >
              <input type="radio" name="caja" className="mt-1 w-4 h-4" disabled={busy} checked={checked} onChange={() => setSelectedId(r.id)} />
              <span className="flex-1 min-w-0 space-y-1">
                <span className="flex justify-between gap-2">
                  <span className={`font-semibold ${busy ? 'text-gray-500' : 'text-gray-900'}`}>{r.name}</span>
                  {!busy && p?.amount != null && <span className="font-semibold">{fmt(p.amount)}</span>}
                </span>
                {r.dayClosed && !r.openCut ? (
                  <span className={`block text-sm ${isAdmin ? 'text-amber-800' : 'text-gray-500'}`}>
                    {isAdmin
                      ? 'Ya hizo su corte de fin de día. Como administrador puedes volver a abrirla.'
                      : 'Ya hizo su corte de fin de día. Solo un administrador o supervisor puede volver a abrirla hoy.'}
                  </span>
                ) : busy ? (
                  <span className="block text-sm text-gray-500">En uso por {r.openCut.userName} desde las {fmtTime(r.openCut.openedAt)}</span>
                ) : p?.amount != null ? (
                  <>
                    <PendingBreakdown pending={p} compact />
                    <CountBadge method={p.countMethod} name={p.countedByName} />
                  </>
                ) : (
                  <span className="block text-sm text-gray-500">Sin entrega previa: capturarás el fondo con el que empiezas.</span>
                )}
              </span>
            </label>
          )
        })}
      </fieldset>
      <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 mt-4">
        El fondo inicial no se escribe: es lo que dejó el turno anterior, más o menos lo que el administrador movió con la caja cerrada. En el siguiente paso lo cuentas y confirmas.
      </p>
      <div className="flex gap-2 justify-end pt-4">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button
          type="button" className="btn-primary"
          disabled={!selected || !!selected.openCut || (selected.dayClosed && !isAdmin)}
          onClick={async () => {
            if (selected.dayClosed && !(await confirmDialog(
              `${selected.name} ya hizo su corte de fin de día. ¿Volver a abrirla hoy?`, { confirmText: 'Sí, abrirla', danger: false },
            ))) return
            onContinue(selected)
          }}
        >Continuar</button>
      </div>
    </Modal>
  )
}

/**
 * Paso 2: recibir la caja. El cajero cuenta el efectivo; si no coincide con lo que debía
 * recibir, la nota es obligatoria y la diferencia queda registrada para el administrador.
 * El fondo inicial es siempre lo que contó (lo que de verdad hay en la caja).
 */
export function ReceiveModal({ register, onBack, onClose, onOpened }) {
  const { notify, confirmDialog } = useNotify()
  const pending = register.pending
  const expected = pending?.amount ?? null
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [confirmValue, setConfirmValue] = useState('')
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  const countedNum = toAmount(counted)
  // Caja entregada vacía ($0): lo que cuente es un fondo nuevo, no una diferencia — solo se
  // pide confirmar el monto (volver a escribirlo), sin aviso de diferencia ni nota obligatoria.
  const emptyHandover = expected != null && Number(expected) === 0
  const diff = expected != null && !emptyHandover && countedNum != null ? Math.round((countedNum - Number(expected)) * 100) / 100 : null
  const hasDiff = diff != null && diff !== 0
  // Contra errores de dedo (mismas reglas que el cierre): monto no razonable bloquea;
  // diferencia grande pide volver a escribir el monto.
  const unreasonable = !emptyHandover && expected != null && countedNum != null && isUnreasonableCount(Number(expected), countedNum)
  const large = emptyHandover
    ? countedNum != null && countedNum > 0
    : expected != null && countedNum != null && !unreasonable && isLargeDifference(Number(expected), countedNum)
  const confirmed = toAmount(confirmValue) === countedNum

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = {}
    if (countedNum == null) errs.counted = 'Captura cuánto efectivo contaste'
    if (countedNum != null && countedNum > MAX_AMOUNT) errs.counted = ' '
    if (unreasonable) errs.counted = ' '
    if (large && !confirmed) errs.confirm = 'Vuelve a escribir el monto para confirmarlo'
    if (hasDiff && !note.trim()) errs.note = 'La nota es obligatoria si lo que contaste no coincide'
    if (note.length > 200) errs.note = 'La nota no puede tener más de 200 caracteres'
    if (!agreed) errs.agreed = 'Confirma que contaste el efectivo y estás de acuerdo'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    if (!(await confirmDialog(`¿Recibir ${register.name} con ${fmt(countedNum)} y abrir tu corte?`, { confirmText: 'Abrir corte', danger: false }))) return
    setLoading(true)
    try {
      await openCashCut({ cashRegisterId: register.id, countedAmount: countedNum, note: note.trim() || null, agreed, largeDifferenceConfirmed: large && confirmed })
      notify('Corte de caja abierto correctamente', 'success')
      onOpened()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo abrir el corte', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={`Recibir ${register.name}`} subtitle="Cuenta el efectivo antes de empezar a cobrar." onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {expected != null ? (
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-600">Por qué recibes esta cantidad</p>
            <PendingBreakdown pending={pending} />
            <div className="flex justify-between border-t border-gray-200 pt-2 font-bold">
              <span>Te entregan</span><span>{fmt(expected)}</span>
            </div>
            <CountBadge method={pending.countMethod} name={pending.countedByName} />
          </div>
        ) : (
          <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">Esta caja no tiene entrega previa. Captura el efectivo con el que empiezas.</p>
        )}

        <AmountField
          id="receive-counted" label={expected != null ? '¿Cuánto cuentas tú? ($)' : 'Fondo inicial ($)'}
          value={counted} onChange={(v) => { setCounted(v); setConfirmValue('') }} error={errors.counted?.trim()} autoFocus
        />

        {unreasonable && (
          <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
            <strong>Este monto no es razonable</strong> para lo que te entregan ({fmt(expected)}). Revisa que no sobren dígitos.
          </p>
        )}
        {large && (
          <LargeDifferenceConfirm
            id="receive-confirm"
            message={emptyHandover
              ? `La caja se entrega vacía. Confirma el fondo con el que empiezas: ${fmt(countedNum)}.`
              : `La diferencia es muy grande (${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}). ¿Seguro que contaste ${fmt(countedNum)}?`}
            amount={countedNum} confirmValue={confirmValue} onChange={setConfirmValue} error={errors.confirm}
          />
        )}

        {hasDiff && !unreasonable && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 space-y-1">
            <div className="flex justify-between font-semibold">
              <span>No coincide con la entrega</span>
              <span className="text-red-700">{diff > 0 ? '+' : '−'}{fmt(Math.abs(diff))}</span>
            </div>
            <p>Tu fondo inicial será lo que contaste ({fmt(countedNum)}). La diferencia queda registrada en esta entrega y se le avisa al administrador para que la resuelva.</p>
          </div>
        )}

        <div>
          <label htmlFor="receive-note" className="text-xs font-medium text-gray-600 block mb-1">
            Nota {hasDiff ? <span className="text-red-500">*</span> : '(opcional)'}
          </label>
          <textarea id="receive-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          {errors.note && <p className="text-red-600 text-xs mt-1">{errors.note}</p>}
        </div>

        <label className="flex gap-3 items-start p-3 border border-gray-200 rounded-lg cursor-pointer">
          <input type="checkbox" className="mt-0.5 w-4 h-4" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span className="text-sm">Conté el efectivo y recibo la caja con <strong>{countedNum != null ? fmt(countedNum) : '—'}</strong>. Estoy de acuerdo.</span>
        </label>
        {errors.agreed && <p className="text-red-600 text-xs -mt-2">{errors.agreed}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" className="btn-secondary" onClick={onBack}>Atrás</button>
          <button type="submit" className="btn-primary disabled:opacity-50" disabled={loading || unreasonable}>{loading ? '...' : 'Recibir caja y abrir corte'}</button>
        </div>
      </form>
    </Modal>
  )
}
