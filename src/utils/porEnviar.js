/**
 * "Por enviar a cocina" de una orden: lo que el mesero ya eligió pero todavía no manda. Es UN
 * solo borrador por orden, compartido por la vista detallada (OrderDetail) y la rápida
 * (OrdenRapida): lo que se deja pendiente en una aparece en la otra al cambiar de modo. Se
 * guarda en este dispositivo (localStorage).
 *
 * Línea: { productoId, nombre, precio, cantidad, comensalId, opcionIds, resumen, nota }.
 * La nota se lee con los dos nombres que usan las vistas (`observaciones` en la detallada,
 * `nota` en la rápida); al guardar, cada vista dice cuál de los dos es el suyo.
 */
const clave = (id) => `restopos-por-enviar-${id}`
const claveVieja = (id) => `restopos-comanda-${id}` // borrador anterior del modo rápido (sessionStorage)

function normalizar(l) {
  const nota = l.nota ?? l.observaciones ?? ''
  return { ...l, nota, observaciones: nota, opcionIds: l.opcionIds ?? [], resumen: l.resumen ?? '', comensalId: l.comensalId ?? null }
}

export function leerPorEnviar(id) {
  let lineas = []
  try { lineas = JSON.parse(localStorage.getItem(clave(id)) || '[]') } catch { lineas = [] }
  // Lo que hubiera quedado en el borrador viejo del modo rápido se junta (una sola vez).
  try {
    const viejo = JSON.parse(sessionStorage.getItem(claveVieja(id)) || '[]')
    if (Array.isArray(viejo) && viejo.length) {
      lineas = [...lineas, ...viejo]
      sessionStorage.removeItem(claveVieja(id))
      localStorage.setItem(clave(id), JSON.stringify(lineas.map(normalizar)))
    }
  } catch { /* sin almacenamiento */ }
  return Array.isArray(lineas) ? lineas.map(normalizar) : []
}

/** Guarda el borrador. `campoNota`: el nombre que usa la vista que guarda ('observaciones' | 'nota'). */
export function guardarPorEnviar(id, lineas, campoNota) {
  try {
    if (!lineas.length) { localStorage.removeItem(clave(id)); return }
    const limpias = lineas.map((l) => {
      const { nota: _n, observaciones: _o, ...resto } = l
      return { ...resto, nota: l[campoNota] ?? '' }
    })
    localStorage.setItem(clave(id), JSON.stringify(limpias))
  } catch { /* sin almacenamiento: dura lo que la pantalla */ }
}
