import api from './axios'

/**
 * Órdenes activas para la pantalla de Cocina (ni pagadas ni canceladas), más antiguas
 * primero, con sus productos ya sin cancelados y ordenados por cuándo se pidieron.
 * @param {number|string} [mesaId] Filtro opcional por mesa; sin él, incluye todas (para llevar incluido).
 * @returns {Promise} Respuesta de axios con la lista de órdenes activas.
 */
export const getKitchenOrders = (mesaId) => api.get('/kitchen/orders', { params: { mesaId: mesaId || undefined } })

/** Lo que cocina ya entregó HOY (aunque la orden ya se haya cobrado), lo más reciente primero. */
export const getKitchenDeliveredToday = () => api.get('/kitchen/delivered-today')
