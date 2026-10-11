import { useEffect, useRef } from 'react'
import api from '../api/axios'

/**
 * Avisos en tiempo real (Server-Sent Events) del backend — reemplazan las consultas cada 10 s.
 * El servidor avisa "cambió la orden X" (o "cambió una mesa") y cada pantalla vuelve a pedir
 * sus datos en ese momento. Ver LiveEventsService en el backend.
 *
 * Se usa fetch (y no EventSource) porque EventSource no deja mandar headers: el personal se
 * autentica con su JWT (Authorization) y el cliente de la página web con X-Cliente-Token.
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api'
const FALLBACK_MS = 60000 // respaldo por si la conexión se cae sin que el navegador lo note
const DEBOUNCE_MS = 300

/**
 * Abre un stream SSE con reconexión automática. `getHeaders` se llama en cada intento (así
 * siempre usa el token vigente). `onEvent({ name, data })` recibe cada evento, incluido
 * "conectado" (útil para recargar tras una reconexión: pudieron cambiar cosas mientras tanto).
 * `onAuthError` se llama ante 401/403 (devuelve true para reintentar). Regresa una función
 * para cerrar.
 */
export function openEventStream(url, { getHeaders = () => ({}), onEvent, onAuthError }) {
  let cerrado = false
  let controller = null
  let espera = 1000

  async function conectar() {
    if (cerrado) return
    controller = new AbortController()
    try {
      const res = await fetch(url, { headers: { Accept: 'text/event-stream', ...getHeaders() }, signal: controller.signal })
      if (res.status === 401 || res.status === 403 || res.status === 400) {
        const reintentar = onAuthError ? await onAuthError(res.status) : false
        if (!reintentar) return
        throw new Error('auth')
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      espera = 1000
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const bloque = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          let name = 'message'
          const data = []
          for (const linea of bloque.split('\n')) {
            if (linea.startsWith(':')) continue // comentario (latido)
            if (linea.startsWith('event:')) name = linea.slice(6).trim()
            else if (linea.startsWith('data:')) data.push(linea.slice(5).trim())
          }
          if (data.length > 0) {
            let parsed = null
            try { parsed = JSON.parse(data.join('\n')) } catch { parsed = data.join('\n') }
            onEvent({ name, data: parsed })
          }
        }
      }
    } catch {
      if (cerrado) return
    }
    if (cerrado) return
    // Se cortó (servidor reiniciado, red, timeout de 30 min): reintenta con espera creciente.
    setTimeout(conectar, espera)
    espera = Math.min(espera * 2, 30000)
  }

  conectar()
  return () => { cerrado = true; controller?.abort() }
}

// ── Canal del personal: UNA conexión por pestaña, compartida por todas las pantallas ──────

const listeners = new Set()
let cerrarStaff = null

function asegurarStaff() {
  if (cerrarStaff) return
  cerrarStaff = openEventStream(`${API_BASE}/events`, {
    getHeaders: () => {
      const token = localStorage.getItem('pos_token')
      const h = token ? { Authorization: `Bearer ${token}` } : {}
      try {
        const u = JSON.parse(localStorage.getItem('pos_user') || 'null')
        if (u && (u.role === 'SUPER_ADMIN' || u.role === 'SUPERVISOR') && u.tienda?.id) h['X-Acting-Tienda-Id'] = u.tienda.id
      } catch { /* sin usuario */ }
      return h
    },
    onEvent: (e) => listeners.forEach((fn) => fn(e)),
    // Token vencido: una llamada cualquiera por axios dispara su renovación transparente
    // (refresh token); si ya no hay sesión, axios manda a /login y aquí se deja de intentar.
    onAuthError: async () => {
      let reintentar = false
      if (localStorage.getItem('pos_token')) {
        try { await api.get('/auth/me'); reintentar = true } catch { reintentar = false }
      }
      // Sin sesión: se suelta la conexión para que la próxima pantalla que se suscriba (tras
      // volver a iniciar sesión) abra una nueva.
      if (!reintentar) cerrarStaff = null
      return reintentar
    },
  })
}

function suscribirStaff(fn) {
  listeners.add(fn)
  asegurarStaff()
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && cerrarStaff) { cerrarStaff(); cerrarStaff = null }
  }
}

/**
 * Hook para pantallas del personal: llama `recargar()` cada vez que el servidor avisa de un
 * cambio (agrupando avisos seguidos), al reconectar, y cada 60 s como respaldo.
 * `filtro(evento)` opcional para reaccionar solo a ciertos avisos (ej. una orden en particular).
 */
export function useLiveRefresh(recargar, { filtro, activo = true } = {}) {
  const recargarRef = useRef(recargar)
  recargarRef.current = recargar
  const filtroRef = useRef(filtro)
  filtroRef.current = filtro

  useEffect(() => {
    if (!activo) return
    let timer = null
    const programar = () => {
      clearTimeout(timer)
      timer = setTimeout(() => recargarRef.current(), DEBOUNCE_MS)
    }
    let primero = true
    const quitar = suscribirStaff((e) => {
      if (e.name === 'conectado') {
        if (!primero) programar() // reconexión: pudo haber cambios mientras no había conexión
        primero = false
        return
      }
      if (!filtroRef.current || filtroRef.current(e)) programar()
    })
    const respaldo = setInterval(() => recargarRef.current(), FALLBACK_MS)
    return () => { quitar(); clearInterval(respaldo); clearTimeout(timer) }
  }, [activo])
}

/**
 * Igual que useLiveRefresh pero para la página web pública: abre su propio stream (`url` +
 * `headers`), p. ej. el seguimiento de un pedido por su código o "Mis pedidos" del cliente.
 * `alFallarAuth` se llama si el servidor rechaza el acceso (sesión vencida, pedido inexistente).
 */
export function usePublicLiveRefresh(url, recargar, { headers, alFallarAuth } = {}) {
  const recargarRef = useRef(recargar)
  recargarRef.current = recargar
  const fallarRef = useRef(alFallarAuth)
  fallarRef.current = alFallarAuth
  const headersKey = JSON.stringify(headers || {})

  useEffect(() => {
    if (!url) return
    let timer = null
    const programar = () => { clearTimeout(timer); timer = setTimeout(() => recargarRef.current(), DEBOUNCE_MS) }
    let primero = true
    const cerrar = openEventStream(url, {
      getHeaders: () => JSON.parse(headersKey),
      onEvent: (e) => {
        if (e.name === 'conectado') { if (!primero) programar(); primero = false; return }
        programar()
      },
      onAuthError: async () => { fallarRef.current?.(); return false },
    })
    const respaldo = setInterval(() => recargarRef.current(), FALLBACK_MS)
    return () => { cerrar(); clearInterval(respaldo); clearTimeout(timer) }
  }, [url, headersKey])
}

/** URL base de la API pública de una tienda (para los streams de la página web). */
export const publicStreamBase = (slug) => `${API_BASE}/public/r/${encodeURIComponent(slug)}`
