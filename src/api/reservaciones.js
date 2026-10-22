import api from './axios'

/** Reservaciones de un día (fecha YYYY-MM-DD; sin fecha = hoy). */
export const getReservaciones = (fecha) => api.get('/reservaciones', { params: { fecha } })

/** Por confirmar, de hoy en adelante. */
export const getReservacionesPendientes = () => api.get('/reservaciones/pendientes')

/** Captura del personal (cliente que llamó): queda confirmada. */
export const createReservacion = (data) => api.post('/reservaciones', data)

/** Confirma (y opcionalmente asigna / cambia la mesa). */
export const confirmReservacion = (id, mesaId) => api.post(`/reservaciones/${id}/confirmar`, { mesaId: mesaId || null })

export const rejectReservacion = (id, motivo) => api.post(`/reservaciones/${id}/rechazar`, { motivo })

export const cancelReservacion = (id, motivo) => api.post(`/reservaciones/${id}/cancelar`, { motivo })

/** Marca que el grupo llegó (true, opcionalmente en la mesa `mesaId`) o que no llegó (false). */
export const markReservacionLlegada = (id, llego, mesaId) =>
  api.post(`/reservaciones/${id}/${llego ? 'llego' : 'no-llego'}`, llego && mesaId ? { mesaId } : undefined)

/** Reglas de la tienda: { todasLasMesas, cambiosHoras, llegadaMinutosAntes }. */
export const getReglasReservacion = () => api.get('/reservaciones/reglas')
