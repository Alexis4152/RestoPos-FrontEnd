import { useState } from 'react'
import { imprimirRecibo } from '../utils/printer'
import { useNotify } from '../context/NotifyContext'

/**
 * Dos botones para imprimir la cuenta por separado: el recibo del cliente y el del negocio.
 * Cada uno sale como su propio ticket (la impresora no corta sola entre copias). No abre el cajón.
 */
export default function BotonesRecibo({ cuentaId, grande = false }) {
  const { notify } = useNotify()
  const [imprimiendo, setImprimiendo] = useState(null)

  async function imprimir(copia) {
    setImprimiendo(copia)
    try {
      await imprimirRecibo(cuentaId, copia)
    } catch (err) {
      notify(err.message ?? 'No se pudo imprimir', 'error')
    } finally {
      setImprimiendo(null)
    }
  }

  const cls = grande
    ? 'flex-1 min-h-[52px] rounded-2xl bg-gray-900 text-white text-sm font-extrabold disabled:opacity-50'
    : 'btn-secondary flex-1 min-h-[40px]'
  return (
    <div className="flex flex-wrap gap-2 w-full">
      <button type="button" className={cls} disabled={!!imprimiendo} onClick={() => imprimir('CLIENTE')}>
        {imprimiendo === 'CLIENTE' ? 'Imprimiendo…' : '🖨️ Imprimir recibo del cliente'}
      </button>
      <button type="button" className={cls} disabled={!!imprimiendo} onClick={() => imprimir('COMERCIO')}>
        {imprimiendo === 'COMERCIO' ? 'Imprimiendo…' : '🖨️ Imprimir recibo para el negocio'}
      </button>
    </div>
  )
}
