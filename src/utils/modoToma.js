import { useSyncExternalStore } from 'react'
import { useAuth } from '../context/AuthContext'

/**
 * Modo de toma de orden: 'RAPIDO' (Mis mesas, menú directo, opciones sugeridas, entregar y
 * cobrar en un paso) o 'DETALLADO' (plano de mesas y orden completa, como siempre).
 * El admin fija el de la tienda en "Datos de la tienda" (Tienda.modoToma); cada mesero puede
 * cambiarlo en SU dispositivo (localStorage) sin afectar a los demás. Los dos modos trabajan
 * sobre las mismas órdenes: se puede pasar de uno a otro en cualquier momento.
 */
const CLAVE = 'restopos-modo-toma'
const VALIDOS = ['RAPIDO', 'DETALLADO']

function leer() {
  try {
    const v = localStorage.getItem(CLAVE)
    return VALIDOS.includes(v) ? v : null
  } catch { return null }
}

let preferencia = leer()
const oyentes = new Set()
const avisar = () => oyentes.forEach((fn) => fn())
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === CLAVE) { preferencia = leer(); avisar() } })
}
const suscribir = (fn) => { oyentes.add(fn); return () => oyentes.delete(fn) }

/** Cambia el modo en este dispositivo; null = volver al de la tienda. */
export function setModoToma(modo) {
  preferencia = VALIDOS.includes(modo) ? modo : null
  try {
    if (preferencia) localStorage.setItem(CLAVE, preferencia)
    else localStorage.removeItem(CLAVE)
  } catch { /* sin almacenamiento: dura lo que la pestaña */ }
  avisar()
}

/** { modo, rapido, deTienda, propio, setModo }: el modo vigente y de dónde viene. */
export function useModoToma() {
  const { user } = useAuth()
  const propio = useSyncExternalStore(suscribir, () => preferencia)
  const deTienda = VALIDOS.includes(user?.tienda?.modoToma) ? user.tienda.modoToma : 'DETALLADO'
  const modo = propio ?? deTienda
  return { modo, rapido: modo === 'RAPIDO', deTienda, propio, setModo: setModoToma }
}
