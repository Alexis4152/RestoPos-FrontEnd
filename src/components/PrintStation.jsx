import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getComandasPendientes, tomarComanda, liberarComanda } from '../api/comandas'
import { isPrintStation, getKitchenPrinterName, sendRaw } from '../utils/printer'

const CADA_MS = 4000

/**
 * Estación de impresión de comandas. Corre en segundo plano SOLO en la computadora marcada
 * como estación (Configuración → Impresoras), normalmente la de caja con QZ Tray: cada pocos
 * segundos revisa si hay comandas nuevas de su tienda, toma cada una (el backend garantiza que
 * dos estaciones nunca impriman la misma) y la imprime — en la impresora de cocina si la
 * tienda tiene "Enviar a cocina", o en la impresora de tickets si no. Si la impresión falla,
 * la devuelve a la cola para reintentar y muestra el aviso en la pastilla de abajo.
 *
 * Así los meseros toman orden desde cualquier dispositivo (celular, tablet) y la comanda sale
 * impresa igual.
 */
export default function PrintStation() {
  const { user } = useAuth()
  const [activa, setActiva] = useState(isPrintStation())
  const [error, setError] = useState('')
  const [impresas, setImpresas] = useState(0)
  const ocupado = useRef(false)

  useEffect(() => {
    const onCambio = () => setActiva(isPrintStation())
    window.addEventListener('pos-print-station', onCambio)
    return () => window.removeEventListener('pos-print-station', onCambio)
  }, [])

  const tiendaId = user?.tienda?.id
  useEffect(() => {
    if (!activa || !tiendaId) return undefined
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
            setImpresas((n) => n + 1)
            setError('')
          } catch (err) {
            await liberarComanda(c.id).catch(() => {})
            setError(err.message || 'No se pudo imprimir la comanda')
            break
          }
        }
      } catch (err) {
        if (err.response?.status !== 401) setError(err.response?.data?.message ?? err.message ?? 'Sin conexión con el servidor')
      } finally {
        ocupado.current = false
      }
    }

    revisar()
    const t = setInterval(revisar, CADA_MS)
    return () => { vivo = false; clearInterval(t) }
  }, [activa, tiendaId])

  if (!activa || !tiendaId) return null
  return (
    <Link to="/impresoras" title={error || 'Esta computadora imprime las comandas de los meseros'}
      className={`fixed bottom-3 left-3 z-40 max-w-[calc(100vw-1.5rem)] truncate rounded-full px-3 py-1.5 text-xs font-bold shadow border ${
        error ? 'bg-red-50 border-red-200 text-red-800' : 'bg-white border-[#E4E1DA] text-gray-700'}`}>
      🖨️ {error ? `Comandas: ${error}` : `Estación de impresión activa${impresas ? ` · ${impresas} impresa${impresas === 1 ? '' : 's'}` : ''}`}
    </Link>
  )
}
