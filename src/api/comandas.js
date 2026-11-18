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
