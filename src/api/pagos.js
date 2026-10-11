import api from './axios'

/** Registra un pago sobre una cuenta (uno por método, para armar un pago mixto). */
export const createPayment = (accountId, data) => api.post(`/accounts/${accountId}/payments`, data)

/** Cancela un pago ya registrado (solo si la orden aún no quedó cerrada). */
export const cancelPayment = (id, motivo) => api.post(`/payments/${id}/cancel`, { motivo })
