import { useState } from 'react'
import { getTables, updateTable, deleteTable } from '../../api/mesas'
import { getZonas } from '../../api/zonas'
import { moveOrderTable, joinOrderTable, splitOrderTable, cancelOrder } from '../../api/ordenes'
import { useAuth } from '../../context/AuthContext'
import { useNotify } from '../../context/NotifyContext'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import ModalCloseButton from '../../components/ModalCloseButton'
import Icon from '../../components/Icon'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))
const nombre = (n) => (/^mesa\b/i.test(String(n)) ? String(n) : `Mesa ${n}`)
const porNumero = (a, b) => Number(a.numero) - Number(b.numero) || String(a.numero).localeCompare(String(b.numero))

/**
 * Menú "Opciones" del modo rápido: lo mismo que el modo detallado tiene para una mesa/orden, sin
 * salir a la vista detallada. Con orden abierta: mover de mesa, unir mesa, separar mesas unidas y
 * cancelar la orden (sin mesa, solo cancelar). Admin/supervisor además: editar la mesa y
 * desactivarla (solo si está libre). Mismas reglas y mismos endpoints que Tables/OrderDetail —
 * el backend sigue siendo quien decide (zona, cuentas generadas, permisos).
 *
 * @param mesa      mesa principal (null en un pedido sin mesa)
 * @param ordenId   orden abierta en esa mesa, o null si está libre
 * @param onCambio  tras mover/unir/separar/editar (recargar)
 * @param onCerrada tras cancelar la orden o desactivar la mesa (la vista ya no aplica)
 */
