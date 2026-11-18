import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getOrder, deliverAllItems } from '../../api/ordenes'
import { getAccountsByOrder } from '../../api/cuentas'
import { getTables } from '../../api/mesas'
import { useNotify } from '../../context/NotifyContext'
import { useLiveRefresh } from '../../utils/liveEvents'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { admiteModoRapido } from '../../utils/modoToma'
import PedirPanel from './PedirPanel'
import CuentaRapida, { imprimir } from './CuentaRapida'
import { nombreMesa } from './MisMesas'
import OpcionesMesa from './OpcionesMesa'
// Personas sentadas: los comensales que de verdad tiene la orden (al instante al agregar,
// quitar o unir mesas); el contador guardado solo es respaldo.
const personasDe = (order) => order.comensales?.length ?? order.numeroComensales ?? 0

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)

/**
 * Modo rápido · Mis mesas: "+ Pedir" y "Cuenta" se resuelven aquí mismo, en un modal, sin salir
 * de Mis mesas. Pedir = PedirPanel (al enviar a cocina se cierra); Cuenta = CuentaRapida (al
 * cobrar muestra el resultado y "Listo" cierra). Lo que el modal no cubre (lo pedido por estado,
 * editar platillos, dividir la cuenta, mover/unir mesas) está en "Abrir pantalla completa", que
 * lleva a la orden como antes. La comanda por enviar se guarda por orden, así que cerrar el
 * modal o pasar a pantalla completa no la pierde.
 */
export default function MesaRapidaModal({ ordenId, modo: modoInicial, onCerrar, onCambio }) {
  const navigate = useNavigate()
  const { notify } = useNotify()
  const [modo, setModo] = useState(modoInicial)
  const [order, setOrder] = useState(null)
  const [cuentas, setCuentas] = useState([])
  const [mesasUnidas, setMesasUnidas] = useState([])
  const [cobro, setCobro] = useState(null)
  const [entregando, setEntregando] = useState(false)

  function load() {
    getOrder(ordenId).then((r) => setOrder(r.data.data)).catch(() => notify('No se pudo cargar la orden', 'error'))
    getAccountsByOrder(ordenId).then((r) => setCuentas(r.data.data ?? [])).catch(() => setCuentas([]))
    getTables().then((r) => setMesasUnidas((r.data.data ?? []).filter((m) => m.unidaA && m.ordenActiva?.id === Number(ordenId)))).catch(() => {})
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ordenId])
  useLiveRefresh(load, { filtro: (e) => e.name === 'orden' })

  function cerrar() {
    onCambio?.()
    onCerrar()
  }
  useEscapeKey(cerrar)

  const pantallaCompleta = (destino) => navigate(destino ?? `/orders/${ordenId}${modo === 'cuenta' ? '?ver=cuenta' : ''}`)

  // Orden que el modo rápido no maneja (ya cerrada por otro, pedido web...): directo a la de siempre.
  useEffect(() => {
    if (order && !cobro && !admiteModoRapido(order)) pantallaCompleta(`/orders/${ordenId}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, cobro])

  const titulo = order?.mesa
    ? nombreMesa([order.mesa.numero, ...mesasUnidas.map((m) => m.numero)].join(' + '))
    : order ? `Pedido #${order.id}` : 'Cargando…'

  async function yaSeEntrego() {
    setEntregando(true)
    try {
      await deliverAllItems(cobro.ordenId)
      cerrar()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo marcar como entregado', 'error')
      setEntregando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch sm:items-center justify-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="mesa-modal-titulo"
        className="bg-[#F7F6F2] w-full sm:max-w-4xl sm:rounded-2xl shadow-xl flex flex-col h-full sm:h-auto sm:max-h-[90vh] overflow-hidden">
        <header className="bg-white border-b border-[#E4E1DA] px-4 sm:px-5 pt-4 pb-3 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h2 id="mesa-modal-titulo" className="text-xl font-extrabold tracking-tight">{titulo}</h2>
              {order && (
                <p className="text-sm text-gray-600">
                  {personasDe(order)} persona{personasDe(order) === 1 ? '' : 's'} · {fmt(order.total)}
                </p>
              )}
            </div>
            {order && !cobro && (
              <OpcionesMesa mesa={order.mesa} ordenId={order.id} onCambio={() => { load(); onCambio?.() }} onCerrada={cerrar} />
            )}
            {!cobro && (
              <button type="button" onClick={() => pantallaCompleta()}
                className="min-h-[40px] px-2 text-sm font-bold text-purple-700 hover:underline shrink-0">
                Abrir pantalla completa
              </button>
            )}
            <button type="button" onClick={cerrar} aria-label="Cerrar"
              className="w-10 h-10 rounded-full border border-[#E4E1DA] bg-white text-2xl leading-none font-bold text-gray-700 shrink-0">×</button>
          </div>
          {!cobro && (
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-[#ECEAE4] p-1" role="tablist" aria-label="Qué hacer con la mesa">
              {[['pedir', '+ Pedir'], ['cuenta', 'Cuenta']].map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={modo === k} onClick={() => setModo(k)}
                  className={`min-h-[40px] rounded-xl text-sm font-extrabold ${modo === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {!order ? (
            <p className="text-gray-600 py-10 text-center">Cargando…</p>
          ) : cobro ? (
            <div className="max-w-md mx-auto bg-white border border-[#E4E1DA] rounded-2xl p-6 text-center space-y-3">
              <p className="text-sm font-bold text-[#22603C]">
                Cobrado · {cobro.lugar ?? `${nombreMesa(cobro.mesa)}${cobro.porEntregar ? '' : ' liberada'}`}
              </p>
              <p className="text-3xl font-extrabold">{fmt(cobro.total)}</p>
              {cobro.cambio > 0 && <p className="text-2xl font-extrabold">Cambio: {fmt(cobro.cambio)}</p>}
              {cobro.porEntregar && <p className="text-sm text-gray-700">Falta entregar: cocina lo sigue viendo y la orden se cierra al entregarlo.</p>}
              <div className="flex flex-wrap gap-2 justify-center pt-2">
                <button type="button" className="btn-secondary min-h-[44px]" onClick={() => imprimir(cobro.cuentaId).catch(() => notify('No se pudo imprimir', 'error'))}>Reimprimir (2 copias)</button>
                {cobro.porEntregar && (
                  <button type="button" className="btn-secondary min-h-[44px]" disabled={entregando} onClick={yaSeEntrego}>{entregando ? '...' : 'Ya se entregó'}</button>
                )}
                <button type="button" className="btn-primary min-h-[44px]" onClick={cerrar}>Listo</button>
              </div>
            </div>
          ) : (
            <>
              {/* Pedir queda montado al ver la cuenta: no se pierde "¿para quién?". */}
              <div hidden={modo !== 'pedir'}>
                <PedirPanel order={order} mesasUnidas={mesasUnidas} onCambio={load} onEnviado={cerrar} enModal />
              </div>
              {modo === 'cuenta' && (
                <CuentaRapida order={order} cuentas={cuentas} vistaDetallada={`/orders/${ordenId}?vista=detalle`}
                  onCambio={load} onCobrada={(c) => { setCobro(c); onCambio?.() }} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
