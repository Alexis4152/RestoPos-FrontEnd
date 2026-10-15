import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getReservacionesPendientes } from '../api/reservaciones'
import { useNotify } from '../context/NotifyContext'
import { playChime } from '../utils/sound'
import { useLiveRefresh } from '../utils/liveEvents'

/**
 * Aviso global de reservaciones de la página web por confirmar: suena y avisa cuando llega
 * una nueva, y mientras haya alguna muestra un botón flotante que lleva a "Reservaciones".
 */
export default function ReservasNotifier() {
  const navigate = useNavigate()
  const location = useLocation()
  const { notify } = useNotify()
  const [pendientes, setPendientes] = useState([])
  const vistasRef = useRef(null)

  function load() {
    getReservacionesPendientes()
      .then((r) => {
        const data = r.data.data ?? []
        // La primera carga solo registra las que ya había (sin sonar al entrar al sistema).
        if (vistasRef.current) {
          const nuevas = data.filter((x) => !vistasRef.current.has(x.id))
          if (nuevas.length > 0) {
            playChime()
            notify(`📅 ${nuevas.length === 1 ? `Nueva reservación de ${nuevas[0].nombre}` : `${nuevas.length} reservaciones nuevas`} por confirmar`, 'info')
            if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
              try { new Notification('Reservación nueva', { body: nuevas.map((x) => `${x.nombre} · ${x.personas} personas`).join('\n') }) } catch { /* ignorar */ }
            }
          }
        }
        vistasRef.current = new Set(data.map((x) => x.id))
        setPendientes(data)
      })
      .catch(() => {})
  }

  useEffect(() => { load() }, [])
  useLiveRefresh(load, { filtro: (e) => e.name === 'reservacion' })

  if (pendientes.length === 0 || location.pathname === '/reservaciones') return null
  return (
    <button type="button" onClick={() => navigate('/reservaciones')}
      className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full bg-yellow-400 text-yellow-950 px-4 py-2.5 text-sm font-bold shadow-xl hover:bg-yellow-300">
      <span className="inline-block w-2 h-2 rounded-full bg-red-600 animate-pulse" />
      📅 {pendientes.length} reservación{pendientes.length === 1 ? '' : 'es'} por confirmar
    </button>
  )
}
