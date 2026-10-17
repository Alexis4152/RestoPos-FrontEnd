import { useEffect, useState } from 'react'
import { getCashPeople, getReportRecipients, updateReportRecipients } from '../../api/cashRegisters'
import { useNotify } from '../../context/NotifyContext'
import { roleLabel } from '../../utils/roleLabels'

// Mismo patrón simple que el resto del frontend (POS.jsx/Users.jsx); el backend vuelve a validar.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAILS = 10

/**
 * A quién le llega el reporte de "Corte de fin de día" de las cajas de la tienda. El
 * supervisor (dueño) lo recibe por default; él (o un SUPER_ADMIN) puede sumar usuarios de la
 * tienda y correos libres de personas sin acceso al sistema. Un ADMIN solo lo ve.
 */
/** Etiqueta de rol junto al nombre de una persona. */
function RoleTag({ role }) {
  if (!role) return null
  return <span className="ml-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">{roleLabel(role)}</span>
}

export default function ReportRecipientsCard() {
  const { notify, confirmDialog } = useNotify()
  const [config, setConfig] = useState(null)
  const [toSupervisor, setToSupervisor] = useState(true)
  const [userIds, setUserIds] = useState([])
  const [emails, setEmails] = useState([])
  const [newEmail, setNewEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [saving, setSaving] = useState(false)
  const [people, setPeople] = useState([])

  function apply(c) {
    setConfig(c)
    setToSupervisor(c.reportToSupervisor)
    setUserIds(c.users.map((u) => u.id))
    setEmails(c.emails)
  }

  useEffect(() => {
    getReportRecipients().then((r) => apply(r.data.data)).catch(() => setConfig(null))
    getCashPeople().then((r) => setPeople(r.data.data ?? [])).catch(() => setPeople([]))
  }, [])

  if (!config) return null
  const canEdit = config.canEdit
  const selectable = people.filter((p) => p.id !== config.supervisor?.id)

  function toggleUser(id) {
    setUserIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  function addEmail() {
    const e = newEmail.trim().toLowerCase()
    if (!e) return
    if (e.length > 150) { setEmailError('El correo no puede tener más de 150 caracteres'); return }
    if (!EMAIL_RE.test(e)) { setEmailError('El correo no tiene un formato válido'); return }
    if (emails.includes(e)) { setEmailError('Ese correo ya está en la lista'); return }
    if (emails.length >= MAX_EMAILS) { setEmailError(`Máximo ${MAX_EMAILS} correos adicionales`); return }
    setEmails([...emails, e])
    setNewEmail('')
    setEmailError('')
  }

  async function save() {
    if (!(await confirmDialog('¿Guardar los destinatarios del reporte de fin de día?', { confirmText: 'Guardar', danger: false }))) return
    setSaving(true)
    try {
      const r = await updateReportRecipients({ reportToSupervisor: toSupervisor, userIds, emails })
      apply(r.data.data)
      notify('Destinatarios guardados', 'success')
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudieron guardar los destinatarios', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900">Reporte de corte de fin de día</h3>
        <p className="text-sm text-gray-500">
          Cada vez que una caja hace su corte de fin de día se envía un correo con el Excel de sus cortes del día.
        </p>
      </div>

      {!canEdit ? (
        <div className="text-sm">
          <p className="text-gray-600 mb-1">Se envía a:</p>
          {config.effective.length > 0
            ? <ul className="list-disc list-inside text-gray-800">{config.effective.map((e) => <li key={e}>{e}</li>)}</ul>
            : <p className="text-gray-500">Nadie todavía.</p>}
          <p className="text-xs text-gray-500 mt-2">Solo el supervisor de la tienda puede cambiar los destinatarios.</p>
        </div>
      ) : (
        <>
          {config.supervisor ? (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={toSupervisor} onChange={(e) => setToSupervisor(e.target.checked)} />
              Enviarlo al supervisor: <strong>{config.supervisor.name}</strong><RoleTag role={config.supervisor.role} /> <span className="text-gray-500">({config.supervisor.email})</span>
            </label>
          ) : (
            <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-2">Esta tienda no tiene supervisor asignado.</p>
          )}

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Usuarios de la tienda</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {selectable.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={userIds.includes(p.id)} onChange={() => toggleUser(p.id)} />
                  {p.name}<RoleTag role={p.role} />
                </label>
              ))}
              {selectable.length === 0 && <span className="text-sm text-gray-400">Sin usuarios</span>}
            </div>
          </div>

          <div>
            <label htmlFor="extra-email" className="text-xs font-medium text-gray-600 block mb-1">Correos adicionales (personas sin acceso al sistema)</label>
            <div className="flex gap-2 max-w-md">
              <input
                id="extra-email" className="input" type="text" inputMode="email" placeholder="dueno@correo.com"
                value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setEmailError('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail() } }}
              />
              <button type="button" className="btn-secondary whitespace-nowrap" onClick={addEmail}>Agregar</button>
            </div>
            {emailError && <p className="text-red-600 text-xs mt-1">{emailError}</p>}
            {emails.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {emails.map((e) => (
                  <li key={e} className="flex items-center gap-2 bg-gray-100 rounded-full pl-3 pr-1 py-1 text-sm">
                    {e}
                    <button type="button" aria-label={`Quitar ${e}`} className="w-6 h-6 rounded-full text-gray-500 hover:bg-gray-200" onClick={() => setEmails(emails.filter((x) => x !== e))}>✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              Hoy se envía a: {config.effective.length > 0 ? config.effective.join(', ') : 'nadie'}. Si no queda nadie configurado, se envía a los administradores de la tienda.
            </p>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>{saving ? '...' : 'Guardar destinatarios'}</button>
          </div>
        </>
      )}
    </div>
  )
}
