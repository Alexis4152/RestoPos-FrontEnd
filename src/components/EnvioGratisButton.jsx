import { useState } from 'react'
import { setEnvioGratis } from '../api/ordenes'
import { useNotify } from '../context/NotifyContext'
import Icon from './Icon'

/** ¿Es la línea de envío y va gratis ($0)? */
export const esEnvioGratis = (item) => !!item?.cargoExtra && Number(item.subtotal) === 0

/**
 * ¿Se puede cambiar el envío de esta línea? Pedido a domicilio del punto de venta, abierto, con
 * el envío todavía fuera de cualquier cuenta (misma regla que OrdenService#cambiarEnvioGratis).
 */
export function puedeCambiarEnvio(order, item) {
  return !!item?.cargoExtra && item.estado !== 'CANCELADO' && Number(item.cantidadFacturada ?? 0) === 0
    && order?.tipoEntrega === 'DOMICILIO' && order?.origen !== 'WEB'
    && !['PAGADA', 'CANCELADA'].includes(order?.estado)
}

/**
 * Icono de la línea de envío: lo deja gratis o lo vuelve a cobrar. El dueño decide cuándo un
 * envío no se cobra; en la cuenta y en el ticket sale "Envío a domicilio GRATIS" en $0.
 */
export default function EnvioGratisButton({ ordenId, item, onCambio }) {
  const { notify } = useNotify()
  const [busy, setBusy] = useState(false)
  const gratis = esEnvioGratis(item)
  const label = gratis ? 'Volver a cobrar el envío' : 'Envío gratis'

  async function cambiar() {
    setBusy(true)
    try {
      await setEnvioGratis(ordenId, !gratis)
      notify(gratis ? 'El envío se vuelve a cobrar' : 'Envío gratis', 'success')
      onCambio?.()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo cambiar el envío', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={cambiar} disabled={busy} aria-label={label} title={label} aria-pressed={gratis}
      className={`h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-[13px] font-bold disabled:opacity-50 ${gratis
        ? 'bg-[#E7F3EC] text-[#22603C] border border-[#B9DCC6] hover:bg-[#D8ECDF]'
        : 'border border-[#D9D5CC] text-gray-700 hover:bg-[#F1EFEA]'}`}>
      <Icon name="entregas" className="w-4 h-4" />
      {gratis ? 'Gratis' : 'Envío gratis'}
    </button>
  )
}
