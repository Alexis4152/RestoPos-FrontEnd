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

/** Rechaza un pedido web que nadie ha aceptado (si ya lo aceptó alguien, el backend lo impide y lo dice). */
export const rejectWebOrder = (orderId, motivo) => api.post(`/orders/${orderId}/rechazar`, { motivo })

/** Acepta un pedido web: queda a nombre de quien lo acepta y pasa a cocina. Rechazar = rejectWebOrder. */
export const acceptWebOrder = (orderId) => api.post(`/orders/${orderId}/aceptar`)

/** Liga la orden a un cliente registrado de la página web (por correo o teléfono). */
export const linkOrderClient = (orderId, busqueda) => api.post(`/orders/${orderId}/cliente`, { busqueda })

/** Quita el cliente registrado de la orden. */
export const unlinkOrderClient = (orderId) => api.delete(`/orders/${orderId}/cliente`)

/** Opiniones de las cuentas de la orden: { [cuentaId]: opinión }. */
export const getOrderOpinions = (orderId) => api.get(`/orders/${orderId}/opiniones`)

/** Envío a domicilio: { estado, repartidor, tomadoAt, enCaminoAt, entregadoAt, eventos }. */
export const getOrderDelivery = (orderId) => api.get(`/orders/${orderId}/entrega`)

/** Mueve la orden de mesa a otra mesa libre. */
export const moveOrderTable = (orderId, mesaId) => api.post(`/orders/${orderId}/mover-mesa`, { mesaId })

/** Une otra mesa a la orden (libre, o con su propia orden que se fusiona en esta). */
export const joinOrderTable = (orderId, mesaId) => api.post(`/orders/${orderId}/unir-mesa`, { mesaId })

/** Separa (libera) una mesa que se había unido a la orden. */
export const splitOrderTable = (orderId, mesaId) => api.post(`/orders/${orderId}/separar-mesa`, { mesaId })

/** Avisos informativos para la campana: { reportes: [...], entregados: [...] }. */
export const getOrderNotices = () => api.get('/orders/avisos')
