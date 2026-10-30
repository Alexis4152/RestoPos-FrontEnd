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

/**
 * Catálogo de reportes de la pantalla "Reportes" (título, grupo, filtros que acepta cada
 * uno) — alimenta el menú lateral de `Reports.jsx`. Las funciones de arriba (un endpoint fijo
 * por consulta) siguen siendo las del Dashboard.
 * @returns {Promise} Respuesta de axios con la lista de reportes disponibles.
 */
export const getReportCatalog = () => api.get('/reports/catalog')

/**
 * Genera uno de los reportes del catálogo (ver {@link getReportCatalog}).
 * @param {string} type Tipo del reporte (ej. `'cuentas'`, `'ingresos'`).
 * @param {Object} params `{ from, to, status, method, movementType, servicio }` — cada reporte
 *        usa solo los filtros que declara.
 * @returns {Promise} Respuesta de axios con el reporte (indicadores, gráficas y tabla).
 */
export const getReportItem = (type, params) => api.get(`/reports/${type}`, { params })

/**
 * Exporta uno de los reportes del catálogo a CSV, Excel o PDF (`responseType: 'blob'`).
 * @param {string} type Tipo del reporte.
 * @param {string} format `'csv' | 'xlsx' | 'pdf'`.
 * @param {Object} params Mismos filtros que {@link getReportItem}.
 * @returns {Promise} Respuesta de axios con el archivo como blob.
 */
export const exportReportItem = (type, format, params) =>
  api.get(`/reports/${type}/export`, { params: { ...params, format }, responseType: 'blob' })
