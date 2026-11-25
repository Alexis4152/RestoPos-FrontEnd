/**
 * Encabezado de tabla ordenable (ver `useTableSort`). Muestra ▲/▼ en la columna activa y
 * ↕ tenue en las demás ordenables, para que se note que se puede dar clic.
 *
 * @param {{ label: string, sortKey: string, sort: {key: string, dir: string}|null,
 *           onSort: (key: string) => void, className?: string, align?: 'left'|'right'|'center' }} props
 */
export default function SortableTh({ label, sortKey, sort, onSort, className = '', align = 'left' }) {
  const active = sort?.key === sortKey
  const arrow = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
  return (
    <th className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 w-full ${justify} select-none hover:text-gray-900 ${active ? 'text-gray-900' : ''}`}
        title="Ordenar"
      >
        {label}
        <span className={`text-[10px] ${active ? 'text-purple-600' : 'text-gray-300'}`}>{arrow}</span>
      </button>
    </th>
  )
}
