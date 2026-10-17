import { useState } from 'react'
import { forceCloseCashCut } from '../../api/cashCuts'
import { addClosedRegisterMovement, createCashRegister, resolveHandover, updateCashRegister } from '../../api/cashRegisters'
import { useAuth } from '../../context/AuthContext'
import { useNotify } from '../../context/NotifyContext'
import {
  AmountField, CountBadge, DestinationSelect, Modal, PersonSelect, ReceiptInput, SummaryRow, fmt, fmtDate, toAmount, MAX_AMOUNT,
} from './common'

/** Alta o edición (nombre, activa) de una caja. */
export function RegisterFormModal({ register, onClose, onSaved }) {
  const { notify, confirmDialog } = useNotify()
  const [name, setName] = useState(register?.name ?? '')
  const [isActive, setIsActive] = useState(register?.isActive ?? true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Escribe el nombre de la caja'); return }
    if (name.length > 60) { setError('El nombre no puede tener más de 60 caracteres'); return }
    const msg = register
      ? (register.isActive && !isActive ? `¿Guardar los cambios y desactivar «${register.name}»? Los cajeros ya no podrán abrirla.` : `¿Guardar los cambios de «${register.name}»?`)
      : `¿Crear la caja «${name.trim()}»?`
    if (!(await confirmDialog(msg, { confirmText: register ? 'Guardar' : 'Crear caja', danger: false }))) return
    setLoading(true)
    try {
      if (register) await updateCashRegister(register.id, { name: name.trim(), isActive })
      else await createCashRegister({ name: name.trim() })
      notify(register ? 'Caja actualizada' : 'Caja creada', 'success')
      onSaved()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo guardar la caja', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={register ? 'Editar caja' : 'Nueva caja'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="register-name" className="text-xs font-medium text-gray-600 block mb-1">Nombre</label>
          <input id="register-name" className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Ej. Caja 2 · Terraza" />
          {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
        </div>
        {register && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Caja activa (los cajeros pueden abrirla)
          </label>
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? '...' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Retirar o agregar efectivo con la caja cerrada (entre turnos). Ajusta lo que recibirá
 * quien la abra; si el admin cuenta lo que queda, la entrega pasa a ser su conteo.
 */
export function ClosedMovementModal({ register, initialType, people, onClose, onSaved }) {
  const { user } = useAuth()
  const { notify, confirmDialog } = useNotify()
  const current = Number(register.pending?.amount ?? 0)
  const [type, setType] = useState(initialType ?? 'WITHDRAWAL')
  const [amount, setAmount] = useState('')
  const [personId, setPersonId] = useState(user?.id ?? null)
  const [destination, setDestination] = useState(null)
  const [reference, setReference] = useState('')
  const [concept, setConcept] = useState('')
  const [didCount, setDidCount] = useState(false)
  const [remaining, setRemaining] = useState('')
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  const amountNum = toAmount(amount)
  const isWithdrawal = type === 'WITHDRAWAL'
  const expectedRemaining = amountNum != null ? (isWithdrawal ? current - amountNum : current + amountNum) : current
  const exceeds = isWithdrawal && amountNum != null && amountNum > current
  const remainingNum = toAmount(remaining)
  const finalAmount = didCount && remainingNum != null ? remainingNum : expectedRemaining

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = {}
    if (amountNum == null || amountNum <= 0) errs.amount = 'Captura un monto mayor a cero'
    if (amountNum != null && amountNum > MAX_AMOUNT) errs.amount = ''
    if (isWithdrawal && !destination) errs.destination = 'Indica el destino del dinero'
    if (didCount && remainingNum == null) errs.remaining = 'Captura cuánto queda'
    setErrors(errs)
    if (Object.keys(errs).length > 0 || exceeds) return
    const msg = isWithdrawal
      ? `¿Retirar ${fmt(amountNum)} de ${register.name}? Quien abra la caja recibirá ${fmt(finalAmount)}.`
      : `¿Agregar ${fmt(amountNum)} a ${register.name}? Quien abra la caja recibirá ${fmt(finalAmount)}.`
    if (!(await confirmDialog(msg, { confirmText: isWithdrawal ? 'Registrar retiro' : 'Agregar efectivo', danger: isWithdrawal }))) return
    setLoading(true)
    try {
      await addClosedRegisterMovement(register.id, {
        type, amount: amountNum,
        personId: isWithdrawal ? personId : null,
        destination: isWithdrawal ? destination : null,
        reference: reference.trim() || null,
        concept: concept.trim() || null,
        countedRemaining: didCount ? remainingNum : null,
      })
      notify(isWithdrawal ? 'Retiro registrado' : 'Entrada registrada', 'success')
      onSaved()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo registrar el movimiento', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={`${register.name} (cerrada)`} subtitle="Movimiento entre turnos. Lo verá el siguiente cajero al recibir." onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div role="tablist" aria-label="Tipo de movimiento" className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-xl">
          {[{ key: 'WITHDRAWAL', label: 'Retirar' }, { key: 'FLOAT', label: 'Agregar efectivo' }].map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={type === t.key}
              className={`min-h-[40px] rounded-lg text-sm font-semibold ${type === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
              onClick={() => setType(t.key)}>{t.label}</button>
          ))}
        </div>

        <div className="flex justify-between items-center bg-gray-50 rounded-lg p-3">
          <span className="text-sm text-gray-600">
            En caja ahora
            {register.pending?.lastUserName && <span className="block text-xs">Dejó {register.pending.lastUserName}</span>}
          </span>
          <span className="font-bold">{fmt(current)}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <AmountField id="closed-amount" label={isWithdrawal ? 'Monto a retirar ($)' : 'Monto a agregar ($)'} value={amount} onChange={setAmount} error={errors.amount} />
          {isWithdrawal ? (
            <div>
              <DestinationSelect id="closed-destination" value={destination} onChange={setDestination} />
              {errors.destination && <p className="text-red-600 text-xs mt-1">{errors.destination}</p>}
            </div>
          ) : (
            <div>
              <label htmlFor="closed-concept" className="text-xs font-medium text-gray-600 block mb-1">Motivo (opcional)</label>
              <input id="closed-concept" className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej. Cambio para el día" />
            </div>
          )}
        </div>
        {isWithdrawal && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PersonSelect id="closed-person" label="¿Quién retira?" people={people} value={personId} onChange={setPersonId} />
            <div>
              <label htmlFor="closed-reference" className="text-xs font-medium text-gray-600 block mb-1">Referencia (opcional)</label>
              <input id="closed-reference" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Folio, sobre..." />
            </div>
          </div>
        )}
        {exceeds && <p className="text-sm text-red-700">Solo hay {fmt(current)} en la caja.</p>}

        <div className="border border-gray-200 rounded-xl p-3 space-y-3">
          <label className="flex gap-3 items-start cursor-pointer">
            <input type="checkbox" className="mt-0.5 w-4 h-4" checked={didCount} onChange={(e) => setDidCount(e.target.checked)} />
            <span>
              <span className="block text-sm font-semibold">Conté lo que queda en la caja</span>
              <span className="block text-xs text-gray-500">Recomendado: el siguiente cajero recibirá sobre tu conteo.</span>
            </span>
          </label>
          {didCount && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <AmountField id="closed-remaining" label="Quedan ($)" value={remaining} onChange={setRemaining} error={errors.remaining} />
              {remainingNum != null && (
                Math.round((remainingNum - expectedRemaining) * 100) === 0
                  ? <p className="text-sm font-semibold text-green-700 pb-2">✓ Coincide con lo esperado</p>
                  : <p className="text-sm font-semibold text-amber-800 pb-2">Esperado {fmt(expectedRemaining)}</p>
              )}
            </div>
          )}
        </div>

        {amountNum != null && !exceeds && (
          <p className="text-sm text-blue-900 bg-blue-50 rounded-lg p-3">
            La entrega pendiente de {register.name} queda en <strong>{fmt(finalAmount)}</strong>{didCount ? ' y queda como contada por ti' : ''}. Quien abra la caja verá este movimiento en el desglose.
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className={isWithdrawal ? 'btn-danger disabled:opacity-50' : 'bg-green-700 hover:bg-green-800 text-white font-medium px-4 py-2 rounded-lg disabled:opacity-50'} disabled={loading || exceeds}>
            {loading ? '...' : isWithdrawal ? 'Registrar retiro' : 'Agregar efectivo'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Forzar el cierre del corte de otro (p. ej. se fue sin cerrar), indicando cómo se contó
 * el efectivo: en persona, a distancia (reportado por el cajero) o sin contar.
 */
export function ForceCloseModal({ register, people, onClose, onSaved }) {
  const { notify, confirmDialog } = useNotify()
  const cut = register.openCut
  const [method, setMethod] = useState('ADMIN_IN_PERSON')
  const [counted, setCounted] = useState('')
  const [reportedById, setReportedById] = useState(cut.userId)
  const [evidencePath, setEvidencePath] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const countedNum = toAmount(counted)
  const reporterName = people.find((p) => p.id === reportedById)?.name ?? cut.userName

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = {}
    if (method !== 'NOT_COUNTED' && countedNum == null) errs.counted = 'Captura el monto contado'
    if (countedNum != null && countedNum > MAX_AMOUNT) errs.counted = ''
    if (method === 'REMOTE_REPORTED' && !reportedById) errs.reported = 'Indica quién reportó'
    if (!reason.trim()) errs.reason = 'Escribe el motivo del cierre forzado'
    if (reason.length > 200) errs.reason = 'El motivo no puede tener más de 200 caracteres'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    if (!(await confirmDialog(`¿Forzar el cierre del corte #${cut.id} de ${cut.userName}?`, { confirmText: 'Forzar cierre' }))) return
    setLoading(true)
    try {
      await forceCloseCashCut(cut.id, {
        countMethod: method,
        countedAmount: method === 'NOT_COUNTED' ? null : countedNum,
        reportedById: method === 'REMOTE_REPORTED' ? reportedById : null,
        evidencePath: method === 'REMOTE_REPORTED' ? (evidencePath || null) : null,
        reason: reason.trim(),
      })
      notify('Corte cerrado', 'success')
      onSaved()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo cerrar el corte', 'error')
    } finally {
      setLoading(false)
    }
  }

  const resultLabel = method === 'ADMIN_IN_PERSON' ? 'Contado por ti (en persona)'
    : method === 'REMOTE_REPORTED' ? `Reportado por ${reporterName} a distancia` : 'No contado'

  return (
    <Modal title={`Forzar cierre · ${register.name}`} subtitle={`Corte #${cut.id} de ${cut.userName} · efectivo esperado ${fmt(cut.expectedCash)}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-gray-600 mb-1">¿Cómo se contó el efectivo?</legend>
          {[
            { value: 'ADMIN_IN_PERSON', title: 'Contado en persona', desc: 'Lo conté yo frente a la caja.' },
            { value: 'REMOTE_REPORTED', title: 'Contado a distancia', desc: 'El cajero contó y me reportó la cantidad (llamada, mensaje o foto).' },
            { value: 'NOT_COUNTED', title: 'No se contó', desc: 'Se entrega el efectivo esperado; el siguiente cajero lo verifica al recibir.' },
          ].map((o) => (
            <label key={o.value} className={`flex gap-3 items-start p-3 rounded-xl cursor-pointer ${method === o.value ? 'border-2 border-purple-600 bg-purple-50' : 'border border-gray-200'}`}>
              <input type="radio" name="count-method" className="mt-1 w-4 h-4" checked={method === o.value} onChange={() => setMethod(o.value)} />
              <span><span className="block font-semibold text-sm">{o.title}</span><span className="block text-sm text-gray-500">{o.desc}</span></span>
            </label>
          ))}
        </fieldset>

        {method !== 'NOT_COUNTED' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AmountField id="force-counted" label={method === 'REMOTE_REPORTED' ? 'Monto reportado ($)' : 'Monto contado ($)'} value={counted} onChange={setCounted} error={errors.counted} />
            {method === 'REMOTE_REPORTED' && (
              <div>
                <PersonSelect id="force-reporter" label="¿Quién lo reportó?" people={people} value={reportedById} onChange={setReportedById} />
                {errors.reported && <p className="text-red-600 text-xs mt-1">{errors.reported}</p>}
              </div>
            )}
          </div>
        )}
        {method === 'REMOTE_REPORTED' && (
          <ReceiptInput value={evidencePath} onChange={setEvidencePath} label="Evidencia (opcional): foto del efectivo o captura del mensaje" />
        )}

        <div>
          <label htmlFor="force-reason" className="text-xs font-medium text-gray-600 block mb-1">Motivo del cierre forzado <span className="text-red-500">*</span></label>
          <input id="force-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. Salió antes y no cerró su corte" />
          {errors.reason && <p className="text-red-600 text-xs mt-1">{errors.reason}</p>}
        </div>

        <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
          La entrega quedará como <strong>«{resultLabel}»</strong>. Si el siguiente cajero cuenta otra cantidad, la diferencia se asocia a este conteo.
        </p>

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-danger" disabled={loading}>{loading ? '...' : 'Forzar cierre'}</button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Resolver la diferencia de una entrega: fue un retiro no registrado (se registra con su
 * fecha real), un faltante confirmado o un error de conteo. La diferencia nunca se borra.
 */
export function ResolveHandoverModal({ handover, people, onClose, onSaved }) {
  const { user } = useAuth()
  const { notify, confirmDialog } = useNotify()
  const diff = Number(handover.difference ?? 0)
  const [resolution, setResolution] = useState(diff < 0 ? 'UNREGISTERED_WITHDRAWAL' : 'COUNT_ERROR')
  const [amount, setAmount] = useState(diff < 0 ? String(Math.abs(diff)) : '')
  const [occurredAt, setOccurredAt] = useState('')
  const [personId, setPersonId] = useState(user?.id ?? null)
  const [destination, setDestination] = useState(null)
  // Responsable del faltante: por default quien entregó, salvo que el último conteo lo haya
  // hecho un admin (entonces no es seguro que la diferencia sea suya y se elige a mano).
  const [responsibleId, setResponsibleId] = useState(handover.receivedCountMethod === 'ADMIN_IN_PERSON' ? null : (handover.fromUserId ?? null))
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const isShortage = resolution === 'SHORTAGE' && diff < 0
  const responsibleName = people.find((p) => p.id === responsibleId)?.name

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = {}
    const amountNum = toAmount(amount)
    if (isShortage && !responsibleId) errs.responsible = 'Indica quién es responsable del faltante'
    if (resolution === 'UNREGISTERED_WITHDRAWAL') {
      if (amountNum == null || amountNum <= 0) errs.amount = 'Captura el monto retirado'
      if (!destination) errs.destination = 'Indica el destino del dinero'
    }
    if (!note.trim()) errs.note = 'La nota es obligatoria'
    if (note.length > 200) errs.note = 'La nota no puede tener más de 200 caracteres'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    const label = resolution === 'UNREGISTERED_WITHDRAWAL' ? 'retiro no registrado'
      : resolution === 'COUNT_ERROR' ? 'error de conteo' : (diff < 0 ? 'faltante confirmado' : 'sobrante confirmado')
    const msg = isShortage
      ? `¿Resolver como faltante confirmado? Se generará un faltante de ${fmt(Math.abs(diff))} a cargo de ${responsibleName ?? 'la persona elegida'}.`
      : `¿Resolver la diferencia como «${label}»? Quedará registrada y no se puede deshacer.`
    if (!(await confirmDialog(msg, { confirmText: 'Resolver', danger: false }))) return
    setLoading(true)
    try {
      await resolveHandover(handover.cutId, {
        resolution, note: note.trim(),
        ...(isShortage && { responsibleId }),
        ...(resolution === 'UNREGISTERED_WITHDRAWAL' && {
          amount: amountNum, personId, destination,
          occurredAt: occurredAt ? `${occurredAt}:00` : null,
        }),
      })
      notify('Diferencia resuelta', 'success')
      onSaved()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo resolver la diferencia', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="Resolver diferencia de entrega"
      subtitle={`${handover.registerName ?? 'Caja'} · de ${handover.fromUserName ?? '—'} (${fmtDate(handover.fromClosedAt)}) a ${handover.toUserName} (${fmtDate(handover.toOpenedAt)})`}
      onClose={onClose} wide
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm">
          <SummaryRow label="Debía recibir">{fmt(handover.expected)}</SummaryRow>
          <SummaryRow label={`Contó ${handover.toUserName}`}>{fmt(handover.received)}</SummaryRow>
          <div className="border-t border-gray-200 pt-1.5">
            <SummaryRow label="Diferencia" strong><span className={diff < 0 ? 'text-red-700' : 'text-amber-800'}>{diff < 0 ? '−' : '+'}{fmt(Math.abs(diff))}</span></SummaryRow>
          </div>
          {/* Quien contó por última vez puede no ser quien entregó (un admin pudo contar al
              retirar con la caja cerrada); solo se nombra cuando es seguro que fue él. */}
          <CountBadge method={handover.receivedCountMethod} name={handover.receivedCountMethod === 'ADMIN_IN_PERSON' ? null : handover.fromUserName} />
          {handover.receiveNote && <p className="text-gray-600">Nota de {handover.toUserName}: «{handover.receiveNote}»</p>}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-gray-600 mb-1">¿Qué pasó?</legend>
          {[
            ...(diff < 0 ? [{ value: 'UNREGISTERED_WITHDRAWAL', title: 'Fue un retiro que no se registró', desc: 'Se registra el retiro con su fecha real, marcado como «registrado después».' }] : []),
            { value: 'SHORTAGE', title: diff < 0 ? 'Faltante confirmado' : 'Sobrante confirmado', desc: diff < 0 ? 'El dinero no apareció: se genera un faltante a cargo de una persona, que podrá pagarlo o abonarlo.' : 'La diferencia queda registrada en esta entrega.' },
            { value: 'COUNT_ERROR', title: 'Error de conteo', desc: 'Se volvió a contar y el dinero sí coincide; si el corte sigue abierto, su fondo se corrige.' },
          ].map((o) => (
            <label key={o.value} className={`flex gap-3 items-start p-3 rounded-xl cursor-pointer ${resolution === o.value ? 'border-2 border-purple-600 bg-purple-50' : 'border border-gray-200'}`}>
              <input type="radio" name="resolution" className="mt-1 w-4 h-4" checked={resolution === o.value} onChange={() => setResolution(o.value)} />
              <span><span className="block font-semibold text-sm">{o.title}</span><span className="block text-sm text-gray-500">{o.desc}</span></span>
            </label>
          ))}
        </fieldset>

        {isShortage && (
          <div className="space-y-2">
            <PersonSelect id="resolve-responsible" label="¿Quién es responsable del faltante?" people={people} value={responsibleId} onChange={setResponsibleId} />
            {errors.responsible && <p className="text-red-600 text-xs">{errors.responsible}</p>}
            <p className="text-sm text-red-900 bg-red-50 rounded-lg p-3">
              Se generará un faltante de <strong>{fmt(Math.abs(diff))}</strong>{responsibleName ? <> a cargo de <strong>{responsibleName}</strong></> : ''}. Se cobra desde la pestaña <strong>Faltantes</strong> (pago completo o abonos).
            </p>
          </div>
        )}

        {resolution === 'UNREGISTERED_WITHDRAWAL' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AmountField id="resolve-amount" label="Monto retirado ($)" value={amount} onChange={setAmount} error={errors.amount} />
            <div>
              <label htmlFor="resolve-when" className="text-xs font-medium text-gray-600 block mb-1">¿Cuándo se retiró?</label>
              <input id="resolve-when" type="datetime-local" className="input" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
            </div>
            <PersonSelect id="resolve-person" label="¿Quién retiró?" people={people} value={personId} onChange={setPersonId} />
            <div>
              <DestinationSelect id="resolve-destination" value={destination} onChange={setDestination} />
              {errors.destination && <p className="text-red-600 text-xs mt-1">{errors.destination}</p>}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="resolve-note" className="text-xs font-medium text-gray-600 block mb-1">Nota <span className="text-red-500">*</span></label>
          <textarea id="resolve-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          {errors.note && <p className="text-red-600 text-xs mt-1">{errors.note}</p>}
        </div>

        <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
          La diferencia no se borra: queda como <strong>Resuelta</strong>, con quién la resolvió, cuándo y la causa.
        </p>

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? '...' : 'Resolver diferencia'}</button>
        </div>
      </form>
    </Modal>
  )
}
