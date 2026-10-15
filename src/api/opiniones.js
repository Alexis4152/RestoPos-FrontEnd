import api from './axios'

/** Pantalla "Opiniones": { desde, hasta (YYYY-MM-DD), estrellas? } → resumen + lista. */
export const getOpiniones = (params) => api.get('/opiniones', { params })