export default function OpcionesMesa({ mesa, ordenId, onCambio, onCerrada, compacto = false, className = '' }) {
  const { isAdmin } = useAuth()
  const { notify, confirmDialog } = useNotify()
  const [vista, setVista] = useState(null) // null | 'menu' | 'mover' | 'unir' | 'editar'
  const [mesas, setMesas] = useState(null)
  const [zonas, setZonas] = useState([])
  const [form, setForm] = useState({ numero: '', capacidad: '', zonaId: '' })
  const [busy, setBusy] = useState(false)

  const cerrar = () => { if (!busy) { setVista(null); setMesas(null) } }
  useEscapeKey(cerrar, vista != null)

  const hayAcciones = ordenId || (isAdmin && mesa)
  if (!hayAcciones) return null

  async function abrir(v) {
    setVista(v)
    if (v === 'menu' || v === 'editar') return
    try {
      const r = await getTables()
      setMesas(r.data.data ?? [])
    } catch { notify('No se pudieron cargar las mesas', 'error'); setVista('menu') }
  }

  async function ejecutar(fn, ok, despues = onCambio) {
    setBusy(true)
    try {
      const r = await fn()
      notify(r?.data?.message ?? ok, 'success')
      setVista(null)
      setMesas(null)
      despues?.()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo completar', 'error')
    } finally { setBusy(false) }
  }

  async function cancelar() {
    if (!(await confirmDialog('¿Cancelar toda la orden? Se libera la mesa.', { confirmText: 'Cancelar orden' }))) return
    ejecutar(() => cancelOrder(ordenId, 'Cancelada por el usuario'), 'Orden cancelada', onCerrada)
  }

  async function desactivar() {
    if (!(await confirmDialog(`¿Desactivar la ${nombre(mesa.numero).toLowerCase()}?`, { confirmText: 'Desactivar', danger: true }))) return
    ejecutar(() => deleteTable(mesa.id), 'Mesa desactivada', onCerrada)
  }

  async function abrirEditar() {
    setForm({ numero: String(mesa.numero ?? ''), capacidad: mesa.capacidad ? String(mesa.capacidad) : '', zonaId: mesa.zona?.id ? String(mesa.zona.id) : '' })
    setVista('editar')
    getZonas().then((r) => setZonas(r.data.data ?? [])).catch(() => setZonas([]))
  }

  function guardarEdicion(e) {
    e.preventDefault()
    if (!form.numero.trim()) { notify('El número/nombre es obligatorio', 'error'); return }
    if (!form.zonaId) { notify('Elige una zona', 'error'); return }
    ejecutar(() => updateTable(mesa.id, { numero: form.numero.trim(), capacidad: form.capacidad ? Number(form.capacidad) : null, zonaId: Number(form.zonaId) }), 'Mesa actualizada')
  }

  // Listas de mesas para mover (libres, cualquier zona) y unir (misma zona, que no sean de esta orden).
  const libres = (mesas ?? []).filter((m) => m.id !== mesa?.id && !m.ordenActiva && (m.estado === 'DISPONIBLE' || m.estado === 'RESERVADA')).sort(porNumero)
  const paraUnir = (mesas ?? []).filter((m) => m.ordenActiva?.id !== ordenId && m.estado !== 'FUERA_DE_SERVICIO'
    && String(m.zona?.id ?? '') === String(mesa?.zona?.id ?? '')).sort(porNumero)
  const unidas = (mesas ?? []).filter((m) => m.ordenActiva?.id === ordenId && m.id !== mesa?.id).sort(porNumero)

  const grupoPorZona = (lista, render) => [...new Set(lista.map((m) => m.zona?.nombre ?? 'Sin zona'))].map((z) => (
    <div key={z}>
      <p className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-1.5">{z}</p>
      <div className="flex flex-wrap gap-2">{lista.filter((m) => (m.zona?.nombre ?? 'Sin zona') === z).map(render)}</div>
    </div>
  ))

  const opcion = (icono, texto, onClick, peligro = false) => (
    <button type="button" onClick={onClick} disabled={busy}
      className={`w-full min-h-[52px] px-4 rounded-xl border text-left font-bold inline-flex items-center gap-3 disabled:opacity-50 ${
        peligro ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-[#E4E1DA] text-gray-900 hover:bg-[#F1EFEA]'}`}>
      <Icon name={icono} className="w-5 h-5" /> {texto}
    </button>
  )

  return (
    <>
      <button type="button" onClick={() => abrir('menu')} aria-label="Opciones de la mesa" title="Opciones"
        className={`min-h-[44px] px-3 rounded-xl border border-[#D9D5CC] bg-white text-gray-700 hover:bg-[#F1EFEA] inline-flex items-center justify-center gap-1.5 text-sm font-bold ${className}`}>
        <Icon name="opciones" className="w-5 h-5" />{!compacto && <span>Opciones</span>}
      </button>

      {vista && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-[70] sm:p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="opciones-mesa-titulo"
            className="relative bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-y-auto space-y-4">
            <ModalCloseButton onClick={cerrar} />
            <h3 id="opciones-mesa-titulo" className="text-lg font-extrabold pr-10">
              {vista === 'mover' ? 'Mover a otra mesa' : vista === 'unir' ? 'Unir una mesa' : vista === 'editar' ? 'Editar mesa' : mesa ? nombre(mesa.numero) : 'Opciones del pedido'}
            </h3>

            {vista === 'menu' && (
              <div className="space-y-2">
                {ordenId && mesa && opcion('mover', 'Mover de mesa', () => abrir('mover'))}
                {ordenId && mesa && opcion('unir', 'Unir mesa', () => abrir('unir'))}
                {isAdmin && mesa && opcion('editar', 'Editar mesa', abrirEditar)}
                {isAdmin && mesa && !ordenId && opcion('archivar', 'Desactivar mesa', desactivar, true)}
                {ordenId && opcion('borrar', 'Cancelar orden', cancelar, true)}
              </div>
            )}

            {vista === 'mover' && (
              <>
                <p className="text-sm text-gray-600 -mt-2">Productos, comensales y cuentas se van con la orden; {mesa && nombre(mesa.numero).toLowerCase()} queda libre.</p>
                {mesas === null ? <p className="text-sm text-gray-500 py-4 text-center">Cargando mesas…</p>
                  : libres.length === 0 ? <p className="text-sm text-gray-700 py-4 text-center">No hay mesas libres en este momento.</p>
                    : <div className="space-y-4">{grupoPorZona(libres, (m) => (
                      <button key={m.id} type="button" disabled={busy} onClick={() => ejecutar(() => moveOrderTable(ordenId, m.id), `Orden movida a ${nombre(m.numero).toLowerCase()}`)}
                        className="min-h-[48px] px-4 rounded-xl border border-[#D9D5CC] bg-white text-sm font-bold hover:border-purple-400 hover:bg-purple-50 disabled:opacity-50">
                        {nombre(m.numero)}{m.capacidad ? <span className="block text-[11px] font-semibold text-gray-600">{m.capacidad} lugares</span> : null}
                      </button>
                    ))}</div>}
              </>
            )}

            {vista === 'unir' && (
              <>
                <p className="text-sm text-gray-600 -mt-2">Solo mesas de la misma zona. Una libre queda ocupada por esta orden; si ya tiene su orden, sus productos y comensales pasan aquí.</p>
                {mesas === null ? <p className="text-sm text-gray-500 py-4 text-center">Cargando mesas…</p> : (
                  <>
                    {unidas.length > 0 && (
                      <div className="rounded-xl bg-[#E6EDF8] px-3 py-2.5 text-sm">
                        <p className="font-bold text-[#1E4585] mb-1.5">Ya unidas a esta orden</p>
                        <div className="flex flex-wrap gap-2">
                          {unidas.map((m) => (
                            <button key={m.id} type="button" disabled={busy}
                              onClick={async () => {
                                if (await confirmDialog(`¿Separar ${nombre(m.numero).toLowerCase()}? Queda libre; los productos se quedan en esta orden.`, { confirmText: 'Separar' })) {
                                  ejecutar(() => splitOrderTable(ordenId, m.id), `${nombre(m.numero)} separada`)
                                }
                              }}
                              className="min-h-[40px] px-3 rounded-lg bg-white text-[#1E4585] font-bold inline-flex items-center gap-1.5">
                              {nombre(m.numero)} <span className="text-xs font-semibold">· Separar</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {paraUnir.length === 0 ? <p className="text-sm text-gray-700 py-4 text-center">No hay otras mesas en {mesa?.zona?.nombre ?? 'esta zona'}.</p>
                      : <div className="space-y-4">{grupoPorZona(paraUnir, (m) => (
                        <button key={m.id} type="button" disabled={busy}
                          onClick={async () => {
                            if (m.ordenActiva && !(await confirmDialog(`${nombre(m.numero)} ya tiene su orden: sus productos y comensales pasan a esta y aquella se cierra. ¿Unirlas?`, { confirmText: 'Unir mesas' }))) return
                            ejecutar(() => joinOrderTable(ordenId, m.id), `${nombre(m.numero)} unida`)
                          }}
                          className="min-h-[48px] px-4 rounded-xl border border-[#D9D5CC] bg-white text-sm font-bold hover:border-purple-400 hover:bg-purple-50 text-left disabled:opacity-50">
                          {nombre(m.numero)}
                          <span className={`block text-[11px] font-semibold ${m.ordenActiva ? 'text-[#1E4585]' : 'text-[#22603C]'}`}>
                            {m.unidaA ? `Unida a mesa ${m.unidaA}` : m.ordenActiva ? `Ocupada · ${fmt(m.ordenActiva.total)}` : 'Libre'}
                          </span>
                        </button>
                      ))}</div>}
                  </>
                )}
              </>
            )}

            {vista === 'editar' && (
              <form onSubmit={guardarEdicion} className="space-y-3">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">Número / nombre *</span>
                  <input className="input" maxLength={20} value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">Lugares</span>
                  <input className="input" inputMode="numeric" placeholder="Sin capturar" value={form.capacidad}
                    onChange={(e) => setForm({ ...form, capacidad: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">Zona *</span>
                  <select className="input" value={form.zonaId} onChange={(e) => setForm({ ...form, zonaId: e.target.value })}>
                    <option value="">Selecciona una zona</option>
                    {zonas.map((z) => <option key={z.id} value={String(z.id)}>{z.nombre}</option>)}
                  </select>
                </label>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" className="btn-secondary" onClick={() => setVista('menu')} disabled={busy}>Atrás</button>
                  <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
                </div>
              </form>
            )}

            {(vista === 'mover' || vista === 'unir') && (
              <div className="flex justify-end">
                <button type="button" className="btn-secondary" onClick={() => setVista('menu')} disabled={busy}>Atrás</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
