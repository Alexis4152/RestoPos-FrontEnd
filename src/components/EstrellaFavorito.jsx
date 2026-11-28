import { useState } from 'react'
import { setProductFavorito } from '../api/products'
import { useNotify } from '../context/NotifyContext'

/**
 * Estrella para marcar o quitar un platillo de los Favoritos de la tienda (zona "Favoritos" al
 * tomar la orden, la ven todos). No dispara el clic de la tarjeta que la contiene.
 * `onCambio(favorito)` avisa el nuevo valor para actualizar la lista.
 */
export default function EstrellaFavorito({ producto, onCambio, className = '' }) {
  const { notify } = useNotify()
  const [guardando, setGuardando] = useState(false)
  const on = !!producto.favorito

  async function alternar(e) {
    e.stopPropagation()
    e.preventDefault()
    if (guardando) return
    setGuardando(true)
    try {
      await setProductFavorito(producto.id, !on)
      onCambio?.(!on)
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo guardar el favorito', 'error')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <button type="button" onClick={alternar} onKeyDown={(e) => e.stopPropagation()} disabled={guardando}
      aria-pressed={on} aria-label={on ? `Quitar ${producto.name} de favoritos` : `Agregar ${producto.name} a favoritos`}
      title={on ? 'Quitar de favoritos' : 'Agregar a favoritos'}
      className={`w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none bg-white/90 border shadow-sm disabled:opacity-50 ${on
        ? 'border-[#E2B76B] text-[#C77700]'
        : 'border-[#E4E1DA] text-gray-400 hover:text-[#C77700]'} ${className}`}>
      {on ? '★' : '☆'}
    </button>
  )
}
