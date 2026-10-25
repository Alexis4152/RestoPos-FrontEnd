import axios from 'axios'

/**
 * Instancia central de axios usada por todos los módulos de `src/api/*.js`.
 *
 * En desarrollo (sin `VITE_API_URL` definida) usa `/api`, ruta relativa que se apoya en
 * el proxy de Vite hacia el backend Spring Boot en `localhost`. En producción, el front
 * se despliega como sitio estático separado del backend (dominios/contenedores distintos),
 * así que `/api` ya no resolvería a ningún lado — ahí se usa `VITE_API_URL` (variable de
 * entorno inyectada en build time) apuntando a la URL pública real del backend.
 */
/**
 * `withCredentials: true` es necesario para el refresh token: el backend lo entrega como
 * cookie httpOnly (`restopos_refresh_token`, ver `AuthController`), invisible a este JS a
 * propósito (mitiga robo vía XSS) — sin este flag el navegador ni la manda ni la guarda,
 * tanto en dev (proxy) como sobre todo en producción (dominios cruzados).
 */
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', withCredentials: true })

/**
 * Interceptor de request: adjunta el JWT de la sesión activa a cada petición saliente.
 *
 * Lee el token guardado en `localStorage.pos_token` (colocado ahí por `AuthContext`
 * tras el login) y, si existe, lo agrega como header `Authorization: Bearer <token>`.
 * Así ningún módulo de `api/*.js` necesita preocuparse por la autenticación:
 * basta con importar esta instancia `api` para que las peticiones ya vayan autenticadas.
 */
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pos_token')
  if (token) config.headers.Authorization = `Bearer ${token}`

  // Un SUPER_ADMIN/SUPERVISOR (usuario de plataforma, sin tienda propia) manda en qué tienda
  // eligió actuar (ver AuthContext.selectTienda / pages/SelectTienda.jsx) para que el backend
  // lo trate como el ADMIN de esa tienda al leer/escribir (ver TenantScope en el backend).
  try {
    const stored = localStorage.getItem('pos_user')
    const user = stored ? JSON.parse(stored) : null
    if (user && (user.role === 'SUPER_ADMIN' || user.role === 'SUPERVISOR') && user.tienda?.id) {
      config.headers['X-Acting-Tienda-Id'] = user.tienda.id
    }
  } catch { /* localStorage corrupto o inaccesible: se ignora, la petición sigue sin el header */ }

  return config
})

/** Promesa compartida del refresh en curso (o `null` si no hay uno en vuelo) — el
 *  mecanismo "single-flight" de abajo. */
let refreshPromise = null
/** Evita disparar el redirect a `/login` más de una vez si varias peticiones en
 *  paralelo terminan fallando a la vez tras un refresh fallido. */
let loggedOut = false

/** Limpia la sesión guardada y redirige a `/login`, una sola vez por ciclo de vida de
 *  la página aunque lo llamen varias peticiones fallidas casi al mismo tiempo. */
function clearSessionAndRedirect() {
  if (loggedOut) return
  loggedOut = true
  localStorage.removeItem('pos_token')
  localStorage.removeItem('pos_user')
  window.location.href = '/login'
}

/**
 * Interceptor de response: maneja de forma centralizada la expiración del access token.
 *
 * Si el backend responde 401 por un access token vencido, intenta renovarlo de forma
 * transparente contra `POST /auth/refresh` (que usa el refresh token de la cookie httpOnly,
 * ver `AuthController`) y reintenta la petición original con el token nuevo — el usuario no
 * nota nada, ninguna pantalla queda vacía.
 *
 * Ese refresh es "single-flight": si varias peticiones fallan con 401 casi al mismo tiempo
 * (p. ej. una pantalla disparando varias llamadas en paralelo al montar), todas esperan la
 * MISMA promesa de refresh en vez de disparar cada una la suya — esto es lo que corta de
 * raíz la cascada de 401 que antes tumbaba toda la sesión por el fallo de una sola petición
 * secundaria.
 *
 * Se excluye `/auth/login` (un 401 ahí es "credenciales inválidas", no "sesión expirada") y
 * `/auth/refresh` (su propio 401 ya significa que ni refrescando hay sesión válida — lo
 * maneja el `.catch` de más abajo, sin volver a intentar un refresh del refresh).
 */
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || ''
    const isLoginRequest = url.includes('/auth/login')
    const isRefreshRequest = url.includes('/auth/refresh') || url.includes('/auth/logout')
    const status = err.response?.status

    if (status !== 401 || isLoginRequest || isRefreshRequest) {
      return Promise.reject(err)
    }

    // La petición ya se reintentó una vez con un token "renovado" y sigue en 401: no hay
    // nada más que hacer más que cerrar la sesión, evita un loop infinito de reintentos.
    if (err.config._retriedAfterRefresh) {
      clearSessionAndRedirect()
      return Promise.reject(err)
    }

    if (!refreshPromise) {
      refreshPromise = api.post('/auth/refresh')
        .then((res) => {
          const newToken = res.data.data.token
          localStorage.setItem('pos_token', newToken)
          return newToken
        })
        .catch((refreshErr) => {
          clearSessionAndRedirect()
          throw refreshErr
        })
        .finally(() => {
          refreshPromise = null
        })
    }

    return refreshPromise.then((newToken) => {
      err.config._retriedAfterRefresh = true
      err.config.headers.Authorization = `Bearer ${newToken}`
      return api(err.config)
    })
  }
)

export default api
