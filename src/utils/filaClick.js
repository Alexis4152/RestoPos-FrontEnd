/**
 * Props para que una fila de tabla abra su detalle (o su edición) al hacerle clic en cualquier
 * parte, además del botón "Ver"/"Editar" de siempre. Se ignoran los clics sobre botones,
 * enlaces y campos de la fila (para que "Eliminar", un select, etc. sigan haciendo lo suyo) y
 * cuando el usuario está seleccionando texto para copiarlo. Con teclado: Tab + Enter.
 *
 * Uso: <tr {...filaClick(() => abrir(x))} className={`${FILA_CLICK} ...`}>
 * Con `onOpen` nulo (p. ej. sin permiso de editar) la fila se queda como estaba.
 */
export function filaClick(onOpen) {
  if (!onOpen) return {}
  return {
    tabIndex: 0,
    onClick: (e) => {
      if (e.target.closest('button, a, input, select, textarea, label, [data-no-fila-click]')) return
      if (window.getSelection?.()?.toString()) return
      onOpen()
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onOpen() }
    },
  }
}

/** Clases para la fila clickeable: cursor de mano y foco visible al navegar con teclado. */
export const FILA_CLICK = 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-400'
