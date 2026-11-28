import api from './axios'

/**
 * Cola de comandas por imprimir. El mesero registra lo que acaba de mandar de una orden; la
 * estación de impresión (computadora con QZ Tray) consulta las pendientes, toma cada una
 * (recibe su ticket ESC/POS y a qué impresora va) y la imprime. Ver PrintStation.
 */
export const crearComanda = (ordenId, detalleIds) => api.post(`/orders/${ordenId}/comandas`, { detalleIds })
export const getComandasPendientes = () => api.get('/comandas/pendientes')
export const tomarComanda = (id) => api.post(`/comandas/${id}/tomar`)
export const liberarComanda = (id) => api.post(`/comandas/${id}/liberar`)

/** Envios a cocina de una orden (para elegir cual reimprimir). */
export const getEnviosComanda = (ordenId) => api.get(`/orders/${ordenId}/comandas`)

/** Reimprime en cocina un envio (comandaId) o toda la orden (comandaId null). */
export const reimprimirComanda = (ordenId, comandaId) =>
  api.post(`/orders/${ordenId}/comandas/reimprimir`, comandaId ? { comandaId } : {})
