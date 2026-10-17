import { useState } from 'react'
import { resolveCountDifference } from '../../api/cashCuts'
import { useNotify } from '../../context/NotifyContext'
import { Modal, PersonSelect, SummaryRow, fmt } from './common'

const HANDOVER_RESOLUTION_LABELS = { UNREGISTERED_WITHDRAWAL: 'retiro no registrado', SHORTAGE: 'diferencia confirmada', COUNT_ERROR: 'error de conteo' }
export const ARQUEO_RESOLUTION_LABELS = { SHORTAGE: 'Faltante confirmado', SURPLUS: 'Sobrante confirmado', COUNT_ERROR: 'Error de conteo' }

const signed = (n) => `${n < 0 ? '−' : '+'}${fmt(Math.abs(n))}`

/**
 * Resolver la diferencia del arqueo de cierre de un corte. Muestra junto con ella la
 * diferencia al recibir la caja, porque el arqueo depende de ese conteo: si la recepción se
 * resolvió como error de conteo con el corte ya cerrado, la diferencia real del turno es
 * otra (`effectiveCashDifference`, que calcula el backend). Si la recepción sigue sin
 * resolver, no deja resolver el arqueo todavía.
 */
export default function ResolveArqueoModal({ cut, people, onClose, onSaved }) {
  const { notify, confirmDialog } = useNotify()
  const closeDiff = Number(cut.cashDifference ?? 0)
  const effective = Number(cut.effectiveCashDifference ?? closeDiff)
  const adjusted = Math.round((effective - closeDiff) * 100) !== 0
  const hasReceive = cut.expectedOpeningAmount != null && Number(cut.handoverDifference ?? 0) !== 0
  const receiveDiff = Number(cut.handoverDifference ?? 0)
  const receivePending = cut.handoverStatus === 'DIFFERENCE'

  const options = [
    ...(effective < 0 ? [{ value: 'SHORTAGE', title: 'Faltante confirmado', desc: 'El dinero no apareció: se genera un faltante a cargo de una persona, que podrá pagarlo o abonarlo en Faltantes.' }] : []),
    ...(effective > 0 ? [{ value: 'SURPLUS', title: 'Sobrante confirmado', desc: 'Sí sobró dinero: queda registrado. El dinero ya está en la caja (pasó al siguiente turno).' }] : []),
    { value: 'COUNT_ERROR', title: 'Error de conteo', desc: 'Se contó mal y el dinero sí cuadraba. Si la caja sigue cerrada y este fue su último corte, se corrige lo que recibirá el siguiente turno.' },
  ]
  const [resolution, setResolution] = useState(options[0].value)
  const [responsibleId, setResponsibleId] = useState(cut.user?.id ?? null)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const responsibleName = people.find((p) => p.id === responsibleId)?.name

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = {}
    if (resolution === 'SHORTAGE' && !responsibleId) errs.responsible = 'Indica quién es responsable del faltante'
    if (!note.trim()) errs.note = 'La nota es obligatoria'
    if (note.length > 200) errs.note = 'La nota no puede tener más de 200 caracteres'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    const msg = resolution === 'SHORTAGE'
      ? `¿Resolver como faltante confirmado? Se generará un faltante de ${fmt(Math.abs(effective))} a cargo de ${responsibleName ?? 'la persona elegida'}.`
      : `¿Resolver la diferencia del arqueo como «${ARQUEO_RESOLUTION_LABELS[resolution].toLowerCase()}»? Quedará registrada y no se puede deshacer.`
    if (!(await confirmDialog(msg, { confirmText: 'Resolver', danger: false }))) return
    setLoading(true)
    try {
      await resolveCountDifference(cut.id, { resolution, note: note.trim(), responsibleId: resolution === 'SHORTAGE' ? responsibleId : null })
      notify('Diferencia de arqueo resuelta', 'success')
      onSaved()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo resolver la diferencia', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="Resolver diferencia de arqueo" subtitle={`Corte #${cut.id}${cut.cashRegister ? ` · ${cut.cashRegister.name}` : ''} · ${cut.user?.name ?? ''}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {hasReceive && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm">
            <p className="text-xs font-semibold text-gray-600">Al recibir la caja</p>
            <SummaryRow label={`Debía recibir${cut.previousUserName ? ` (de ${cut.previousUserName})` : ''}`}>{fmt(cut.expectedOpeningAmount)}</SummaryRow>
            <SummaryRow label="Contó">{fmt(Number(cut.expectedOpeningAmount) + receiveDiff)}</SummaryRow>
            <SummaryRow label="Diferencia"><span className={receiveDiff < 0 ? 'text-red-700' : 'text-amber-800'}>{signed(receiveDiff)}</span></SummaryRow>
            <p className={`text-xs font-semibold ${receivePending ? 'text-red-700' : 'text-gray-600'}`}>
              {receivePending ? 'Pendiente de resolver' : `Resuelta como ${HANDOVER_RESOLUTION_LABELS[cut.handoverResolution] ?? '—'}`}
            </p>
          </div>
        )}

        <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm">
          <p className="text-xs font-semibold text-gray-600">Al cerrar (arqueo)</p>
          <SummaryRow label="Efectivo esperado">{fmt(cut.closingAmount)}</SummaryRow>
          <SummaryRow label="Contado">{fmt(cut.countedAmount)}</SummaryRow>
          <SummaryRow label="Diferencia"><span className={closeDiff < 0 ? 'text-red-700' : 'text-amber-800'}>{signed(closeDiff)}</span></SummaryRow>
        </div>

        {adjusted && (
          <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-900 space-y-1">
            <p>La diferencia al recibir se resolvió como <strong>error de conteo</strong>: el fondo real era {fmt(cut.expectedOpeningAmount)}, así que el esperado real al cerrar era {fmt(Number(cut.closingAmount) - receiveDiff)}.</p>
            <p className="font-semibold">Diferencia real del turno: {signed(effective)}</p>
          </div>
        )}
        {!adjusted && hasReceive && !receivePending && Math.sign(receiveDiff) !== Math.sign(closeDiff) && (
          <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3">
            Ojo: el arqueo parte de lo que se contó al recibir. Las dos diferencias van en sentido contrario (neto del turno: {signed(receiveDiff + closeDiff)}); revisa que la de recepción se haya resuelto correctamente antes de cobrar un faltante.
          </p>
        )}

        {receivePending ? (
          <p className="text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg p-3">
            Primero resuelve la diferencia al recibir la caja (pestaña <strong>Cajas</strong> → Últimas entregas). El arqueo depende de ese conteo.
          </p>
        ) : (
          <>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-gray-600 mb-1">¿Qué pasó?</legend>
              {options.map((o) => (
                <label key={o.value} className={`flex gap-3 items-start p-3 rounded-xl cursor-pointer ${resolution === o.value ? 'border-2 border-purple-600 bg-purple-50' : 'border border-gray-200'}`}>
                  <input type="radio" name="arqueo-resolution" className="mt-1 w-4 h-4" checked={resolution === o.value} onChange={() => setResolution(o.value)} />
                  <span><span className="block font-semibold text-sm">{o.title}</span><span className="block text-sm text-gray-500">{o.desc}</span></span>
                </label>
              ))}
            </fieldset>

            {resolution === 'SHORTAGE' && (
              <div className="space-y-2">
                <PersonSelect id="arqueo-responsible" label="¿Quién es responsable del faltante?" people={people} value={responsibleId} onChange={setResponsibleId} />
                {errors.responsible && <p className="text-red-600 text-xs">{errors.responsible}</p>}
                <p className="text-sm text-red-900 bg-red-50 rounded-lg p-3">
                  Se generará un faltante de <strong>{fmt(Math.abs(effective))}</strong>{responsibleName ? <> a cargo de <strong>{responsibleName}</strong></> : ''}. Se cobra desde la pestaña <strong>Faltantes</strong>.
                </p>
              </div>
            )}

            <div>
              <label htmlFor="arqueo-note" className="text-xs font-medium text-gray-600 block mb-1">Nota <span className="text-red-500">*</span></label>
              <textarea id="arqueo-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              {errors.note && <p className="text-red-600 text-xs mt-1">{errors.note}</p>}
            </div>
          </>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>{receivePending ? 'Cerrar' : 'Cancelar'}</button>
          {!receivePending && <button type="submit" className="btn-primary" disabled={loading}>{loading ? '...' : 'Resolver diferencia'}</button>}
        </div>
      </form>
    </Modal>
  )
}
