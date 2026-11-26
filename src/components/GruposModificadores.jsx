import { useState } from 'react'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)

/** Máximo de opciones del grupo de varias (null = sin límite; en los de una sola no aplica). */
const maxDe = (g) => (g.tipo !== 'UNICO' && g.maxSelecciones ? g.maxSelecciones : null)
/** La misma opción se puede pedir varias veces (Cebolla ×3). Solo en grupos de varias. */
export const puedeRepetir = (g) => g.tipo !== 'UNICO' && !!g.permiteRepetir
/** Ya se eligió el máximo (en piezas si se repiten): las demás quedan bloqueadas hasta quitar alguna. */
const lleno = (g, sel) => { const m = maxDe(g); return m != null && (sel[g.id] ?? []).length >= m }
/** Cuántas veces se eligió una opción. */
const vecesDe = (sel, g, id) => (sel[g.id] ?? []).filter((x) => x === id).length

/** "elige 1" / "elige hasta 2" / "puedes elegir varias" / "hasta 7 en total". */
export function reglaGrupo(g) {
  if (g.tipo === 'UNICO') return 'elige 1'
  const m = maxDe(g)
  if (puedeRepetir(g)) return m ? `hasta ${m} en total` : 'se pueden repetir'
  return m ? `elige hasta ${m}` : 'puedes elegir varias'
}

/**
 * Aplica un toque a la selección `{grupoId: [opcionId]}`. `accion`: 'toggle' (casilla),
 * 'mas' o 'menos' (opción repetible: cada pieza es un id más en la lista).
 * `fijarObligatoria`: en un grupo de una sola opción obligatorio, tocar la elegida no la quita.
 */
export function cambiarSel(sel, g, opId, accion = 'toggle', { fijarObligatoria = false } = {}) {
  const actual = sel[g.id] ?? []
  if (g.tipo === 'UNICO') {
    const quitar = actual.includes(opId) && !(fijarObligatoria && g.obligatorio)
    return { ...sel, [g.id]: quitar ? [] : [opId] }
  }
  if (accion === 'mas') return lleno(g, sel) ? sel : { ...sel, [g.id]: [...actual, opId] }
  if (accion === 'menos') {
    const i = actual.lastIndexOf(opId)
    return i < 0 ? sel : { ...sel, [g.id]: actual.filter((_, j) => j !== i) }
  }
  if (actual.includes(opId)) return { ...sel, [g.id]: actual.filter((x) => x !== opId) }
  return lleno(g, sel) ? sel : { ...sel, [g.id]: [...actual, opId] }
}

/** Opciones elegidas, una por pieza (Cebolla ×3 = 3 veces), con el nombre de su grupo. */
export function elegidasDe(grupos, sel) {
  return grupos.flatMap((g) => (sel[g.id] ?? [])
    .map((id) => g.opciones.find((o) => o.id === id))
    .filter(Boolean)
    .map((o) => ({ ...o, grupo: g.nombre })))
}

/** "Jamón · Cebolla ×3" a partir de las elegidas (con repetidas). */
export function resumenElegidas(elegidas) {
  const cuenta = new Map()
  elegidas.forEach((o) => cuenta.set(o.id, { nombre: o.nombre, n: (cuenta.get(o.id)?.n ?? 0) + 1 }))
  return [...cuenta.values()].map(({ nombre, n }) => (n > 1 ? `${nombre} ×${n}` : nombre)).join(' · ')
}

/**
 * Preselección de una línea ya guardada: la línea guarda nombres (grupo + opción), no ids, y una
 * fila por pieza; los extras libres no son del menú y se dejan fuera.
 */
export function selDesdeModificadores(grupos, mods) {
  const sel = {}
  grupos.forEach((g) => {
    sel[g.id] = g.opciones.flatMap((o) => {
      const n = (mods ?? []).filter((m) => !m.libre && m.grupoNombre === g.nombre && m.nombre === o.nombre).length
      return Array(n).fill(o.id)
    })
  })
  return sel
}

/** Modificadores de una línea agrupados: una fila por pieza → { ..., cantidad }. */
export function agruparMods(mods) {
  const out = new Map()
  ;(mods ?? []).forEach((m) => {
    const k = [m.grupoNombre, m.nombre, Number(m.precioExtra || 0), !!m.libre].join('|')
    const prev = out.get(k)
    out.set(k, prev ? { ...prev, cantidad: prev.cantidad + 1 } : { ...m, cantidad: 1 })
  })
  return [...out.values()]
}

/**
 * Texto de los modificadores de una línea: "Jamón · Cebolla ×3 · Aguacate (libre)".
 * `conGrupo` antepone el grupo, `conPrecio` agrega el costo, `marcarLibre` (default sí) marca los
 * extras libres — cocina no lo necesita.
 */
