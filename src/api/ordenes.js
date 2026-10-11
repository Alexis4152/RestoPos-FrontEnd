import api from './axios'

/** Lista/busca órdenes con filtros opcionales (fecha, estado) y paginación. */
export const getOrders = (params) => api.get('/orders', { params })

/** Obtiene el detalle de una orden (comensales, productos, totales). */
export const getOrder = (id) => api.get(`/orders/${id}`)

/** Abre una orden nueva sobre una mesa (o para llevar si no se manda mesaId). */
export const openOrder = (data) => api.post('/orders', data)

/** Órdenes para llevar (sin mesa) activas — ni pagadas ni canceladas —, más antiguas primero. */
export const getTakeawayOrders = () => api.get('/orders/takeaway')

/** Agrega un comensal a una orden. */
export const addDiner = (orderId, data) => api.post(`/orders/${orderId}/diners`, data)

/** Elimina un comensal de la orden — solo si todavía no tiene ningún producto asociado. */
export const deleteDiner = (orderId, comensalId) => api.delete(`/orders/${orderId}/diners/${comensalId}`)

/** Agrega un producto a la orden. */
export const addOrderItem = (orderId, data) => api.post(`/orders/${orderId}/items`, data)

/** Actualiza el estado de preparación de una línea de la orden. */
export const updateOrderItemStatus = (orderId, itemId, estado) =>
  api.patch(`/orders/${orderId}/items/${itemId}/estado`, null, { params: { estado } })

/** Cancela una línea de la orden (solo si aún no se incluyó en ninguna cuenta). */
export const cancelOrderItem = (orderId, itemId, motivo) =>
  api.delete(`/orders/${orderId}/items/${itemId}`, { data: { motivo } })

/** Cancela la orden completa (solo si todavía no tiene pagos registrados). */
export const cancelOrder = (orderId, motivo) => api.post(`/orders/${orderId}/cancel`, { motivo })

/** Edita una línea ya agregada: comensal, cantidad, notas y (opcional) modificadores. */
export const updateOrderItem = (orderId, itemId, data) => api.put(`/orders/${orderId}/items/${itemId}`, data)

/** Platos por recoger del mesero autenticado (productos de sus órdenes ya "Entregado a mesero" por cocina). */
export const getPickups = () => api.get('/orders/pickups')

/** Costo de envío a domicilio configurado por el admin (null = la tienda no cobra envío). */
export const getDeliveryFee = () => api.get('/orders/delivery-fee')

/** Pedidos de la página web todavía sin aceptar ni rechazar. */
export const getWebPendingOrders = () => api.get('/orders/web-pending')

/** Acepta un pedido web: queda a nombre de quien lo acepta y pasa a cocina. Rechazar = cancelOrder con motivo. */
export const acceptWebOrder = (orderId) => api.post(`/orders/${orderId}/aceptar`)
