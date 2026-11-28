import { useEffect, useState } from 'react'
import { getMeseros } from '../api/ordenes'
import { useAuth } from '../context/AuthContext'

let cache = null // meseros de la tienda (se piden una vez por sesión de página)

/** Meseros activos de la tienda; [] mientras cargan o si no hay. */
export function useMeseros() {
  const [lista, setLista] = useState(cache ?? [])
  useEffect(() => {
    if (cache) return
    getMeseros().then((r) => { cache = r.data.data ?? []; setLista(cache) }).catch(() => setLista([]))
  }, [])
  return lista
}

/**
 * "¿A nombre de qué mesero?" al abrir una mesa o un pedido. Solo aparece si quien abre NO es mesero
 * (cajero, admin...) y la tienda tiene meseros. Vacío = queda a nombre de quien la abre.
 *
 * `value` id del mesero o '' · `onChange(id | '')` · `etiqueta` texto de arriba.
 */
export default function SelectorMesero({ value, onChange, etiqueta = '¿A nombre de qué mesero?', id = 'selector-mesero' }) {
  const { user, isMesero } = useAuth()
  const meseros = useMeseros()
  if (isMesero || meseros.length === 0) return null
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-semibold text-gray-600 mb-1.5">{etiqueta}</label>
      <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
        <option value="">A mi nombre{user?.name ? ` (${user.name})` : ''}</option>
        {meseros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </div>
  )
}
