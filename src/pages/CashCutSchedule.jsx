import { useEffect, useState } from 'react'
import { getCashCutSchedule, updateCashCutSchedule } from '../api/cashCuts'
import { useNotify } from '../context/NotifyContext'

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const pad2 = (n) => String(n).padStart(2, '0')

/**
 * Pantalla "Cierre automático de cortes" (Configuración → solo SUPER_ADMIN): administra el
 * horario global (una sola fila, aplica a TODAS las tiendas por igual — no hay un horario
 * por tienda) en el que {@code CashCutAutoCloseJob} cierra automáticamente cualquier corte
 * de caja que haya quedado abierto ese día, y manda el reporte Excel consolidado a los
 * administradores de cada tienda afectada.
 *
 * Deliberadamente distinto del cierre manual (botón "Cerrar corte" en Cortes de Caja): ese
 * cierre nunca manda correo por su cuenta — solo este job diario lo hace, una vez, agrupando
 * TODOS los cortes cerrados en el día (manuales y automáticos).
 */
export default function CashCutSchedule() {
  const { notify } = useNotify()
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getCashCutSchedule().then((r) => {
      const s = r.data.data
      setForm({ closeHour: s.closeHour, closeMinute: s.closeMinute, enabled: s.enabled })
    }).finally(() => setLoading(false))
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await updateCashCutSchedule(form)
      const s = res.data.data
      setForm({ closeHour: s.closeHour, closeMinute: s.closeMinute, enabled: s.enabled })
      notify('Horario actualizado', 'success')
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo guardar el horario', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !form) return <p className="text-gray-400 text-sm">Cargando...</p>

  return (
    <div className="max-w-xl">
      <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900 mb-1">Cierre automático de cortes</h1>
      <p className="text-gray-500 text-sm mb-6">
        A esta hora, todos los días, el sistema cierra automáticamente cualquier corte de caja que
        haya quedado abierto (en cualquier tienda) y manda un reporte de cierre en Excel a los
        administradores de cada tienda afectada — junto con los cortes que ya se hubieran cerrado
        a mano ese mismo día. El cierre manual nunca manda ese correo por su cuenta; solo este
        horario lo hace, una vez al día.
      </p>

      <form onSubmit={handleSave} className="card space-y-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Cierre automático activado
        </label>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Hora de cierre</label>
          <div className="flex items-center gap-2">
            <select className="input !w-auto" value={form.closeHour}
              onChange={(e) => setForm({ ...form, closeHour: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{pad2(h)}</option>)}
            </select>
            <span className="text-gray-400">:</span>
            <select className="input !w-auto" value={form.closeMinute}
              onChange={(e) => setForm({ ...form, closeMinute: Number(e.target.value) })}>
              {MINUTES.map((m) => <option key={m} value={m}>{pad2(m)}</option>)}
            </select>
            <span className="text-sm text-gray-400">(hora del servidor)</span>
          </div>
        </div>

        {!form.enabled && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            El cierre automático está desactivado: un corte que alguien olvide cerrar se queda abierto indefinidamente.
          </p>
        )}

        <button className="btn-primary" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar horario'}
        </button>
      </form>
    </div>
  )
}
