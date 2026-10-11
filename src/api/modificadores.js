import api from './axios'

/** Lista los grupos de modificadores activos de un producto (con sus opciones anidadas). */
export const getModificadorGrupos = (productoId) => api.get(`/products/${productoId}/modificador-grupos`)

/** Grupos de otros productos de la misma categoría, para copiarlos a este producto. */
export const getModificadorGruposCopiables = (productoId) => api.get(`/products/${productoId}/modificador-grupos/copiables`)

/** Crea un grupo de modificadores (con sus opciones) para un producto. */
export const createModificadorGrupo = (productoId, data) => api.post(`/products/${productoId}/modificador-grupos`, data)

/** Guarda el orden de los grupos de un producto: ids de todos sus grupos activos, el primero arriba. */
export const reorderModificadorGrupos = (productoId, grupoIds) => api.put(`/products/${productoId}/modificador-grupos/orden`, grupoIds)

/** Actualiza un grupo de modificadores existente, reconciliando sus opciones (en el orden enviado). */
export const updateModificadorGrupo = (id, data) => api.put(`/modificador-grupos/${id}`, data)

/** Elimina (borrado suave) un grupo de modificadores. */
export const deleteModificadorGrupo = (id) => api.delete(`/modificador-grupos/${id}`)
