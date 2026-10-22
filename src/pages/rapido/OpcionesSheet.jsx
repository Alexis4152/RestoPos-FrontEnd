import { useEffect, useState } from 'react'
import { getProductSuggestions } from '../../api/products'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { GruposModificadoresAbiertos } from '../../components/GruposModificadores'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)

/** Grupos activos de un producto, con sus opciones activas. */
export function gruposActivos(p) {
  return (p.modificadorGrupos ?? [])
    .filter((g) => g.isActive !== false)
    .map((g) => ({ ...g, opciones: (g.opciones ?? []).filter((o) => o.isActive !== false) }))
    .filter((g) => g.opciones.length > 0)
}

/**
 * Modo rápido · panel de opciones de un platillo. Las opciones obligatorias vienen
 * preseleccionadas con la más pedida SOLO si domina (backend: ProductService#sugerencias) y se
 * marcan "lo más pedido"; si el cliente quiere otra, se toca y listo. Si no hay una clara, no
 * se marca nada y "Agregar" queda bloqueado hasta elegir. Las notas rápidas (las que más se
 * escriben para este platillo) NUNCA vienen marcadas. `anterior` = lo elegido la última vez
 * para este platillo en esta mesa ("Igual que la anterior").
 */
export default function OpcionesSheet({ producto, anterior, onAgregar, onCerrar }) {
  const grupos = gruposActivos(producto)
  const [sel, setSel] = useState(() => Object.fromEntries(grupos.map((g) => [g.id, []])))
  const [sugeridas, setSugeridas] = useState({})
  const [notasFrecuentes, setNotasFrecuentes] = useState([])
  const [notas, setNotas] = useState([])
  const [notaLibre, setNotaLibre] = useState('')
  const [verNotaLibre, setVerNotaLibre] = useState(false)
  const [cantidad, setCantidad] = useState(1)
  useEscapeKey(onCerrar)

  useEffect(() => {
    let vivo = true
    getProductSuggestions(producto.id).then((r) => {
      if (!vivo) return
      const { opciones = {}, notas: frecuentes = [] } = r.data.data ?? {}
      const validas = {}
      for (const g of grupos) {
        const op = opciones[g.id]
        if (op && g.opciones.some((o) => o.id === op)) validas[g.id] = op
      }
      setSugeridas(validas)
      setNotasFrecuentes(frecuentes)
      // Solo se aplican si el mesero todavía no tocó ese grupo.
      setSel((s) => {
        const next = { ...s }
        for (const [gid, op] of Object.entries(validas)) if ((next[gid] ?? []).length === 0) next[gid] = [op]
        return next
      })
    }).catch(() => {})
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto.id])

  function tocar(g, opId) {
    setSel((s) => {
      const actual = s[g.id] ?? []
      if (g.tipo === 'UNICO') return { ...s, [g.id]: actual.includes(opId) && !g.obligatorio ? [] : [opId] }
      return { ...s, [g.id]: actual.includes(opId) ? actual.filter((x) => x !== opId) : [...actual, opId] }
    })
  }
  const tocarNota = (n) => setNotas((ns) => (ns.includes(n) ? ns.filter((x) => x !== n) : [...ns, n]))

  const ids = Object.values(sel).flat()
  const elegidas = grupos.flatMap((g) => g.opciones.filter((o) => (sel[g.id] ?? []).includes(o.id)))
  const unitario = Number(producto.price) + elegidas.reduce((s, o) => s + Number(o.precioExtra), 0)
  const faltan = grupos.filter((g) => g.obligatorio && (sel[g.id] ?? []).length === 0)
  const nota = [...notas, notaLibre.trim()].filter(Boolean).join(', ')

  function agregar(datos) {
    onAgregar({
      productoId: producto.id, nombre: producto.name, precio: datos.unitario, cantidad: datos.cantidad,
      opcionIds: datos.ids, resumen: datos.resumen, nota: datos.nota,
    })
  }
  const resumen = elegidas.map((o) => o.nombre).join(' · ')

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center" onClick={onCerrar}>
      <div role="dialog" aria-modal="true" aria-labelledby="opciones-titulo" onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto px-4 pt-3 pb-5 space-y-4">
        <span aria-hidden="true" className="block mx-auto w-11 h-1.5 rounded-full bg-[#D9D5CC] sm:hidden" />
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="opciones-titulo" className="text-xl font-extrabold">{producto.name}</h2>
          <span className="text-base font-extrabold">{fmt(producto.price)}</span>
        </div>
        {Object.keys(sugeridas).length > 0 && (
          <p className="-mt-2 text-sm text-gray-600">Ya viene con lo que más se pide. Si así va, solo toca Agregar.</p>
        )}

        <GruposModificadoresAbiertos grupos={grupos} sel={sel} onToggle={tocar}
          nota={(g, o) => (sugeridas[g.id] === o.id ? 'lo más pedido' : null)} />

        <div className="space-y-1.5">
          <p className="text-sm font-extrabold">Notas {notasFrecuentes.length > 0 && <span className="font-semibold text-gray-600">· las más usadas</span>}</p>
          <div className="flex flex-wrap gap-2">
            {notasFrecuentes.map((n) => (
              <button key={n} type="button" aria-pressed={notas.includes(n)} onClick={() => tocarNota(n)}
                className={`min-h-[40px] px-3.5 rounded-full text-[13px] font-bold border ${notas.includes(n) ? 'bg-gray-900 border-gray-900 text-white' : 'border-[#D9D5CC] bg-white text-gray-700'}`}>
                {n}
              </button>
            ))}
            <button type="button" aria-expanded={verNotaLibre} onClick={() => setVerNotaLibre((v) => !v)}
              className="min-h-[40px] px-3.5 rounded-full text-[13px] font-bold border border-dashed border-[#A8A398] bg-white text-gray-700">
              Escribir nota
            </button>
          </div>
          {verNotaLibre && (
            <>
              <label htmlFor="nota-libre" className="sr-only">Nota para cocina</label>
              <input id="nota-libre" className="input" maxLength={200} autoFocus placeholder="Ej. bien dorado" value={notaLibre}
                onChange={(e) => setNotaLibre(e.target.value)} />
            </>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <div className="flex items-center rounded-2xl border border-[#D9D5CC]">
            <button type="button" aria-label="Quitar uno" onClick={() => setCantidad((c) => Math.max(1, c - 1))}
              className="w-12 h-[52px] text-2xl font-extrabold">−</button>
            <span className="min-w-[28px] text-center text-lg font-extrabold" aria-live="polite">{cantidad}</span>
            <button type="button" aria-label="Agregar uno" onClick={() => setCantidad((c) => Math.min(99, c + 1))}
              className="w-12 h-[52px] text-2xl font-extrabold">+</button>
          </div>
          <button type="button" disabled={faltan.length > 0}
            onClick={() => agregar({ unitario, cantidad, ids, resumen, nota })}
            className="flex-1 min-h-[54px] rounded-2xl bg-purple-600 hover:bg-purple-700 text-white text-base font-extrabold disabled:opacity-50 disabled:cursor-not-allowed">
            {faltan.length > 0 ? `Elige ${faltan.map((g) => g.nombre.toLowerCase()).join(' y ')}` : `Agregar ${cantidad} · ${fmt(unitario * cantidad)}`}
          </button>
        </div>
        {anterior && (
          <button type="button" onClick={() => agregar({ ...anterior, cantidad: 1 })}
            className="block mx-auto min-h-[40px] text-sm font-bold text-purple-700 hover:underline">
            Igual que el anterior{anterior.resumen || anterior.nota ? ` (${[anterior.resumen, anterior.nota].filter(Boolean).join(' · ')})` : ''}
          </button>
        )}
      </div>
    </div>
  )
}
