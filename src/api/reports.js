import api from './axios'

/**
 * Obtiene el resumen de ventas (totales, número de ventas, etc.) en un rango de fechas.
 * @param {string} from Fecha inicial del rango (ej. 'YYYY-MM-DD').
 * @param {string} to Fecha final del rango (ej. 'YYYY-MM-DD').
 * @returns {Promise} Respuesta de axios con el resumen de ventas.
 */
export const getSalesSummary = (from, to) => api.get('/reports/sales-summary', { params: { from, to } })

/**
 * Obtiene los productos más vendidos en un rango de fechas.
 * @param {string} from Fecha inicial del rango.
 * @param {string} to Fecha final del rango.
 * @param {number} [limit=10] Cantidad máxima de productos a devolver.
 * @returns {Promise} Respuesta de axios con el ranking de productos más vendidos.
 */
export const getTopProducts = (from, to, limit = 10) => api.get('/reports/top-products', { params: { from, to, limit } })

/**
 * Obtiene el total de ventas agrupado por día dentro de un rango de fechas.
 * @param {string} from Fecha inicial del rango.
 * @param {string} to Fecha final del rango.
 * @returns {Promise} Respuesta de axios con las ventas totalizadas por día.
 */
export const getSalesByDay = (from, to) => api.get('/reports/sales-by-day', { params: { from, to } })

/**
 * Obtiene el estado actual del inventario (ej. existencias, productos con stock bajo).
 * @returns {Promise} Respuesta de axios con el estado del inventario.
 */
export const getInventoryStatus = () => api.get('/reports/inventory-status')
