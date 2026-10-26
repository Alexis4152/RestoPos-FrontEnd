import api from './axios'

/** Pantalla "Opiniones": { desde, hasta (YYYY-MM-DD), estrellas? } → resumen + lista. */
export const getOpiniones = (params) => api.get('/opiniones', { params })

/** QR (imagen) y enlace a las opiniones de la tienda en su página web. */
export const getQrOpinionesPublicas = () => api.get('/opiniones/qr-publico')