export function textoMods(mods, { conGrupo = false, conPrecio = false, marcarLibre = true } = {}) {
  return agruparMods(mods).map((m) => {
    const total = Number(m.precioExtra || 0) * m.cantidad
    return `${conGrupo && !m.libre ? `${m.grupoNombre} ` : ''}${m.nombre}${m.cantidad > 1 ? ` ×${m.cantidad}` : ''}`
      + `${marcarLibre && m.libre ? ' (libre)' : ''}${conPrecio && total > 0 ? ` (+${fmt(total)})` : ''}`
  }).join(' · ')
}

/** Botones − n + de una opción repetible. */
function Contador({ g, o, sel, onToggle, disabled, grande = false }) {
  const n = vecesDe(sel, g, o.id)
  const tope = lleno(g, sel)
  const btn = `${grande ? 'w-11 h-11 text-xl' : 'w-9 h-9 text-lg'} rounded-full font-extrabold flex items-center justify-center disabled:opacity-40`
  return (
    <span className="flex items-center gap-2 shrink-0">
      <button type="button" aria-label={`Quitar una ${o.nombre}`} disabled={disabled || n === 0}
        onClick={() => onToggle(g, o.id, 'menos')} className={`${btn} border border-[#D9D5CC] bg-white text-gray-700`}>−</button>
      <span className="w-6 text-center font-extrabold" aria-live="polite">{n}</span>
      <button type="button" aria-label={`Agregar una ${o.nombre}`} disabled={disabled || tope}
        title={tope ? `Máximo ${maxDe(g)} en total: quita una para agregar otra` : undefined}
        onClick={() => onToggle(g, o.id, 'mas')} className={`${btn} bg-purple-600 text-white`}>+</button>
    </span>
  )
}

