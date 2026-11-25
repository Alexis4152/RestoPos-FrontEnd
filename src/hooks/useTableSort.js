import { useState } from 'react'

/**
 * Orden de una tabla paginada en el servidor: qué columna y en qué dirección. Clic en un
 * encabezado: ▲ ascendente → ▼ descendente → vuelve al orden por defecto de la tabla. Se
 * recuerda por tabla en este navegador (`storageKey`).
 *
 * El backend solo acepta las claves de su lista blanca (ver SortParams); cualquier otra
 * cae al orden por defecto, así que las claves de aquí deben coincidir con las de allá.
 *
 * @param {string} storageKey Clave única de la tabla (ej. 'sort:sales').
 * @returns {{ sort: {key: string, dir: 'asc'|'desc'}|null, toggle: (key: string) => void,
 *             params: {sort?: string, dir?: string} }} `params` va tal cual en la petición.
 */
export default function useTableSort(storageKey) {
  const [sort, setSort] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey))
      return saved?.key && (saved.dir === 'asc' || saved.dir === 'desc') ? saved : null
    } catch {
      return null
    }
  })

  function toggle(key) {
    setSort((prev) => {
      const next = prev?.key !== key ? { key, dir: 'asc' } : prev.dir === 'asc' ? { key, dir: 'desc' } : null
      try {
        if (next) localStorage.setItem(storageKey, JSON.stringify(next))
        else localStorage.removeItem(storageKey)
      } catch { /* sin storage: solo no se recuerda */ }
      return next
    })
  }

  return { sort, toggle, params: sort ? { sort: sort.key, dir: sort.dir } : {} }
}
