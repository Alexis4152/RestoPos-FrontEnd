import { useState } from 'react'

export const PAGE_SIZES = [10, 20, 50, 100]

/**
 * Pie de tabla paginada: "Mostrar N por página · X–Y de Z" y Anterior/Siguiente.
 * `page` es base 0; `count` es cuántos registros trae la página actual.
 */
export default function Pagination({ page, size, totalElements, totalPages, count, onPageChange, onSizeChange }) {
  const from = totalElements === 0 ? 0 : page * size + 1
  const to = Math.min(totalElements, page * size + count)
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 text-sm">
      <div className="flex items-center gap-2 text-gray-500">
        <span>Mostrar</span>
        <select className="input !w-auto py-1" aria-label="Registros por página" value={size} onChange={(e) => onSizeChange(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span>por página · {totalElements === 0 ? 'sin resultados' : `${from}–${to} de ${totalElements}`}</span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary py-1 px-3 text-xs disabled:opacity-40" disabled={page === 0} onClick={() => onPageChange(Math.max(0, page - 1))}>‹ Anterior</button>
        <span className="text-gray-500 text-xs">Página {totalPages === 0 ? 0 : page + 1} de {totalPages}</span>
        <button type="button" className="btn-secondary py-1 px-3 text-xs disabled:opacity-40" disabled={page + 1 >= totalPages} onClick={() => onPageChange(page + 1)}>Siguiente ›</button>
      </div>
    </div>
  )
}

/**
 * Paginación en pantalla de una lista ya cargada completa (listas cortas como Roles o
 * Categorías). Si la lista se achica (p. ej. al desactivar), se queda en la última página válida.
 */
export function useClientPage(list, initialSize = 20) {
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(initialSize)
  const totalElements = list.length
  const totalPages = Math.ceil(totalElements / size)
  const safePage = Math.min(page, Math.max(totalPages - 1, 0))
  const items = list.slice(safePage * size, (safePage + 1) * size)
  return {
    items,
    props: {
      page: safePage, size, totalElements, totalPages, count: items.length,
      onPageChange: setPage, onSizeChange: (n) => { setSize(n); setPage(0) },
    },
  }
}
