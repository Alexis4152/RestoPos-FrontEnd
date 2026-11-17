import api from './axios'

/**
 * Obtiene la configuración SMTP global (la cuenta con la que sale TODO correo del sistema:
 * tickets, cortes, contraseñas, clientes de la página web, reservaciones). Exclusivo de
 * SUPER_ADMIN — nunca incluye la contraseña real, solo `passwordConfigured`.
 * @returns {Promise} Respuesta de axios con la configuración vigente.
 */
export const getMailConfig = () => api.get('/admin/mail-config')

/**
 * Actualiza la configuración SMTP global. Si `smtpPassword` se omite o va vacío, el backend
 * conserva la contraseña ya guardada.
 * @param {{enabled: boolean, smtpHost: string, smtpPort: number, smtpUsername: string, smtpPassword?: string}} data
 * @returns {Promise} Respuesta de axios con la configuración ya guardada.
 */
export const updateMailConfig = (data) => api.put('/admin/mail-config', data)
