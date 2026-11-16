import Icon from './Icon'

const VARIANTS = {
  default: 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700',
  primary: 'border-blue-200 text-blue-600 hover:bg-blue-50',
  purple: 'border-purple-200 text-purple-600 hover:bg-purple-50',
  danger: 'border-red-200 text-red-500 hover:bg-red-50',
  warning: 'border-amber-200 text-amber-600 hover:bg-amber-50',
  success: 'border-green-200 text-green-600 hover:bg-green-50',
}

/**
 * Botón de acción de fila: solo ícono, sin texto (Editar, Ajustar stock, Desactivar, Ver...).
 * Reemplaza a los links de texto que había en cada tabla, para que las acciones se vean igual
 * en todo el sistema (mismo patrón que DemoPV).
 *
 * Sin texto visible, el nombre de la acción vive SOLO en `label`, por eso es obligatorio: da el
 * tooltip (`title`) y el `aria-label` del lector de pantalla.
 * Con `href` se pinta como enlace (ej. "Ver comprobante" en otra pestaña).
 *
 * @param {{ icon: string, label: string, onClick?: Function, href?: string,
 *   variant?: keyof VARIANTS, disabled?: boolean }} props `icon` = nombre en components/Icon.jsx
 */
export default function IconButton({ icon, label, onClick, href, variant = 'default', disabled = false, type = 'button' }) {
  const cls = `w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-lg border bg-white transition-colors disabled:opacity-40 disabled:pointer-events-none ${VARIANTS[variant]}`
  if (href) {
    return (
      <a className={cls} href={href} target="_blank" rel="noopener noreferrer" title={label} aria-label={label}>
        <Icon name={icon} className="w-4 h-4" />
      </a>
    )
  }
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} title={label} aria-label={label}>
      <Icon name={icon} className="w-4 h-4" />
    </button>
  )
}
