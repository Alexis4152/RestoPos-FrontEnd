import api from './axios'

/**
 * Lista los roles (de la tienda del usuario). Cada rol trae el conjunto de `AppSection`
 * habilitadas que determina qué módulos pueden ver/usar los usuarios con ese rol.
 * @returns {Promise} Respuesta de axios con el listado de roles.
 */
export const getRoles = () => api.get('/roles')

/**
 * Obtiene el detalle de un rol por id, incluyendo sus secciones habilitadas.
 * @param {number|string} id Id del rol.
 * @returns {Promise} Respuesta de axios con el rol solicitado.
 */
export const getRole = (id) => api.get(`/roles/${id}`)

/**
 * Crea un nuevo rol.
 * @param {Object} data Datos del rol (ej. nombre, lista de códigos de `AppSection`).
 * @returns {Promise} Respuesta de axios con el rol creado.
 */
export const createRole = (data) => api.post('/roles', data)

/**
 * Actualiza un rol existente (ej. sus secciones/permisos habilitados).
 * @param {number|string} id Id del rol.
 * @param {Object} data Datos a actualizar.
 * @returns {Promise} Respuesta de axios con el rol actualizado.
 */
export const updateRole = (id, data) => api.put(`/roles/${id}`, data)

/**
 * Elimina un rol.
 * @param {number|string} id Id del rol a eliminar.
 * @returns {Promise} Respuesta de axios confirmando la eliminación.
 */
export const deleteRole = (id) => api.delete(`/roles/${id}`)