/** Fila de una opción repetible: nombre, precio, − n + y lo que suma. */
function FilaRepetible({ g, o, sel, onToggle, nota, disabled, grande }) {
  const n = vecesDe(sel, g, o.id)
  const extra = nota?.(g, o)
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-1.5 ${n > 0 ? 'border-purple-600 bg-purple-50' : 'border-[#E4E1DA]'}`}>
      <span className="flex-1 min-w-0 text-sm font-semibold text-gray-800">
        {o.nombre}
        {Number(o.precioExtra) > 0 && <span className="ml-1.5 text-gray-600">+{fmt(o.precioExtra)}</span>}
        {extra && <span className="ml-1.5 text-[11px] font-semibold text-gray-600">{extra}</span>}
      </span>
      <Contador g={g} o={o} sel={sel} onToggle={onToggle} disabled={disabled} grande={grande} />
      <span className="w-16 text-right text-sm font-bold text-gray-700">{n > 0 && Number(o.precioExtra) > 0 ? fmt(n * Number(o.precioExtra)) : ''}</span>
    </div>
  )
}

/**
 * Grupos de modificadores en acordeón — el mismo comportamiento en la página web, el punto
 * de venta detallado. El modo rápido usa GruposModificadoresAbiertos (todo a la vista):
 *  - todos empiezan cerrados; el encabezado dice lo elegido o "Elige una opción";
 *  - tocar un grupo lo abre y cierra el que estuviera abierto (solo uno a la vez);
 *  - en un grupo de una sola opción, al elegir se cierra solo; los de varias se quedan
 *    abiertos hasta tocar otro grupo (o el mismo encabezado);
 *  - en un grupo que permite repetir, cada opción lleva − n + (Cebolla ×3).
 *
 * Props: `grupos` [{id, nombre, tipo: 'UNICO'|'MULTIPLE', obligatorio, maxSelecciones, permiteRepetir, opciones: [{id, nombre, precioExtra}]}],
 * `sel` {grupoId: [opcionId]} (un id repetido = otra pieza), `onToggle(grupo, opcionId, accion)`
 * (accion: 'toggle' | 'mas' | 'menos'; quien lo usa aplica `cambiarSel`), `nota(grupo, opcion)`
 * texto chico opcional junto a la opción (ej. "lo más pedido"), `disabled` (solo lectura).
 */
export default function GruposModificadores({ grupos, sel, onToggle, nota, disabled = false }) {
  const [abierto, setAbierto] = useState(null)

  function elegir(g, opId) {
    if (disabled) return
    const yaEstaba = (sel[g.id] ?? []).includes(opId)
    if (!yaEstaba && lleno(g, sel)) return
    onToggle(g, opId, 'toggle')
    if (g.tipo === 'UNICO' && !yaEstaba) setAbierto(null)
  }

  return (
    <div className="space-y-2">
      {grupos.map((g) => {
        const elegidas = elegidasDe([g], sel)
        const falta = g.obligatorio && elegidas.length === 0
        const open = abierto === g.id
        const panelId = `grupo-${g.id}-opciones`
        const repite = puedeRepetir(g)
        return (
          <div key={g.id} className={`rounded-xl border ${open ? 'border-purple-300' : falta ? 'border-red-200' : 'border-[#E4E1DA]'} bg-white overflow-hidden`}>
            <button type="button" aria-expanded={open} aria-controls={panelId}
              onClick={() => setAbierto(open ? null : g.id)}
              className="w-full min-h-[48px] flex items-center gap-2 px-3 py-2 text-left hover:bg-[#F7F6F2]">
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-extrabold text-gray-900">
                  {g.nombre}
                  <span className="ml-1.5 text-xs font-semibold text-gray-600">
                    {g.obligatorio ? 'Obligatorio' : 'Opcional'}{g.tipo !== 'UNICO' ? ` · ${reglaGrupo(g)}` : ''}
                  </span>
                </span>
                <span className={`block text-xs truncate ${elegidas.length ? 'font-bold text-purple-700' : falta ? 'font-semibold text-red-700' : 'text-gray-600'}`}>
                  {elegidas.length ? resumenElegidas(elegidas) : falta ? 'Elige una opción' : 'Sin elegir'}
                  {repite && maxDe(g) ? ` (${elegidas.length} de ${maxDe(g)})` : ''}
                </span>
              </span>
              <svg aria-hidden="true" viewBox="0 0 24 24" className={`w-5 h-5 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {open && (
              <div id={panelId} className="px-3 pb-3 pt-1 space-y-1.5 border-t border-[#ECE9E2]">
                {g.opciones.map((o) => {
                  if (repite) return <FilaRepetible key={o.id} g={g} o={o} sel={sel} onToggle={onToggle} nota={nota} disabled={disabled} />
                  const on = (sel[g.id] ?? []).includes(o.id)
                  const extra = nota?.(g, o)
                  const bloqueada = !on && lleno(g, sel)
                  return (
                    <button key={o.id} type="button" aria-pressed={on} disabled={disabled || bloqueada} onClick={() => elegir(g, o.id)}
                      title={bloqueada ? `Máximo ${maxDe(g)}: quita una para elegir otra` : undefined}
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

/**
 * Variante del modo rápido: TODOS los grupos a la vista de una vez (sin acordeón), con las
 * opciones como botones grandes de un toque — el mesero elige sin abrir ni cerrar nada.
 * Mismas props que GruposModificadores.
 */
export function GruposModificadoresAbiertos({ grupos, sel, onToggle, nota, disabled = false }) {
  return (
    <div className="space-y-4">
      {grupos.map((g) => {
        const piezas = (sel[g.id] ?? []).length
        const falta = g.obligatorio && piezas === 0
        const repite = puedeRepetir(g)
        return (
          <fieldset key={g.id} className="space-y-1.5" disabled={disabled}>
            <legend className="text-sm font-extrabold">
              {g.nombre}{' '}
              <span className={`font-semibold ${falta ? 'text-red-700' : 'text-gray-600'}`}>
                · {reglaGrupo(g)}{g.obligatorio ? '' : ' (opcional)'}
                {repite && maxDe(g)
                  ? <span className="ml-1 text-purple-700">· llevas {piezas} de {maxDe(g)}</span>
                  : lleno(g, sel) && <span className="ml-1 text-purple-700">· listo</span>}
              </span>
            </legend>
            {repite ? (
              <div className="space-y-1.5">
                {g.opciones.map((o) => <FilaRepetible key={o.id} g={g} o={o} sel={sel} onToggle={onToggle} nota={nota} disabled={disabled} grande />)}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {g.opciones.map((o) => {
                  const on = (sel[g.id] ?? []).includes(o.id)
                  const extra = nota?.(g, o)
                  const bloqueada = !on && lleno(g, sel)
                  return (
                    <button key={o.id} type="button" aria-pressed={on} disabled={bloqueada} onClick={() => onToggle(g, o.id, 'toggle')}
                      title={bloqueada ? `Máximo ${maxDe(g)}: quita una para elegir otra` : undefined}
                      className={`min-h-[44px] px-4 rounded-full text-sm font-bold border disabled:opacity-50 ${on ? 'border-2 border-purple-600 bg-purple-50 text-purple-800' : 'border-[#D9D5CC] bg-white text-gray-700'}`}>
                      {o.nombre}{Number(o.precioExtra) > 0 ? ` +${fmt(o.precioExtra)}` : ''}
                      {extra && <span className="ml-1.5 text-[11px] font-semibold text-gray-600">{extra}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </fieldset>
        )
      })}
    </div>
  )
}
