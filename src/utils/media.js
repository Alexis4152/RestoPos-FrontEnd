/**
 * Origen del backend (sin el sufijo "/api"), derivado de la misma `VITE_API_URL` que usa
 * `api/axios.js`. En dev esa variable no está definida y el front corre bajo el proxy de
 * Vite (ver `vite.config.js`, que también proxea `/uploads` a `localhost:8081`), así que
 * una cadena vacía basta — las rutas relativas resuelven solas contra el propio origen.
 * En producción el front es un sitio estático en un dominio distinto al del backend, así
 * que una ruta relativa como "/uploads/…" resolvería contra el dominio del FRONT (que no
 * sirve esos archivos) en vez del backend — de ahí la necesidad de anteponer este origen.
 */
const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '')

/**
 * Resuelve una ruta de archivo servida por el backend (logo de tienda, foto de producto —
 * ej. `"/uploads/products/xxx.jpg"`, ver `Product.imageUrl`/`Tienda.logoPath`) a una URL que
 * el navegador pueda cargar sin importar en qué dominio esté corriendo el frontend.
 *
 * Si ya viene absoluta (empieza con "http"), se regresa tal cual. `null`/`undefined`/
 * cadena vacía también se regresan tal cual — el caller decide el fallback (ej. un logo
 * por default).
 *
 * @param {string|null|undefined} path Ruta relativa que manda el backend, o ya absoluta.
 * @returns {string|null|undefined} URL lista para usar en un `src`.
 */
export function resolveMediaUrl(path) {
  if (!path || /^https?:\/\//.test(path)) return path
  return API_ORIGIN + path
}
