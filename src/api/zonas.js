import api from './axios'

/** Lista las zonas activas de la tienda del usuario en sesión. */
export const getZonas = () => api.get('/zonas')

/** Crea una zona nueva (ej. "Zona principal", "Terraza"). Sin límite de cantidad. */
export const createZona = (data) => api.post('/zonas', data)

/** Actualiza el nombre de una zona existente. */
export const updateZona = (id, data) => api.put(`/zonas/${id}`, data)

/** Elimina (borrado suave) una zona. */
export const deleteZona = (id) => api.delete(`/zonas/${id}`)
