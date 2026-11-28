import { useState } from 'react'
import { getEnviosComanda, reimprimirComanda } from '../api/comandas'
import { useNotify } from '../context/NotifyContext'
import { useEscapeKey } from '../hooks/useEscapeKey'
import ModalCloseButton from './ModalCloseButton'

const hora = (d) => (d ? new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '')

/**
 * "Reimprimir comanda": lista los envíos a cocina de la orden y vuelve a mandar a la estación de
 * impresión el que se elija, o toda la orden. El ticket sale marcado "REIMPRESION" para que cocina
 * no lo prepare dos veces.
 */
export default function ReimprimirComanda({ ordenId, className = '' }) {
  const { notify } = useNotify()
  const [abierto, setAbierto] = useState(false)
  const [envios, setEnvios] = useState(null)
  const [mandando, setMandando] = useState(null)
  useEscapeKey(() => setAbierto(false), abierto)

  function abrir() {
    setAbierto(true)
    setEnvios(null)
    getEnviosComanda(ordenId).then((r) => setEnvios(r.data.data ?? [])).catch(() => setEnvios([]))
  }

  async function reimprimir(comandaId) {
    setMandando(comandaId ?? 'todo')
    try {
      await reimprimirComanda(ordenId, comandaId)
      notify('Se mandó a imprimir: sale en la estación de impresión', 'success')
      setAbierto(false)
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo reimprimir', 'error')
    } finally {
      setMandando(null)
    }
  }

  const originales = (envios ?? []).filter((e) => !e.reimpresion)
  return (
    <>
      <button type="button" onClick={abrir}
        className={`min-h-[36px] px-3 rounded-xl border border-[#D9D5CC] bg-white text-gray-800 text-sm font-bold hover:bg-[#F7F6F2] ${className}`}>
        🖨️ Reimprimir comanda
      </button>
      {abierto && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="reimprimir-titulo"
            className="relative bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl max-h-[85vh] overflow-y-auto p-5 space-y-3">
            <ModalCloseButton onClick={() => setAbierto(false)} />
            <h2 id="reimprimir-titulo" className="text-lg font-extrabold pr-10">Reimprimir comanda</h2>
            <p className="text-sm text-gray-600">Sale en la impresora de cocina marcada como "REIMPRESION".</p>
            {envios === null && <p className="text-sm text-gray-500 py-4 text-center">Cargando…</p>}
            {envios && originales.length === 0 && (
              <p className="text-sm text-gray-500 py-2">Esta orden todavía no tiene envíos a cocina.</p>
            )}
            {originales.length > 0 && (
              <ul className="space-y-2">
                {originales.map((e, i) => (
                  <li key={e.id} className="flex items-center gap-3 rounded-xl border border-[#E4E1DA] p-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">Envío {originales.length - i} · {hora(e.enviadaAt)}{e.enviadaPor ? ` · ${e.enviadaPor}` : ''}</p>
                      <p className="text-xs text-gray-600">{e.platillos || '—'}</p>
                    </div>
                    <button type="button" className="btn-secondary shrink-0" disabled={!!mandando} onClick={() => reimprimir(e.id)}>
                      {mandando === e.id ? '…' : 'Reimprimir'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn-primary w-full min-h-[44px]" disabled={!!mandando} onClick={() => reimprimir(null)}>
              {mandando === 'todo' ? 'Mandando…' : 'Reimprimir toda la orden'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
