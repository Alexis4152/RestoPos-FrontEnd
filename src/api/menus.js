import api from './axios'

// Menús con nombre y "el menú de hoy" (ver MenuDelDia.jsx). Mientras haya menú de hoy, solo
// sus platillos se pueden ordenar (POS y página web); sin él se vende todo el catálogo.

/** Menús de la tienda: [{ id, nombre, hoy, productoIds, updatedAt }]. */
export const getMenus = () => api.get('/menus')

/** @param {{ nombre: string, productoIds: number[] }} data */
export const createMenu = (data) => api.post('/menus', data)

/** Reemplaza nombre y platillos. @param {{ nombre: string, productoIds: number[] }} data */
export const updateMenu = (id, data) => api.put(`/menus/${id}`, data)

export const deleteMenu = (id) => api.delete(`/menus/${id}`)

/** Lo vuelve el menú de hoy. */
export const usarMenuHoy = (id) => api.post(`/menus/${id}/hoy`)

/** Sin menú de hoy: se vende todo el catálogo. */
export const quitarMenuHoy = () => api.delete('/menus/hoy')
