import api from './axios'

/** Genera una cuenta a cobrar de una orden (tipo TOTAL, POR_COMENSAL o PERSONALIZADA). */
export const createAccount = (orderId, data) => api.post(`/orders/${orderId}/accounts`, data)

/** Lista las cuentas generadas de una orden. */
export const getAccountsByOrder = (orderId) => api.get(`/orders/${orderId}/accounts`)

/** Obtiene el detalle de una cuenta (productos, pagos, saldo). */
export const getAccount = (id) => api.get(`/accounts/${id}`)

/** Cancela una cuenta pendiente (libera sus productos de vuelta a la orden). */
export const cancelAccount = (id, motivo) => api.post(`/accounts/${id}/cancel`, { motivo })

/**
 * Descarga el PDF del ticket de una cuenta como blob (el endpoint requiere el Bearer token,
 * por eso no se puede simplemente abrir la URL en una pestaña/`<a href>`).
 */
export const getTicketPdf = (id) => api.get(`/accounts/${id}/ticket`, { responseType: 'blob' })

/** Envía el ticket de una cuenta por correo. */
export const emailTicket = (id, email) => api.post(`/accounts/${id}/ticket/email`, { email })

/**
 * Ticket de una cuenta en formato ESC/POS (cadena hexadecimal), listo para mandarse tal cual
 * a la impresora térmica vía QZ Tray (ver utils/printer.js).
 */
export const getAccountTicketEscPos = (id) => api.get(`/accounts/${id}/ticket-escpos`)
