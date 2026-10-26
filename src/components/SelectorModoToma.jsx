import { useModoToma } from '../utils/modoToma'

/**
 * Interruptor "Rápido | Detallado" del modo de toma de orden (ver utils/modoToma.js). Se guarda
 * en este dispositivo; el texto de ayuda dice cuál es el de la tienda.
 */
export default function SelectorModoToma({ className = '', onCambio }) {
  const { modo, deTienda, setModo } = useModoToma()
  const elegir = (m) => { setModo(m === deTienda ? null : m); onCambio?.(m) }
  return (
    <div className={`inline-flex rounded-full border border-[#D9D5CC] bg-white p-1 ${className}`} role="radiogroup"
      aria-label="Modo de toma de orden" title={`Modo de la tienda: ${deTienda === 'RAPIDO' ? 'rápido' : 'detallado'}. Lo que elijas aquí se queda en este dispositivo.`}>
      {[['RAPIDO', 'Rápido'], ['DETALLADO', 'Detallado']].map(([key, label]) => (
        <button key={key} type="button" role="radio" aria-checked={modo === key} onClick={() => elegir(key)}
          className={`min-h-[36px] px-3.5 rounded-full text-sm font-bold transition-colors ${modo === key ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-[#F1EFEA]'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}
