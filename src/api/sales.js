import api from './axios'

/**
 * Lista paginada de ventas, agrupadas por orden (una orden puede cobrarse con una mezcla de
 * cuentas Total/Por comensal/Personalizada — ver `VentaResumen` del backend), con filtros
 * combinables por rango de fecha, estado agregado y método de pago, acotada a la tienda del
 * usuario en sesión (o a todas, si es `SUPER_ADMIN` sin tienda elegida).
 * @param {{ from?: string, to?: string, estado?: string, metodo?: string, page?: number, size?: number }} params Filtros y paginación.
 * @returns {Promise} Respuesta de axios con `{ content, page, size, totalElements, totalPages }`.
 */
export const getSales = (params) => api.get('/sales', { params })

/**
 * Obtiene el detalle de una venta (orden) por el id de la orden: el desglose de todas sus
 * cuentas, con productos, pagos y totales de cada una.
 * @param {number|string} ordenId Id de la orden.
 * @returns {Promise} Respuesta de axios con el resumen de la venta.
 */
export const getSale = (ordenId) => api.get(`/sales/${ordenId}`)
