import api from './axios'

/** Registra un pago sobre una cuenta (uno por método, para armar un pago mixto). */
export const createPayment = (accountId, data) => api.post(`/accounts/${accountId}/payments`, data)

/** Cancela un pago ya registrado (solo con su corte abierto y la orden sin cerrar). */
export const cancelPayment = (id, motivo) => api.post(`/payments/${id}/cancel`, { motivo })

/** Corrige el método de un pago mal capturado (solo con su corte abierto). */
export const correctPaymentMethod = (id, data) => api.post(`/payments/${id}/metodo`, data)

/** Devuelve dinero de un pago que ya no se puede cancelar: `{ monto, motivo }`. */
export const refundPayment = (id, data) => api.post(`/payments/${id}/devolver`, data)

/** Transferencias por confirmar contra el banco. */
export const getTransfersToVerify = () => api.get('/payments/por-verificar')

/** Confirma una transferencia. `resultado`: 'VERIFICADA' o 'NO_RECIBIDA'. */
export const verifyTransfer = (id, resultado) => api.post(`/payments/${id}/verificar`, null, { params: { resultado } })

/**
 * Llave de un intento de cobro: se manda igual si la petición se repite (doble toque, reintento
 * por mala red) y el backend no crea otro pago. `crypto.randomUUID` solo existe en https o
 * localhost; en la red local (http://192.168...) se arma una con fecha y azar.
 */
export const nuevaLlavePago = () => globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
