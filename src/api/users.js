import api from './axios'

/**
 * Lista los usuarios (de la tienda del usuario, o de todas si es SUPER_ADMIN),
 * opcionalmente filtrados/paginados.
 * @param {Object} [params] Query params de filtro/paginación.
 * @returns {Promise} Respuesta de axios con el listado de usuarios.
 */
export const getUsers = (params) => api.get('/users', { params })

/**
 * Obtiene el detalle de un usuario por id.
 * @param {number|string} id Id del usuario.
 * @returns {Promise} Respuesta de axios con el usuario solicitado.
 */
export const getUser = (id) => api.get(`/users/${id}`)

/**
 * Crea un nuevo usuario (ej. cajero/vendedor/admin de una tienda).
 * @param {Object} data Datos del usuario (username, password, rol, tienda, etc.).
 * @returns {Promise} Respuesta de axios con el usuario creado.
 */
export const createUser = (data) => api.post('/users', data)

/**
 * Actualiza un usuario existente.
 * @param {number|string} id Id del usuario.
 * @param {Object} data Datos a actualizar.
 * @returns {Promise} Respuesta de axios con el usuario actualizado.
 */
export const updateUser = (id, data) => api.put(`/users/${id}`, data)

/**
 * Elimina un usuario.
 * @param {number|string} id Id del usuario a eliminar.
 * @returns {Promise} Respuesta de axios confirmando la eliminación.
 */
export const deleteUser = (id) => api.delete(`/users/${id}`)
