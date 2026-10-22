import api from './axios'

/** Envíos a domicilio pendientes de entregar (sección DELIVERY). */
export const getDeliveries = () => api.get('/deliveries')

/** Banco, titular y CLABE de la tienda, para el cliente que paga por transferencia. */
export const getDeliveryTransferInfo = () => api.get('/deliveries/transfer-info')

/** El repartidor toma el pedido (el cliente lo ve "En camino"). */
export const takeDelivery = (id) => api.post(`/deliveries/${id}/tomar`)

/** Suelta un pedido que había tomado. */
// motivo obligatorio: lo ve la caja en la campana y queda en el historial del envío.
export const releaseDelivery = (id, motivo) => api.post(`/deliveries/${id}/soltar`, { motivo })

/** Entrega el pedido y, si falta, lo cobra: { metodo: 'CASH'|'TRANSFER', recibido?, referencia? }. */
export const deliverOrder = (id, data) => api.post(`/deliveries/${id}/entregar`, data)

/** "Voy en camino": solo cuando el restaurante ya le entregó el pedido; desde aquí el cliente lo ve "En camino". */
export const startDelivery = (id) => api.post(`/deliveries/${id}/en-camino`)

/** Historial del repartidor (sus entregas). params: { desde, hasta } en YYYY-MM-DD; sin params, últimos 7 días. */
export const getDeliveryHistory = (params) => api.get('/deliveries/historial', { params })

/** Caja: envíos entregados cuyo dinero todavía trae el repartidor. */
export const getDeliveriesPorRecibir = () => api.get('/deliveries/por-recibir')

/** Caja: recibe del repartidor el dinero de un envío (se cobra en el corte de quien recibe). */
export const recibirDineroEntrega = (id) => api.post(`/deliveries/${id}/recibir`)
