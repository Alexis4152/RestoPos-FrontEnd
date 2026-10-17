import api from './axios'

/**
 * Cajas de la tienda con su estado: en uso (`openCut`, con su efectivo esperado) o cerrada
 * (`pending`: lo que dejó el último corte, los movimientos con la caja cerrada y el monto
 * que recibirá quien la abra). Si la tienda no tiene cajas, el backend crea "Caja 1".
 * @returns {Promise} Respuesta de axios con la lista de cajas.
 */
export const getCashRegisters = () => api.get('/cash-registers')

/** Da de alta una caja (admin). @param {{name: string}} data */
export const createCashRegister = (data) => api.post('/cash-registers', data)

/** Renombra o activa/desactiva una caja (admin). @param {{name: string, isActive?: boolean}} data */
export const updateCashRegister = (id, data) => api.put(`/cash-registers/${id}`, data)

/**
 * Retiro o entrada de efectivo con la caja cerrada (admin).
 * @param {number} id Id de la caja.
 * @param {Object} data `{type: 'WITHDRAWAL'|'FLOAT', amount, destination, personId, reference, concept, countedRemaining}`
 */
export const addClosedRegisterMovement = (id, data) => api.post(`/cash-registers/${id}/movements`, data)

/** Personal de la tienda para los selects de quién puso/retiró/pagó dinero. */
export const getCashPeople = () => api.get('/cash-registers/people')

/** Reabre una caja que ya hizo su corte de fin de día (solo admin/supervisor). */
export const reopenCashRegisterDay = (id) => api.post(`/cash-registers/${id}/reopen-day`)

/** Destinatarios del reporte de fin de día de la tienda (y la lista efectiva). */
export const getReportRecipients = () => api.get('/cash-registers/report-recipients')

/**
 * Configura los destinatarios del reporte de fin de día (solo SUPERVISOR o SUPER_ADMIN).
 * @param {{reportToSupervisor: boolean, userIds: number[], emails: string[]}} data
 */
export const updateReportRecipients = (data) => api.put('/cash-registers/report-recipients', data)

/** "Últimas entregas de caja" (admin), paginadas. */
export const getHandovers = (params) => api.get('/cash-registers/handovers', { params })

/** Cuántas entregas tienen diferencia sin resolver (admin). */
export const getUnresolvedHandoverCount = () => api.get('/cash-registers/handovers/unresolved-count')

/**
 * Resuelve la diferencia de una entrega (admin).
 * @param {number} cutId Id del corte que recibió la caja.
 * @param {Object} data `{resolution: 'UNREGISTERED_WITHDRAWAL'|'SHORTAGE'|'COUNT_ERROR', note, amount, occurredAt, personId, destination}`
 */
export const resolveHandover = (cutId, data) => api.post(`/cash-registers/handovers/${cutId}/resolve`, data)
