import api from './axios'

/**
 * Lista las tiendas visibles para el usuario en sesión: todas si es `SUPER_ADMIN` (o solo
 * las de un supervisor específico, pasando `supervisorId`), o solo las que tiene a su cargo
 * si es `SUPERVISOR`. Usado por la pantalla de selección/administración de tiendas.
 * @param {number|string} [supervisorId] Filtro opcional por supervisor a cargo (solo aplica para SUPER_ADMIN).
 * @returns {Promise} Respuesta de axios con el arreglo de tiendas.
 */
export const getTiendas = (supervisorId) => api.get('/tiendas', { params: { supervisorId: supervisorId || undefined } })

/**
 * Da de alta una tienda nueva. Disponible para `SUPER_ADMIN` (puede asignarle un
 * `supervisorId`) y `SUPERVISOR` (queda automáticamente a cargo de ella).
 * @param {{ name: string, supervisorId?: number|string }} data Datos de la tienda a crear.
 * @returns {Promise} Respuesta de axios con la tienda creada.
 */
export const createTienda = (data) => api.post('/tiendas', data)

/**
 * Actualiza el nombre (y, si el actor es `SUPER_ADMIN`, el supervisor a cargo) de una tienda.
 * @param {number|string} id Id de la tienda.
 * @param {{ name: string, supervisorId?: number|string }} data Nuevos datos de la tienda.
 * @returns {Promise} Respuesta de axios con la tienda actualizada.
 */
export const updateTienda = (id, data) => api.put(`/tiendas/${id}`, data)

/**
 * Desactiva (baja lógica) una tienda existente.
 * @param {number|string} id Id de la tienda.
 * @returns {Promise} Respuesta de axios confirmando la baja.
 */
export const deactivateTienda = (id) => api.delete(`/tiendas/${id}`)

/**
 * Actualiza el color primario de marca de una tienda. Tras un guardado exitoso,
 * el llamador típicamente usa `applyTiendaBrand` (ver `utils/theme.js`) y
 * `patchTienda` de `AuthContext` para reflejar el nuevo color sin recargar la app.
 * @param {number|string} id Id de la tienda.
 * @param {string} primaryColor Color primario en formato hex (ej. '#155dea').
 * @returns {Promise} Respuesta de axios con la tienda actualizada.
 */
export const updateTiendaTheme = (id, primaryColor) => api.put(`/tiendas/${id}/theme`, { primaryColor })

/**
 * Obtiene la información (datos fiscales, apariencia, etc.) de una tienda.
 * @param {number|string} id Id de la tienda.
 * @returns {Promise} Respuesta de axios con la información de la tienda.
 */
export const getTiendaInfo = (id) => api.get(`/tiendas/${id}/info`)

/**
 * Actualiza la información general de una tienda (ej. datos fiscales, nombre).
 * @param {number|string} id Id de la tienda.
 * @param {Object} data Datos a actualizar.
 * @returns {Promise} Respuesta de axios con la tienda actualizada.
 */
export const updateTiendaInfo = (id, data) => api.put(`/tiendas/${id}/info`, data)

/**
 * Sube/reemplaza el logo de una tienda. Arma un `FormData` con el archivo y lo
 * envía como `multipart/form-data`.
 * @param {number|string} id Id de la tienda.
 * @param {File} file Archivo de imagen del logo.
 * @returns {Promise} Respuesta de axios con la tienda/logo actualizado.
 */
export const uploadTiendaLogo = (id, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/tiendas/${id}/logo`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
}

/**
 * Elimina el logo actual de una tienda.
 * @param {number|string} id Id de la tienda.
 * @returns {Promise} Respuesta de axios confirmando la eliminación.
 */
export const removeTiendaLogo = (id) => api.delete(`/tiendas/${id}/logo`)

/** Guarda la configuración de la página web pública de la tienda (link, entregas, formas de pago). */
export const updateWebConfig = (id, data) => api.put(`/tiendas/${id}/web-config`, data)

/** Resumen en vivo de cada tienda al alcance (supervisor / super admin): mesas, pedidos por aceptar, ventas de hoy, corte. */
export const getTiendasResumen = () => api.get('/tiendas/resumen')
