import { useEffect, useState } from 'react'
import { getProducts, setProductAvailable } from '../api/products'
import { useNotify } from '../context/NotifyContext'
import { useEscapeKey } from '../hooks/useEscapeKey'

/**
 * "Agotados": el mesero (o el admin) marca un platillo como agotado cuando ya no hay para
 * prepararlo, y lo regresa cuando vuelve a haber. Mientras esté agotado no aparece al agregar
 * productos a una orden ni en la página web (ver PATCH /products/{id}/disponible).
 * `onChanged` se llama tras cada cambio para que la pantalla de atrás recargue su lista.
 */
export default function AgotadosModal({ onClose, onChanged }) {
  const { notify } = useNotify()
  const [productos, setProductos] = useState(null)
  const [q, setQ] = useState('')
  const [vista, setVista] = useState('todos')
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    getProducts().then((r) => setProductos(r.data.data ?? [])).catch(() => setProductos([]))
  }, [])
  useEscapeKey(onClose)

  async function cambiar(p) {
    const disponible = p.disponible === false
    setBusyId(p.id)
    try {
      const r = await setProductAvailable(p.id, disponible)
      setProductos((lista) => lista.map((x) => (x.id === p.id ? { ...x, disponible } : x)))
      notify(r.data.message ?? (disponible ? 'Disponible de nuevo' : 'Marcado como agotado'), 'success')
      onChanged?.()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo cambiar el platillo', 'error')
    } finally { setBusyId(null) }
  }

  const agotados = (productos ?? []).filter((p) => p.disponible === false)
  const texto = q.trim().toLowerCase()
  const visibles = (vista === 'agotados' ? agotados : productos ?? [])
    .filter((p) => !texto || p.name.toLowerCase().includes(texto) || (p.category?.name ?? '').toLowerCase().includes(texto))

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-labelledby="agotados-titulo">
        <h3 id="agotados-titulo" className="text-lg font-extrabold">Platillos agotados</h3>
        <p className="text-sm text-gray-600 mt-1">
          Si ya no hay para prepararlo, márcalo como agotado: no se podrá agregar a órdenes ni pedir en la página web hasta que lo regreses.
        </p>
        <input className="input mt-3" placeholder="Buscar platillo o categoría..." value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="flex gap-2 mt-3" aria-label="Filtrar">
          <button type="button" aria-pressed={vista === 'todos'} className={`chip ${vista === 'todos' ? 'chip-on' : ''}`} onClick={() => setVista('todos')}>
            Todos <span className="opacity-70">{productos?.length ?? 0}</span>
          </button>
          <button type="button" aria-pressed={vista === 'agotados'} className={`chip ${vista === 'agotados' ? 'chip-on' : ''}`} onClick={() => setVista('agotados')}>
            Agotados <span className="opacity-70">{agotados.length}</span>
          </button>
        </div>
        <ul className="mt-3 overflow-y-auto divide-y divide-[#ECE9E2] -mx-1 px-1">
          {productos === null && <li className="py-6 text-center text-sm text-gray-600">Cargando…</li>}
          {productos !== null && visibles.length === 0 && (
            <li className="py-6 text-center text-sm text-gray-600">{vista === 'agotados' ? 'No hay platillos agotados.' : 'Sin resultados.'}</li>
          )}
          {visibles.map((p) => {
            const agotado = p.disponible === false
            return (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold truncate ${agotado ? 'text-gray-500 line-through' : ''}`}>{p.name}</p>
                  <p className="text-xs text-gray-600 truncate">{p.category?.name ?? 'Sin categoría'}{agotado ? ' · Agotado' : ''}</p>
                </div>
                <button type="button" disabled={busyId === p.id} onClick={() => cambiar(p)}
                  className={`min-h-[40px] px-3 rounded-xl text-xs font-bold border-2 whitespace-nowrap disabled:opacity-50 ${agotado
                    ? 'border-[#22603C] text-[#22603C] hover:bg-green-50'
                    : 'border-red-300 text-red-700 hover:bg-red-50'}`}>
                  {busyId === p.id ? '…' : agotado ? 'Ya hay' : 'Se acabó'}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="flex justify-end mt-4"><button type="button" className="btn-secondary" onClick={onClose}>Listo</button></div>
      </div>
    </div>
  )
}
