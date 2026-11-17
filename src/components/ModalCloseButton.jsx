/**
 * Botón "X" para cerrar un modal, fijo en la esquina superior derecha del panel.
 *
 * Regla del sistema: los modales NO se cierran con un clic afuera (en el fondo oscuro) —
 * así nadie pierde lo capturado por un clic accidental. Se cierran con esta X, con el botón
 * "Cancelar"/"Cerrar" del propio modal, o con ESC donde ya existía.
 *
 * El panel que lo contiene debe tener `relative` (el botón es `absolute`). Fondo blanco
 * semitransparente para que se vea también encima de una imagen (ej. foto de un platillo).
 *
 * @param {{ onClick: () => void, disabled?: boolean, label?: string, className?: string }} props
 */
export default function ModalCloseButton({ onClick, disabled = false, label = 'Cerrar', className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`absolute top-2.5 right-2.5 z-10 w-9 h-9 rounded-full bg-white/90 text-gray-500 hover:text-gray-900 hover:bg-[#F1EFEA] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  )
}
