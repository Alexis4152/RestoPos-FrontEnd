import api from './axios'

/**
 * Inicia sesión contra el backend.
 * @param {{ username: string, password: string }} data Credenciales del usuario.
 * @returns {Promise} Respuesta de axios; `data.data` trae el usuario autenticado y su JWT.
 */
export const login = (data) => api.post('/auth/login', data)

/**
 * Obtiene los datos frescos del usuario actualmente autenticado (según el JWT enviado).
 * `AuthContext` la usa al recargar la sesión guardada, para reflejar cambios recientes
 * de permisos (rol/sections) o de la tienda (ej. color de marca) hechos desde el último login.
 * @returns {Promise} Respuesta de axios con los datos actuales del usuario.
 */
export const me = () => api.get('/auth/me')

/**
 * Canjea el refresh token de la cookie httpOnly por un access token nuevo. Normalmente no
 * hace falta llamarla a mano — el interceptor de `api/axios.js` ya la dispara sola cuando
 * cualquier petición falla con 401 por access token vencido.
 * @returns {Promise} Respuesta de axios; `data.data.token` trae el JWT nuevo.
 */
export const refresh = () => api.post('/auth/refresh')

/**
 * Cierra la sesión: revoca el refresh token actual del lado servidor (además de que
 * `AuthContext#logout` limpia el estado local). Idempotente — no falla aunque ya no
 * hubiera sesión activa.
 * @returns {Promise} Respuesta de axios confirmando el cierre de sesión.
 */
export const logout = () => api.post('/auth/logout')

/**
 * Cambia la contraseña del usuario ya autenticado (exige la actual como comprobante de
 * identidad). Es lo que usa la pantalla obligatoria de "cambia tu contraseña" cuando un
 * admin dio de alta al usuario (o le reseteó la contraseña) con una temporal.
 * @param {string} currentPassword Contraseña actual (o la temporal recibida por correo).
 * @param {string} newPassword Nueva contraseña elegida.
 * @returns {Promise} Respuesta de axios confirmando el cambio.
 */
export const changePassword = (currentPassword, newPassword) =>
  api.post('/auth/change-password', { currentPassword, newPassword })

/**
 * Inicia el flujo de "olvidé mi contraseña" (pública, sin sesión). El backend siempre
 * responde el mismo mensaje genérico, exista o no ese correo — nunca revela si un correo
 * está registrado.
 * @param {string} email Correo capturado en el formulario.
 * @returns {Promise} Respuesta de axios con el mensaje genérico a mostrar.
 */
export const forgotPassword = (email) => api.post('/auth/forgot-password', { email })

/**
 * Completa el flujo de "olvidé mi contraseña" con el token recibido por correo (pública,
 * sin sesión — quien la llama todavía no puede autenticarse).
 * @param {string} token Token del link, tomado del query string `?token=...`.
 * @param {string} newPassword Nueva contraseña elegida.
 * @returns {Promise} Respuesta de axios confirmando el cambio.
 */
export const resetPassword = (token, newPassword) => api.post('/auth/reset-password', { token, newPassword })

/**
 * Revisa si el token del link de recuperación sigue vigente, sin usarlo (pública). Falla con
 * 400 y el mensaje a mostrar si el link ya venció o ya se usó.
 * @param {string} token Token del link, tomado del query string `?token=...`.
 * @returns {Promise} Respuesta de axios.
 */
export const validateResetToken = (token) => api.get('/auth/reset-password/validate', { params: { token } })
