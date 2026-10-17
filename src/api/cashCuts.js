import api from './axios'

/**
 * Lista los cortes de caja (de la tienda del usuario, o de todas si es SUPER_ADMIN),
 * opcionalmente filtrados/paginados.
 * @param {Object} [params] Query params de filtro/paginación (ej. rango de fechas, cajero).
 * @returns {Promise} Respuesta de axios con el listado de cortes de caja.
 */
export const getCashCuts = (params) => api.get('/cash-cuts', { params })

/**
 * Cajeros distintos con al menos un corte de caja en la tienda del usuario — para poblar
 * el filtro "Cajero" del historial, sin depender de la sección Usuarios.
 * @returns {Promise} Respuesta de axios con `[{id, name}]`.
 */
export const getCashCutCashiers = () => api.get('/cash-cuts/cashiers')

/**
 * Obtiene el corte de caja abierto actualmente (puede haber varios cajeros con
 * corte abierto a la vez en la misma tienda; este endpoint resuelve el del contexto actual).
 * @returns {Promise} Respuesta de axios con el corte abierto.
 */
export const getOpenCashCut = () => api.get('/cash-cuts/open')

/**
 * Obtiene el corte de caja de HOY perteneciente al usuario (cajero) autenticado.
 * @returns {Promise} Respuesta de axios con el corte del día del usuario actual.
 */
export const getMyTodayCashCut = () => api.get('/cash-cuts/mine/today')

/**
 * Obtiene el detalle de un corte de caja por id.
 * @param {number|string} id Id del corte de caja.
 * @returns {Promise} Respuesta de axios con el corte solicitado.
 */
export const getCashCut = (id) => api.get(`/cash-cuts/${id}`)

/**
 * Obtiene el resumen (totales, ventas incluidas, etc.) de un corte de caja.
 * @param {number|string} id Id del corte de caja.
 * @returns {Promise} Respuesta de axios con el resumen del corte.
 */
export const getCashCutSummary = (id) => api.get(`/cash-cuts/${id}/summary`)

/**
 * Abre un corte recibiendo una caja: el fondo inicial es lo que el cajero contó.
 * @param {{cashRegisterId: number, countedAmount: number, note?: string, agreed: boolean}} data
 *        `note` es obligatoria si lo contado no coincide con lo que debía recibir.
 * @returns {Promise} Respuesta de axios con el corte recién abierto.
 */
export const openCashCut = (data) => api.post('/cash-cuts/open', data)

/**
 * Cierra un corte con arqueo: lo contado queda en la caja para el siguiente turno.
 * @param {number|string} id Id del corte de caja a cerrar.
 * @param {{countedAmount: number, notes?: string}} data `notes` obligatoria si no cuadra.
 * @returns {Promise} Respuesta de axios con el corte ya cerrado.
 */
export const closeCashCut = (id, data) => api.post(`/cash-cuts/${id}/close`, data)

/**
 * Corte de fin de día: el mismo cierre con arqueo que un traspaso, pero además envía el
 * reporte del día de esa caja a los destinatarios de la tienda y bloquea la caja hasta el
 * cierre programado (o el día siguiente).
 * @param {number|string} id Id del corte.
 * @param {{countedAmount: number, notes?: string, largeDifferenceConfirmed?: boolean}} data
 */
export const endOfDayCashCut = (id, data) => api.post(`/cash-cuts/${id}/end-of-day`, data)

/**
 * Cierre forzado por un administrador (ADMIN/SUPERVISOR/SUPER_ADMIN).
 * @param {number|string} id Id del corte.
 * @param {{countMethod: 'ADMIN_IN_PERSON'|'REMOTE_REPORTED'|'NOT_COUNTED', countedAmount?: number,
 *          reportedById?: number, evidencePath?: string, reason: string}} data
 */
export const forceCloseCashCut = (id, data) => api.post(`/cash-cuts/${id}/force-close`, data)

/**
 * Resuelve la diferencia del arqueo de cierre de un corte (admin).
 * @param {number|string} id Id del corte.
 * @param {{resolution: 'SHORTAGE'|'SURPLUS'|'COUNT_ERROR', note: string, responsibleId?: number}} data
 *        `responsibleId` (quien cubre el faltante) solo para `SHORTAGE`.
 */
export const resolveCountDifference = (id, data) => api.post(`/cash-cuts/${id}/resolve-count`, data)

/** Cuántos cortes tienen una diferencia de arqueo sin resolver (admin). */
export const getUnresolvedCountDifferenceCount = () => api.get('/cash-cuts/count-differences/unresolved-count')

/** Movimientos de efectivo (gastos, retiros, aportes...) de un corte. */
export const getCashCutMovements = (id) => api.get(`/cash-cuts/${id}/movements`)

/** Movimientos con la caja cerrada que un corte vio al recibir la caja. */
export const getCashCutReceivedMovements = (id) => api.get(`/cash-cuts/${id}/received-movements`)

/**
 * Registra un movimiento en un corte abierto.
 * @param {number|string} id Id del corte.
 * @param {Object} data `{type, amount, concept, personId, destination, reference, receiptPath, reimbursementId}`
 *        — `type`: EXPENSE | WITHDRAWAL | REIMBURSEMENT | CONTRIBUTION | FLOAT.
 */
export const addCashCutMovement = (id, data) => api.post(`/cash-cuts/${id}/movements`, data)

/**
 * Sube la foto de un comprobante; responde con su ruta para mandarla en el movimiento/pago.
 * @param {File} file Imagen PNG, JPG o WEBP de máximo 5 MB.
 */
export const uploadCashReceipt = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/cash-cuts/receipts', form, { headers: { 'Content-Type': 'multipart/form-data' } })
}

/** Horario global del cierre automático de cortes ({ closeHour, closeMinute, enabled }). Solo SUPER_ADMIN. */
export const getCashCutSchedule = () => api.get('/cash-cuts/schedule')

/** Actualiza el horario global del cierre automático de cortes. Solo SUPER_ADMIN. */
export const updateCashCutSchedule = (data) => api.put('/cash-cuts/schedule', data)
