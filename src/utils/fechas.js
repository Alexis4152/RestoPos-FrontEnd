/** Fecha local (no UTC) como 'YYYY-MM-DD', el formato de un <input type="date">. */
export function fechaInput(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Rango { from, to } de los últimos `dias` días contando hoy, listo para filtros de fecha.
 * Las listas largas (Ventas, Órdenes) abren con este rango en vez de toda la historia.
 */
export function ultimosDias(dias) {
  const desde = new Date()
  desde.setDate(desde.getDate() - (dias - 1))
  return { from: fechaInput(desde), to: fechaInput() }
}
