import api from './axios'

/**
 * Reembolsos de la tienda (dinero que se le debe a quien puso efectivo de su bolsa).
 * @param {{status?: 'PENDING'|'PAID', page?: number, size?: number}} params
 */
export const getReimbursements = (params) => api.get('/reimbursements', { params })

/** Total pendiente de pagar en la tienda. */
export const getPendingReimbursementTotal = () => api.get('/reimbursements/pending-total')

/**
 * Paga un reembolso completo (admin).
 * @param {number} id Id del reembolso.
 * @param {Object} data `{source: 'CASH_CUT', cashCutId}` o
 *        `{source: 'EXTERNAL', method: 'TRANSFER'|'EXTERNAL_CASH', paidById, reference, receiptPath}`
 */
export const payReimbursement = (id, data) => api.post(`/reimbursements/${id}/pay`, data)
