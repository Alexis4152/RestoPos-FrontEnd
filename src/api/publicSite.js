import axios from 'axios'

/**
 * Cliente de la API pública de la página web de una tienda (`/api/public/r/{slug}`).
 * Instancia de axios APARTE de `api/axios.js` a propósito: aquí no hay sesión, así que no
 * debe adjuntar el JWT del personal (si alguien del staff abre el sitio en su navegador) ni
 * redirigir a /login ante un error.
 */
const publicApi = axios.create({ baseURL: `${import.meta.env.VITE_API_URL || '/api'}/public/r` })

const base = (slug) => `/${encodeURIComponent(slug)}`

/** Datos de la tienda y opciones habilitadas (entregas, formas de pago, mesas). */
export const getPublicTienda = (slug) => publicApi.get(base(slug))

/** Menú pedible ahora mismo, por categoría. */
export const getPublicMenu = (slug) => publicApi.get(`${base(slug)}/menu`)

/** Mesas por zona con su estado (LIBRE/OCUPADA/RESERVADA). */
export const getPublicMesas = (slug) => publicApi.get(`${base(slug)}/mesas`)

/** Header con la sesión del cliente registrado (si la hay). */
const clienteHeaders = (token) => (token ? { headers: { 'X-Cliente-Token': token } } : {})

/** Crea un pedido para recoger o a domicilio; con `clienteToken` queda en el historial del cliente. */
// `idemKey`: llave única por intento de envío; si el mismo envío llega dos veces (doble clic,
// red lenta) el backend devuelve el pedido ya creado en vez de duplicarlo.
export const createPublicPedido = (slug, data, clienteToken, idemKey) => publicApi.post(`${base(slug)}/pedidos`, data, {
  headers: { ...(clienteToken ? { 'X-Cliente-Token': clienteToken } : {}), ...(idemKey ? { 'Idempotency-Key': idemKey } : {}) },
})

/** Estado de un pedido por su código de seguimiento (el que regresa el backend al crearlo). */
export const getPublicPedido = (slug, token) =>
  publicApi.get(`${base(slug)}/seguimiento/${encodeURIComponent(token)}`)

// ── Cuentas de cliente ───────────────────────────────────────────────────────────

/** Registro: { nombre, telefono, direccion, email, password } → { token, cliente }. */
export const registerCliente = (slug, data) => publicApi.post(`${base(slug)}/clientes/registro`, data)

/** Login de cliente → { token, cliente }, o data null si ese correo no es de ningún cliente. */
export const loginCliente = (slug, data) => publicApi.post(`${base(slug)}/clientes/login`, data)

export const logoutCliente = (slug, token) => publicApi.post(`${base(slug)}/clientes/logout`, null, clienteHeaders(token))

export const getClienteMe = (slug, token) => publicApi.get(`${base(slug)}/clientes/me`, clienteHeaders(token))

export const updateClienteMe = (slug, token, data) => publicApi.put(`${base(slug)}/clientes/me`, data, clienteHeaders(token))

/**
 * "Mis pedidos": los en curso + los terminados (sin fechas, los últimos 10; con `desde`/`hasta`
 * en formato YYYY-MM-DD, todos los de ese rango).
 */
export const getClientePedidos = (slug, token, { desde, hasta } = {}) =>
  publicApi.get(`${base(slug)}/clientes/me/pedidos`, { ...clienteHeaders(token), params: { desde: desde || undefined, hasta: hasta || undefined } })

/** Califica un pedido entregado: { estrellas: 1-5, comentario? }. */
export const reviewClientePedido = (slug, token, id, data) =>
  publicApi.post(`${base(slug)}/clientes/me/pedidos/${id}/resena`, data, clienteHeaders(token))

/** Reporte de cómo llegó el pedido (24 h tras la entrega): { tipo: 'BIEN'|'MAL'|'FALTANTE', productoIds?, comentario? }. */
export const reportClientePedido = (slug, token, id, data) =>
  publicApi.post(`${base(slug)}/clientes/me/pedidos/${id}/reporte`, data, clienteHeaders(token))

// ── Correo del cliente: confirmación y recuperación de contraseña ─────────────────────

/** Confirma el correo con el código del enlace (?verificar=...). */
export const verificarCorreoCliente = (slug, token) => publicApi.post(`${base(slug)}/clientes/verificar`, { token })

/** Vuelve a mandar el correo de confirmación al cliente de la sesión. */
export const reenviarVerificacionCliente = (slug, token) => publicApi.post(`${base(slug)}/clientes/me/reenviar-verificacion`, null, clienteHeaders(token))

/** "¿Olvidaste tu contraseña?" — responde igual exista o no la cuenta. */
export const olvideContrasenaCliente = (slug, email) => publicApi.post(`${base(slug)}/clientes/olvide`, { email })

/** Nueva contraseña con el código del enlace (?restablecer=...). */
export const restablecerContrasenaCliente = (slug, token, password) => publicApi.post(`${base(slug)}/clientes/restablecer`, { token, password })
