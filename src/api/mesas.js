import api from './axios'

/** Lista las mesas de la tienda del usuario. */
export const getTables = () => api.get('/tables')

/** Obtiene el detalle de una mesa por id. */
export const getTable = (id) => api.get(`/tables/${id}`)

/** Crea una mesa nueva. */
export const createTable = (data) => api.post('/tables', data)

/** Actualiza número/capacidad/estado de una mesa. */
export const updateTable = (id, data) => api.put(`/tables/${id}`, data)

/** Desactiva (da de baja) una mesa. */
export const deleteTable = (id) => api.delete(`/tables/${id}`)
