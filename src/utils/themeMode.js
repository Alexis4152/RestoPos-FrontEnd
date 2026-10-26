import { useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { setBrandDark } from './theme'

/**
 * Modo de pantalla (claro / oscuro / automático) del punto de venta. Es una preferencia de
 * ESTE dispositivo (cada mesero elige el suyo), guardada en localStorage; "automático" sigue
 * el modo del sistema operativo. Se aplica como la clase `dark` en <html>: los colores
 * oscuros salen de src/styles/dark.css (generado) y de la rampa de marca oscura (theme.js).
 * El sitio público de la tienda y las opiniones se ven en claro para los clientes; el
 * repartidor (que trabaja desde la página web) sí usa su modo, ver usarModoEnPaginaWeb.
 */
const CLAVE = 'restopos-modo'
export const MODOS = [
  { key: 'light', label: 'Claro' },
  { key: 'dark', label: 'Oscuro' },
  { key: 'system', label: 'Automático' },
]

function leer() {
  try {
    const v = localStorage.getItem(CLAVE)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch { return 'system' }
}

let modo = leer()
const oyentes = new Set()
const avisar = () => oyentes.forEach((fn) => fn())
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
media?.addEventListener?.('change', avisar)
// Otra pestaña cambió el modo: se refleja aquí también.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === CLAVE) { modo = leer(); avisar() } })
}

function suscribir(fn) { oyentes.add(fn); return () => oyentes.delete(fn) }
const sistemaOscuro = () => !!media?.matches

/** Cambia la preferencia de este dispositivo ('light' | 'dark' | 'system'). */
export function setModo(nuevo) {
  modo = nuevo
  try {
    if (nuevo === 'system') localStorage.removeItem(CLAVE)
    else localStorage.setItem(CLAVE, nuevo)
  } catch { /* sin almacenamiento: dura lo que la pestaña */ }
  avisar()
}

/** { modo, oscuro, setModo }: la preferencia y si en este momento se ve en oscuro. */
export function useModo() {
  const actual = useSyncExternalStore(suscribir, () => modo)
  const sis = useSyncExternalStore(suscribir, sistemaOscuro)
  return { modo: actual, oscuro: actual === 'dark' || (actual === 'system' && sis), setModo }
}

const esPublica = (path) => path.startsWith('/sitio/')

// La página web la puede "prestar" al modo del dispositivo (p. ej. cuando entra un repartidor).
let publicaConModo = false
const publicaConModoActual = () => publicaConModo

/** La página web usa el modo claro/oscuro del dispositivo mientras `activo` sea true. */
export function usarModoEnPaginaWeb(activo) {
  useEffect(() => {
    publicaConModo = !!activo
    avisar()
    return () => { publicaConModo = false; avisar() }
  }, [activo])
}

/** Aplica el modo a <html> según la ruta (va una vez, dentro del Router). */
export function ModoSync() {
  const { oscuro } = useModo()
  const { pathname } = useLocation()
  const prestada = useSyncExternalStore(suscribir, publicaConModoActual)
  const activo = oscuro && (!esPublica(pathname) || prestada)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', activo)
    document.documentElement.style.colorScheme = activo ? 'dark' : 'light'
    setBrandDark(activo)
  }, [activo])
  return null
}
