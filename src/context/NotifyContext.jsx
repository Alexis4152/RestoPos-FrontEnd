import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useEscapeKey } from '../hooks/useEscapeKey'

const NotifyContext = createContext(null)

let idCounter = 0

/**
 * Estilos visuales (clases Tailwind + ícono) para cada tipo de toast soportado por
 * {@link NotifyProvider}. Se usa como fallback `TOAST_STYLES.error` cuando el tipo
 * recibido no coincide con ninguna clave conocida.
 */
const TOAST_STYLES = {
  error: { box: 'bg-red-50 border-red-200 text-red-700', icon: '⚠️' },
  success: { box: 'bg-green-50 border-green-200 text-green-700', icon: '✅' },
  // "info" usa la paleta purple-*, que ya sigue el color de marca de la tienda
  info: { box: 'bg-purple-50 border-purple-200 text-purple-700', icon: 'ℹ️' },
}

// Reemplaza los alert()/confirm() nativos del navegador (los feos "localhost dice") por
// toasts y un modal de confirmación con el estilo de la app — el botón de confirmar usa
// btn-primary/btn-danger, que ya siguen el color elegido por el admin de cada tienda.
/**
 * Proveedor de contexto de notificaciones de la aplicación.
 *
 * Sustituye a los `alert()`/`confirm()` nativos del navegador por un sistema de
 * toasts (con auto-dismiss) y un modal de confirmación propio, ambos con el estilo
 * visual de la app y ligados al color de marca de la tienda del usuario. Renderiza
 * el contenedor de toasts y el modal de confirmación como hijos flotantes junto al
 * `children` recibido, y expone `notify`/`confirmDialog` vía {@link useNotify}.
 *
 * @param {{ children: import('react').ReactNode }} props
 */
export function NotifyProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [confirmState, setConfirmState] = useState(null)

  /**
   * Quita un toast de la lista visible por su `id` (llamado por el botón de cierre
   * manual o automáticamente tras el timeout de auto-dismiss de {@link notify}).
   * @param {number} id
   */
  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  /**
   * Muestra un toast no bloqueante. Se retira solo a los 4.5s (auto-dismiss) o antes
   * si el usuario lo cierra manualmente.
   *
   * @param {string} message - Texto a mostrar.
   * @param {'error'|'success'|'info'} [type='error'] - Estilo/ícono del toast.
   */
  const notify = useCallback((message, type = 'error') => {
    const id = ++idCounter
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => dismiss(id), 4500)
  }, [dismiss])

  /**
   * Reemplazo de `window.confirm` que no bloquea el hilo: abre el modal de
   * confirmación y devuelve una promesa que se resuelve con `true`/`false` cuando
   * el usuario hace clic en Confirmar/Cancelar (ver {@link handleConfirm}).
   *
   * @param {string} message - Pregunta/mensaje a confirmar.
   * @param {{ title?: string, confirmText?: string, cancelText?: string, danger?: boolean }} [opts]
   *   `danger` en `false` usa el estilo primario en vez del rojo de peligro para el botón de confirmar.
   * @returns {Promise<boolean>} Resuelve `true` si el usuario confirma, `false` si cancela.
   */
  const confirmDialog = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      setConfirmState({ message, opts, resolve })
    })
  }, [])

  /**
   * Resuelve la promesa pendiente de {@link confirmDialog} con el resultado elegido
   * por el usuario (clic en Confirmar/Cancelar) y cierra el modal.
   * @param {boolean} result
   */
  function handleConfirm(result) {
    confirmState?.resolve(result)
    setConfirmState(null)
  }

  // Cierra con ESC el modal de confirmación (equivalente a hacer clic en "Cancelar"/
  // resolver `false`) — mismo comportamiento que `window.confirm` nativo al presionar
  // Escape, y consistente con el resto de los modales de la app (ver PrivateRoute-adjacent
  // pages), que también cierran con ESC.
  useEscapeKey(() => {
    handleConfirm(false)
  }, !!confirmState)

  return (
    <NotifyContext.Provider value={{ notify, confirmDialog }}>
      {children}

      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
        {toasts.map((t) => {
          const style = TOAST_STYLES[t.type] ?? TOAST_STYLES.error
          return (
            <div
              key={t.id}
              className={`pointer-events-auto rounded-lg shadow-lg border px-4 py-3 text-sm flex items-start gap-3 animate-[toast-in_0.2s_ease-out] ${style.box}`}
            >
              <span className="text-base leading-none">{style.icon}</span>
              <p className="flex-1">{t.message}</p>
              <button className="text-current opacity-50 hover:opacity-100 leading-none" onClick={() => dismiss(t.id)}>✕</button>
            </div>
          )
        })}
      </div>

      {confirmState && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[101] p-4" onClick={() => handleConfirm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            {confirmState.opts.title && <h3 className="text-lg font-bold text-gray-900 mb-2">{confirmState.opts.title}</h3>}
            <p className="text-sm text-gray-700 mb-6">{confirmState.message}</p>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => handleConfirm(false)}>
                {confirmState.opts.cancelText ?? 'Cancelar'}
              </button>
              <button
                className={confirmState.opts.danger === false ? 'btn-primary' : 'btn-danger'}
                onClick={() => handleConfirm(true)}
              >
                {confirmState.opts.confirmText ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </NotifyContext.Provider>
  )
}

/** Hook de acceso al contexto de notificaciones (`notify`, `confirmDialog`). */
export const useNotify = () => useContext(NotifyContext)
