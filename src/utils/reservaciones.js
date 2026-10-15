/**
 * Utilidades compartidas de reservaciones de mesa: las usan la página web (Reservaciones.jsx
 * del sitio) y la pantalla del personal (pages/Reservaciones.jsx).
 */

/** Ocasiones rápidas para elegir (se guarda el texto). */
export const OCASIONES = ['Cumpleaños', 'Aniversario', 'Reunión de trabajo', 'Celebración']
const OCASION_ICONO = { 'Cumpleaños': '🎂', 'Aniversario': '💍', 'Reunión de trabajo': '💼', 'Celebración': '🎉' }
export const iconoOcasion = (o) => OCASION_ICONO[o] ?? '✨'

/** Etiqueta y estilo de cada estado, para el cliente y para el personal. */
export const ESTADO_RESERVA = {
  PENDIENTE: { cliente: '⏳ Por confirmar', staff: 'Por confirmar', cls: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  CONFIRMADA: { cliente: '✅ Confirmada', staff: 'Confirmada', cls: 'bg-green-100 text-green-800 border-green-300' },
  RECHAZADA: { cliente: '❌ No disponible', staff: 'Rechazada', cls: 'bg-red-100 text-red-800 border-red-300' },
  CANCELADA: { cliente: 'Cancelada', staff: 'Cancelada', cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  LLEGO: { cliente: '🍽️ Visita realizada', staff: 'Llegó', cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  NO_LLEGO: { cliente: 'No asististe', staff: 'No llegó', cls: 'bg-gray-100 text-gray-600 border-gray-300' },
}

/** Necesidades especiales de una reservación como "chips" ({ icono, texto }). */
export function necesidades(r) {
  const out = []
  if (r.accesible) out.push({ icono: '♿', texto: 'Mesa accesible (silla de ruedas / movilidad reducida)', corto: 'Accesible' })
  if (r.periqueras > 0) out.push({ icono: '🪑', texto: `${r.periqueras} periquera${r.periqueras === 1 ? '' : 's'}`, corto: `${r.periqueras} periquera${r.periqueras === 1 ? '' : 's'}` })
  if (r.carriola) out.push({ icono: '👶', texto: 'Llevan carriola', corto: 'Carriola' })
  if (r.ocasion) out.push({ icono: iconoOcasion(r.ocasion), texto: r.ocasion, corto: r.ocasion })
  return out
}

/** "sábado 18 de octubre" */
export const fechaLarga = (iso) => new Date(iso).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
/** "20:00" */
export const horaCorta = (iso) => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })

/** Fecha local YYYY-MM-DD (sin pasar por UTC, que en la noche daría el día siguiente). */
export function ymd(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function sumarDias(fechaYmd, dias) {
  const [y, m, d] = fechaYmd.split('-').map(Number)
  return ymd(new Date(y, m - 1, d + dias))
}

/**
 * Horarios reservables de un día cada 30 min, entre horaInicio y horaFin (o 08:00–22:00 si la
 * tienda no configuró horario), sin los que ya no cumplen la anticipación mínima.
 */
export function horariosDelDia(fechaYmd, { horaInicio, horaFin, anticipacionHoras = 0 }) {
  const aMin = (h, def) => {
    if (!h) return def
    const [hh, mm] = h.split(':').map(Number)
    return hh * 60 + mm
  }
  const inicio = aMin(horaInicio, 8 * 60)
  const fin = aMin(horaFin, 22 * 60)
  const limite = Date.now() + anticipacionHoras * 3600 * 1000
  const [y, m, d] = fechaYmd.split('-').map(Number)
  const out = []
  // Arranca en la primera media hora exacta a partir del inicio.
  for (let t = Math.ceil(inicio / 30) * 30; t <= fin; t += 30) {
    const fecha = new Date(y, m - 1, d, Math.floor(t / 60), t % 60)
    if (fecha.getTime() >= limite) out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
  }
  return out
}
