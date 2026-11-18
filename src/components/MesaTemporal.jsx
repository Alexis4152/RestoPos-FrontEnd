import { useState } from 'react'
import { openTemporalOrder } from '../api/ordenes'
import { useNotify } from '../context/NotifyContext'
import { useEscapeKey } from '../hooks/useEscapeKey'
import ModalCloseButton from './ModalCloseButton'
import Icon from './Icon'

/**
 * ¿Ya no queda ninguna mesa normal libre? Ahí se ofrece abrir una mesa temporal. Las mesas
 * temporales ya abiertas no cuentan (siempre están ocupadas). Sin mesas dadas de alta no se
 * ofrece: esa tienda vende "Comer aquí" sin mesa.
 */
export function todasOcupadas(mesas) {
  const normales = (mesas ?? []).filter((m) => !m.temporal)
  return normales.length > 0 && !normales.some((m) => !m.ordenActiva && m.estado === 'DISPONIBLE')
}

/** Tarjeta/botón "+ Mesa temporal" (con línea punteada, como un lugar extra en el plano). */
export function BotonMesaTemporal({ onClick, className = '' }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-2xl border-2 border-dashed border-purple-300 bg-purple-50/40 text-purple-700 hover:bg-purple-50 p-4 flex flex-col items-center justify-center gap-1.5 text-center min-h-[120px] ${className}`}>
      <Icon name="mas" className="w-6 h-6" strokeWidth={2} />
      <span className="font-extrabold">Mesa temporal</span>
      <span className="text-xs text-gray-600">Todas las mesas están ocupadas</span>
    </button>
  )
}

/**
 * Abre una mesa temporal ("Temporal 1", "Temporal 2"...) con su orden: pide cuántas personas
 * y la crea en la zona indicada. Se cierra sola al cobrar/cancelar/mover la orden. En Ventas
 * aparece como "Mesa Temporal N". Ver OrdenService#abrirMesaTemporal.
 */
export default function MesaTemporalModal({ zonaId, onClose, onAbierta }) {
  const { notify } = useNotify()
  const [personas, setPersonas] = useState(2)
  const [abriendo, setAbriendo] = useState(false)
  useEscapeKey(() => { if (!abriendo) onClose() }, true)

  async function abrir() {
    setAbriendo(true)
    try {
      const r = await openTemporalOrder({ zonaId: zonaId ?? undefined, numeroComensales: personas })
      notify(`${r.data.data.mesa?.numero ?? 'Mesa temporal'} abierta`, 'success')
      onAbierta(r.data.data)
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo abrir la mesa temporal', 'error')
      setAbriendo(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="mesa-temporal-titulo" className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <ModalCloseButton onClick={() => !abriendo && onClose()} />
        <div className="pr-10">
          <h3 id="mesa-temporal-titulo" className="text-lg font-extrabold">Abrir mesa temporal</h3>
          <p className="text-sm text-gray-600 mt-1">
            Todas las mesas están ocupadas. Se abre una mesa temporal (Temporal 1, 2…) que desaparece sola al cobrar.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-1.5">¿Cuántas personas?</p>
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Una persona menos" className="w-11 h-11 rounded-xl border border-[#D9D5CC] text-xl font-bold disabled:opacity-40"
              disabled={personas <= 1} onClick={() => setPersonas((p) => Math.max(1, p - 1))}>−</button>
            <span className="text-2xl font-extrabold w-10 text-center" aria-live="polite">{personas}</span>
            <button type="button" aria-label="Una persona más" className="w-11 h-11 rounded-xl border border-[#D9D5CC] text-xl font-bold disabled:opacity-40"
              disabled={personas >= 50} onClick={() => setPersonas((p) => Math.min(50, p + 1))}>+</button>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={abriendo}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={abrir} disabled={abriendo}>{abriendo ? 'Abriendo…' : 'Abrir mesa temporal'}</button>
        </div>
      </div>
    </div>
  )
}
