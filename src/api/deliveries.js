import api from './axios'

/** Envíos a domicilio pendientes de entregar (sección DELIVERY). */
export const getDeliveries = () => api.get('/deliveries')

/** Banco, titular y CLABE de la tienda, para el cliente que paga por transferencia. */
export const getDeliveryTransferInfo = () => api.get('/deliveries/transfer-info')

/** El repartidor toma el pedido (el cliente lo ve "En camino"). */
export const takeDelivery = (id) => api.post(`/deliveries/${id}/tomar`)

/** Suelta un pedido que había tomado. */
export const releaseDelivery = (id) => api.post(`/deliveries/${id}/soltar`)

/** Entrega el pedido y, si falta, lo cobra: { metodo: 'CASH'|'TRANSFER', recibido?, referencia? }. */
export const deliverOrder = (id, data) => api.post(`/deliveries/${id}/entregar`, data)

/** "Voy en camino": solo cuando el restaurante ya le entregó el pedido; desde aquí el cliente lo ve "En camino". */
export const startDelivery = (id) => api.post(`/deliveries/${id}/en-camino`)
