import api from './axios'

/** Lista las mesas de la tienda del usuario. */
export const getTables = () => api.get('/tables')

/** Obtiene el detalle de una mesa por id. */
export const getTable = (id) => api.get(`/tables/${id}`)

/** Crea una mesa nueva. */
export const createTable = (data) => api.post('/tables', data)
/** Alta de varias mesas y/o zonas de un golpe: `{ grupos: [{ zonaId | zonaNombre, cantidad, desde, prefijo?, capacidad? }] }`. */
export const createTablesBulk = (data) => api.post('/tables/bulk', data)

/** Actualiza número/capacidad/estado de una mesa. */
export const updateTable = (id, data) => api.put(`/tables/${id}`, data)

/** Desactiva (da de baja) una mesa. */
export const deleteTable = (id) => api.delete(`/tables/${id}`)

/** Qué mesas se pueden reservar (las que no vengan en la lista quedan sin reservar). */
export const setMesasReservables = (mesaIds) => api.put('/tables/reservables', { mesaIds })
