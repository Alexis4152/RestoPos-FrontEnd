import { useAuth } from '../context/AuthContext'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)

/**
 * Consumo local (Tienda.consumoLocalActivo / consumoLocalMonto): cargo por pieza a los platillos
 * marcados (Product.aplicaConsumoLocal) cuando se consumen en el restaurante. Se elige al agregar
 * el platillo; por defecto encendido en mesa y "comer aquí". Solo lo ve el personal: al cliente le
 * sale incluido en el precio del platillo.
 *
 * @param order la orden (para el valor por defecto); puede ser null
 */
export function useConsumoLocal(order) {
  const { user } = useAuth()
  const activo = !!user?.tienda?.consumoLocalActivo
  const monto = Number(user?.tienda?.consumoLocalMonto ?? 10)
  const aplica = (p) => activo && !!p?.aplicaConsumoLocal
  const enLocal = !!(order?.mesa || order?.tipoEntrega === 'COMER_AQUI')
  return { activo, monto, aplica, porDefecto: (p) => enLocal && aplica(p) }
}

/** Botón "+$10 local" para poner o quitar el consumo local de una línea o un platillo. */
export function BotonLocal({ on, monto, onClick, disabled = false, grande = false }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick}
      title={on ? 'Cobra consumo local (toca para quitarlo)' : 'Sin consumo local (toca para cobrarlo)'}
      className={`${grande ? 'min-h-[44px] px-4 text-sm' : 'min-h-[32px] px-2.5 text-xs'} rounded-full font-bold border whitespace-nowrap disabled:opacity-50 ${on
        ? 'border-[#2E7D4F] bg-[#E7F3EC] text-[#22603C]'
        : 'border-dashed border-[#A8A398] bg-white text-gray-600'}`}>
      {on ? '✓ ' : ''}Consumo local +{fmt(monto)}
    </button>
  )
}

/**
 * Pone o quita el consumo local de la línea con clave `k` de una lista por enviar (el precio de la
 * línea lo incluye) y junta líneas que quedaron iguales.
 */
export function alternarLocal(lista, k, clave, monto) {
  const cambiada = lista.map((x) => (clave(x) === k
    ? { ...x, consumoLocal: !x.consumoLocal, precio: x.precio + (x.consumoLocal ? -monto : monto) }
    : x))
  const out = []
  for (const x of cambiada) {
    const i = out.findIndex((y) => clave(y) === clave(x))
    if (i >= 0) out[i] = { ...out[i], cantidad: out[i].cantidad + x.cantidad }
    else out.push(x)
  }
  return out
}
