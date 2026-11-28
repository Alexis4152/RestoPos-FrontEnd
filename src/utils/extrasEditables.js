import { useSyncExternalStore } from 'react'
import { cambiarPrecioExtra as apiPrecio, agregarExtra as apiAgregar } from '../api/modificadores'

/**
 * Grupos de Extras (ModificadorGrupo.esExtras): al tomar la orden se puede cambiar el precio de
 * un extra o agregar uno nuevo. Ambos se guardan en el servidor al momento; aquí se recuerdan en
 * esta sesión para que se vean de inmediato aunque el platillo venga de una lista cargada antes.
 */
const precios = new Map() // opcionId -> precioExtra
const nuevas = new Map() // grupoId -> [opción]
let version = 0
const oyentes = new Set()
const avisar = () => { version += 1; oyentes.forEach((fn) => fn()) }
const suscribir = (fn) => { oyentes.add(fn); return () => oyentes.delete(fn) }

/** Vuelve a pintar el componente cuando cambia un precio o se agrega un extra. */
export function useExtrasEditables() {
  return useSyncExternalStore(suscribir, () => version)
}

/** Los grupos con los precios cambiados y los extras agregados en esta sesión. */
export function conAjustes(grupos) {
  return (grupos ?? []).map((g) => {
    const extra = (nuevas.get(g.id) ?? []).filter((n) => !(g.opciones ?? []).some((o) => o.id === n.id))
    return {
      ...g,
      opciones: [...(g.opciones ?? []), ...extra].map((o) => (precios.has(o.id) ? { ...o, precioExtra: precios.get(o.id) } : o)),
    }
  })
}

/** Guarda el precio nuevo de un extra (sin confirmación). */
export async function guardarPrecioExtra(opcionId, precio) {
  const r = await apiPrecio(opcionId, precio)
  precios.set(opcionId, Number(r.data.data?.precioExtra ?? precio))
  avisar()
}

/** Agrega un extra al grupo y lo devuelve (para dejarlo elegido). */
export async function guardarNuevoExtra(grupoId, nombre, precio) {
  const r = await apiAgregar(grupoId, { nombre, precioExtra: precio })
  const op = r.data.data
  nuevas.set(grupoId, [...(nuevas.get(grupoId) ?? []).filter((o) => o.id !== op.id), op])
  precios.set(op.id, Number(op.precioExtra))
  avisar()
  return op
}
