import { useState } from 'react'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)

/**
 * Grupos de modificadores en acordeón — el mismo comportamiento en la página web, el punto
 * de venta (detallado y rápido) y al editar un producto ya pedido:
 *  - todos empiezan cerrados; el encabezado dice lo elegido o "Elige una opción";
 *  - tocar un grupo lo abre y cierra el que estuviera abierto (solo uno a la vez);
 *  - en un grupo de una sola opción, al elegir se cierra solo; los de varias se quedan
 *    abiertos hasta tocar otro grupo (o el mismo encabezado).
 *
 * Props: `grupos` [{id, nombre, tipo: 'UNICO'|'MULTIPLE', obligatorio, opciones: [{id, nombre, precioExtra}]}],
 * `sel` {grupoId: [opcionId]}, `onToggle(grupo, opcionId)` (la selección la guarda quien lo usa),
 * `nota(grupo, opcion)` texto chico opcional junto a la opción (ej. "lo más pedido"),
 * `disabled` (solo lectura).
 */
export default function GruposModificadores({ grupos, sel, onToggle, nota, disabled = false }) {
  const [abierto, setAbierto] = useState(null)

  function elegir(g, opId) {
    if (disabled) return
    const yaEstaba = (sel[g.id] ?? []).includes(opId)
    onToggle(g, opId)
    if (g.tipo === 'UNICO' && !yaEstaba) setAbierto(null)
  }

  return (
    <div className="space-y-2">
      {grupos.map((g) => {
        const elegidas = g.opciones.filter((o) => (sel[g.id] ?? []).includes(o.id))
        const falta = g.obligatorio && elegidas.length === 0
        const open = abierto === g.id
        const panelId = `grupo-${g.id}-opciones`
        return (
          <div key={g.id} className={`rounded-xl border ${open ? 'border-purple-300' : falta ? 'border-red-200' : 'border-[#E4E1DA]'} bg-white overflow-hidden`}>
            <button type="button" aria-expanded={open} aria-controls={panelId}
              onClick={() => setAbierto(open ? null : g.id)}
              className="w-full min-h-[48px] flex items-center gap-2 px-3 py-2 text-left hover:bg-[#F7F6F2]">
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-extrabold text-gray-900">
                  {g.nombre}
                  <span className="ml-1.5 text-xs font-semibold text-gray-600">
                    {g.obligatorio ? 'Obligatorio' : 'Opcional'}{g.tipo !== 'UNICO' ? ' · varias' : ''}
                  </span>
                </span>
                <span className={`block text-xs truncate ${elegidas.length ? 'font-bold text-purple-700' : falta ? 'font-semibold text-red-700' : 'text-gray-600'}`}>
                  {elegidas.length ? elegidas.map((o) => o.nombre).join(', ') : falta ? 'Elige una opción' : 'Sin elegir'}
                </span>
              </span>
              <svg aria-hidden="true" viewBox="0 0 24 24" className={`w-5 h-5 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {open && (
              <div id={panelId} className="px-3 pb-3 pt-1 space-y-1.5 border-t border-[#ECE9E2]">
                {g.opciones.map((o) => {
                  const on = (sel[g.id] ?? []).includes(o.id)
                  const extra = nota?.(g, o)
                  return (
                    <button key={o.id} type="button" aria-pressed={on} disabled={disabled} onClick={() => elegir(g, o.id)}
                      className={`w-full min-h-[44px] flex items-center gap-3 rounded-lg border px-3 py-2 text-left disabled:opacity-60 ${on ? 'border-purple-600 bg-purple-50' : 'border-[#E4E1DA] hover:border-gray-400'}`}>
                      <span aria-hidden="true" className={`w-5 h-5 shrink-0 flex items-center justify-center text-xs font-bold ${g.tipo === 'UNICO' ? 'rounded-full' : 'rounded'} ${on ? 'bg-purple-600 text-white' : 'border border-gray-400'}`}>{on ? '✓' : ''}</span>
                      <span className="flex-1 text-sm font-semibold text-gray-800">
                        {o.nombre}
                        {extra && <span className="ml-1.5 text-[11px] font-semibold text-gray-600">{extra}</span>}
                      </span>
                      {Number(o.precioExtra) > 0 && <span className="text-sm font-semibold text-gray-600">+{fmt(o.precioExtra)}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
