import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getComandasPendientes, tomarComanda, liberarComanda } from '../api/comandas'
import { isPrintStation, getKitchenPrinterName, sendRaw } from '../utils/printer'

const CADA_MS = 4000

// Estado compartido de la estación ({ activa, error, impresas }): PrintStation lo actualiza y
// EstadoEstacion lo muestra donde se cobra — así no hace falta una pastilla flotante encima
// del menú (tapaba el perfil y "Cerrar sesión").
let estado = { activa: false, error: '', impresas: 0 }
const oyentes = new Set()
function publicar(patch) {
  estado = { ...estado, ...patch }
  oyentes.forEach((fn) => fn())
}
const suscribir = (fn) => { oyentes.add(fn); return () => oyentes.delete(fn) }
const leer = () => estado

/**
 * Estación de impresión de comandas. Corre en segundo plano (montada en Layout, sin nada
 * visible) SOLO en la computadora marcada como estación (Configuración → Impresoras),
 * normalmente la de caja con QZ Tray: cada pocos segundos revisa si hay comandas nuevas de su
 * tienda, toma cada una (el backend garantiza que dos estaciones nunca impriman la misma) y la
 * imprime — en la impresora de cocina si la tienda tiene "Enviar a cocina", o en la de tickets
 * si no. Si falla, la devuelve a la cola para reintentar. Su estado se ve en EstadoEstacion.
 */
export default function PrintStation() {
  const { user } = useAuth()
  const [activa, setActiva] = useState(isPrintStation())
  const ocupado = useRef(false)

  useEffect(() => {
    const onCambio = () => setActiva(isPrintStation())
    window.addEventListener('pos-print-station', onCambio)
    return () => window.removeEventListener('pos-print-station', onCambio)
  }, [])

  const tiendaId = user?.tienda?.id
  useEffect(() => {
    const corriendo = activa && !!tiendaId
    publicar({ activa: corriendo, ...(corriendo ? {} : { error: '' }) })
    if (!corriendo) return undefined
    let vivo = true

    async function revisar() {
      if (ocupado.current) return
      ocupado.current = true
      try {
        const r = await getComandasPendientes()
        for (const c of r.data.data ?? []) {
          if (!vivo) break
          const t = await tomarComanda(c.id)
          const job = t.data.data
          if (!job?.hex) continue // otra estación ya la tomó
          const impresora = job.destino === 'COCINA' ? (getKitchenPrinterName() || undefined) : undefined
          try {
            await sendRaw(job.hex, impresora)
            publicar({ impresas: estado.impresas + 1, error: '' })
          } catch (err) {
            await liberarComanda(c.id).catch(() => {})
            publicar({ error: err.message || 'No se pudo imprimir la comanda' })
            break
          }
        }
      } catch (err) {
        if (err.response?.status !== 401) publicar({ error: err.response?.data?.message ?? err.message ?? 'Sin conexión con el servidor' })
      } finally {
        ocupado.current = false
      }
    }

    revisar()
    const t = setInterval(revisar, CADA_MS)
    return () => { vivo = false; clearInterval(t) }
  }, [activa, tiendaId])

  return null
}

/**
 * Estado de la estación de impresión, para la zona donde se genera la cuenta o se cobra. Solo
 * aparece en la computadora que ES la estación, y solo para cajero, admin y supervisor (quien
 * pasa `visible`). En rojo si la impresora falló, con enlace a Configuración → Impresoras.
 */
export function EstadoEstacion({ visible = true, className = '' }) {
  const { activa, error, impresas } = useSyncExternalStore(suscribir, leer)
  if (!visible || !activa) return null
  return (
    <Link to="/impresoras" title={error || 'Esta computadora imprime las comandas de los meseros'}
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold border ${
        error ? 'bg-red-50 border-red-200 text-red-800' : 'bg-[#F7F6F2] border-[#E4E1DA] text-gray-600'} ${className}`}>
      <span aria-hidden="true">🖨️</span>
      <span className="min-w-0 break-words">
        {error ? <><b>Comandas:</b> {error}</> : <>Estación de impresión activa{impresas ? ` · ${impresas} impresa${impresas === 1 ? '' : 's'}` : ''}</>}
      </span>
    </Link>
  )
}
