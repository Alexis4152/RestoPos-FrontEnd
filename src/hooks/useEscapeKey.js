import { useEffect, useRef } from 'react'

/**
 * Cierra con la tecla Escape lo que esté abierto (modal, drawer, diálogo de confirmación).
 * Reemplaza el useEffect con addEventListener que cada pantalla repetía a mano (y que, al
 * armarse a mano, dejaba modales sin cerrar con Escape — hallazgo de la auditoría de código).
 *
 * Lleva una PILA: si hay varias cosas abiertas a la vez (ej. el diálogo de confirmación encima
 * de un modal), Escape solo cierra la que se abrió al último, no todas de golpe.
 *
 * @param {(e: KeyboardEvent) => void} onEscape qué hacer al presionar Escape (siempre se usa la
 *   versión más reciente, no hace falta memorizarla)
 * @param {boolean} [activo=true] si está abierto en este momento; mientras sea false no escucha
 */
export function useEscapeKey(onEscape, activo = true) {
  const ref = useRef(onEscape)
  ref.current = onEscape

  useEffect(() => {
    if (!activo) return undefined
    instalarListener()
    pila.push(ref)
    return () => {
      const i = pila.lastIndexOf(ref)
      if (i >= 0) pila.splice(i, 1)
    }
  }, [activo])
}

const pila = []
let instalado = false

function instalarListener() {
  if (instalado) return
  instalado = true
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || pila.length === 0) return
    pila[pila.length - 1].current(e)
  })
}
