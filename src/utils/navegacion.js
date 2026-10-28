import { useNavigate } from 'react-router-dom'

/**
 * "Regresar" a la pantalla de donde vino el usuario (Órdenes, Mesas, Para llevar, Ventas, un
 * aviso de la campana…), no a una fija. Si no hay pantalla anterior dentro de la app (entró
 * directo por un enlace o recargó en una pestaña nueva), va a `respaldo` (se pasa al llamarla).
 *
 * react-router guarda en history.state.idx cuántas pantallas lleva la pestaña: 0 = es la primera.
 */
export function useVolver() {
  const navigate = useNavigate()
  return (respaldo) => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1)
    else navigate(respaldo, { replace: true })
  }
}
