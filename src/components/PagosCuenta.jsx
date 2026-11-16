import { useState } from 'react'
import { cancelPayment, correctPaymentMethod, refundPayment, verifyTransfer } from '../api/pagos'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const METODOS = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia' }
const VERIFICACION = {
  POR_VERIFICAR: ['Por verificar', 'bg-[#FBF0DC] text-[#7A4A00]'],
  VERIFICADA: ['Verificada', 'bg-[#E7F3EC] text-[#22603C]'],
  NO_RECIBIDA: ['No recibida', 'bg-red-100 text-red-700'],
}

/**
 * Pagos de una cuenta y lo que un admin o supervisor puede hacer con cada uno. Qué acción se
 * ofrece depende de si el dinero todavía se puede deshacer (mismas reglas que PagoService):
 *   - Cancelar: corte abierto y orden sin cerrar.
 *   - Corregir método: corte abierto y sin devoluciones.
 *   - Devolver: cuando ya no se puede cancelar (orden cerrada o corte cerrado).
 *
 * @param {{ cuenta: object, ordenCerrada: boolean, onCambio: () => void }} props
 */
export default function PagosCuenta({ cuenta, ordenCerrada, onCambio }) {
  const { isAdmin } = useAuth()
  const { notify } = useNotify()
  const [accion, setAccion] = useState(null) // { tipo: 'cancelar'|'corregir'|'devolver', pago }
  const [motivo, setMotivo] = useState('')
  const [metodo, setMetodo] = useState('CASH')
  const [referencia, setReferencia] = useState('')
  const [monto, setMonto] = useState('')
  const [busy, setBusy] = useState(false)

  const pagos = cuenta.pagos ?? []
  if (pagos.length === 0) return null
  const devueltoDe = (p) => pagos.filter((d) => d.pagoOrigenId === p.id && !d.cancelado).reduce((s, d) => s - Number(d.monto), 0)

  function abrir(tipo, pago) {
    setAccion({ tipo, pago })
    setMotivo('')
    setReferencia('')
    setMetodo(pago.metodo === 'CASH' ? 'CARD' : 'CASH')
    setMonto((Number(pago.monto) - devueltoDe(pago)).toFixed(2))
  }

  async function ejecutar(fn, mensaje) {
    setBusy(true)
    try {
      await fn()
      notify(mensaje, 'success')
      setAccion(null)
      onCambio?.()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo completar la acción', 'error')
    } finally { setBusy(false) }
  }

  function confirmar(e) {
    e.preventDefault()
    const { tipo, pago } = accion
    if (tipo === 'cancelar') return ejecutar(() => cancelPayment(pago.id, motivo.trim()), 'Pago cancelado')
    if (tipo === 'corregir') {
      return ejecutar(() => correctPaymentMethod(pago.id, { metodo, referencia: referencia.trim() || undefined, motivo: motivo.trim() }), 'Método corregido')
    }
    return ejecutar(() => refundPayment(pago.id, { monto: Number(monto), motivo: motivo.trim() }), 'Devolución registrada')
  }

  const faltaDato = motivo.trim().length < 3
    || (accion?.tipo === 'corregir' && metodo === 'TRANSFER' && !referencia.trim())
    || (accion?.tipo === 'devolver' && !(Number(monto) > 0))

  return (
    <div className="mt-2 space-y-1.5">
      {pagos.map((p) => {
        const devolucion = p.pagoOrigenId != null
        const corteAbierto = p.cashCut?.status === 'OPEN'
        const vigente = !p.cancelado && !devolucion
        const devuelto = devueltoDe(p)
        const estado = VERIFICACION[p.verificacion]
        const linkBtn = 'text-xs font-bold text-purple-700 hover:underline'
        return (
          <div key={p.id} className="rounded-lg bg-[#F6F5F1] px-2.5 py-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className={p.cancelado ? 'text-gray-500 line-through' : 'text-gray-700'}>
                {devolucion ? 'Devolución · ' : ''}{METODOS[p.metodo] ?? p.metodo}
              </span>
              <span className={`font-bold ${p.cancelado ? 'text-gray-500 line-through' : Number(p.monto) < 0 ? 'text-red-700' : 'text-gray-800'}`}>{fmt(p.monto)}</span>
            </div>
            {p.referencia && <p className="text-gray-600 break-words">{p.referencia}</p>}
            {p.cancelado && p.motivoCancelacion && <p className="text-gray-600">Cancelado: {p.motivoCancelacion}</p>}
            {estado && !p.cancelado && (
              <p className="mt-0.5">
                <span className={`font-bold px-1.5 py-0.5 rounded ${estado[1]}`}>{estado[0]}</span>
                {p.verificadaPor && <span className="text-gray-600"> · {p.verificadaPor}</span>}
              </p>
            )}
            {isAdmin && vigente && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {!ordenCerrada && corteAbierto && <button type="button" className={linkBtn} onClick={() => abrir('cancelar', p)}>Cancelar pago</button>}
                {corteAbierto && devuelto === 0 && <button type="button" className={linkBtn} onClick={() => abrir('corregir', p)}>Corregir método</button>}
                {(ordenCerrada || !corteAbierto) && devuelto < Number(p.monto) && <button type="button" className={linkBtn} onClick={() => abrir('devolver', p)}>Devolver</button>}
                {(p.verificacion === 'POR_VERIFICAR' || p.verificacion === 'NO_RECIBIDA') && (
                  <>
                    <button type="button" disabled={busy} className={linkBtn} onClick={() => ejecutar(() => verifyTransfer(p.id, 'VERIFICADA'), 'Transferencia verificada')}>Sí llegó</button>
                    {p.verificacion === 'POR_VERIFICAR' && <button type="button" disabled={busy} className={linkBtn} onClick={() => ejecutar(() => verifyTransfer(p.id, 'NO_RECIBIDA'), 'Marcada como no recibida')}>No llegó</button>}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}

      {accion && (
        <form onSubmit={confirmar} className="rounded-xl border border-[#E4E1DA] bg-white p-3 space-y-2 text-sm">
          <p className="font-bold">
            {accion.tipo === 'cancelar' ? `Cancelar pago de ${fmt(accion.pago.monto)}`
              : accion.tipo === 'corregir' ? `Corregir método (ahora ${METODOS[accion.pago.metodo]})` : `Devolver dinero (${METODOS[accion.pago.metodo]})`}
          </p>
          {accion.tipo === 'corregir' && (
            <>
              <select className="input" aria-label="Método correcto" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                {Object.entries(METODOS).filter(([k]) => k !== accion.pago.metodo).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              {metodo === 'TRANSFER' && (
                <input className="input" maxLength={100} placeholder="Referencia o folio (obligatoria)" aria-label="Referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
              )}
            </>
          )}
          {accion.tipo === 'devolver' && (
            <>
              <input className="input" type="number" min="0.01" step="0.01" aria-label="Monto a devolver" value={monto} onChange={(e) => setMonto(e.target.value)} />
              <p className="text-xs text-gray-600">Sale de tu corte abierto{accion.pago.metodo === 'CASH' ? ': entrega el efectivo al cliente' : '; regrésalo por el mismo medio'}. El inventario no cambia.</p>
            </>
          )}
          <input className="input" maxLength={255} placeholder="Motivo (obligatorio)" aria-label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1 min-h-[40px]" onClick={() => setAccion(null)}>Cerrar</button>
            <button type="submit" className="btn-primary flex-1 min-h-[40px]" disabled={busy || faltaDato}>{busy ? '...' : 'Confirmar'}</button>
          </div>
        </form>
      )}
    </div>
  )
}
