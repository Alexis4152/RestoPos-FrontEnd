import api from './axios'

/**
 * Faltantes de la tienda (dinero que una persona debe cubrir porque faltó en una entrega
 * de caja). Solo administradores/supervisores.
 * @param {{paid?: boolean, page?: number, size?: number}} params `paid=false` (default):
 *        pendientes y con abonos; `paid=true`: pagados.
 */
export const getShortages = (params) => api.get('/shortages', { params })

/** Total que falta por cubrir en la tienda. */
export const getPendingShortageTotal = () => api.get('/shortages/pending-total')

/** Pagos/abonos de un faltante. */
export const getShortagePayments = (id) => api.get(`/shortages/${id}/payments`)

/**
 * Registra un pago total o un abono a un faltante.
 * @param {number} id Id del faltante.
 * @param {Object} data `{amount, method: 'CASH_REGISTER'|'TRANSFER'|'EXTERNAL_CASH'|'PAYROLL', cashCutId, reference, receiptPath}`
 *        — con `CASH_REGISTER` el efectivo entra a la caja del corte abierto `cashCutId`.
 */
export const payShortage = (id, data) => api.post(`/shortages/${id}/payments`, data)
