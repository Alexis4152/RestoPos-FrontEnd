import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getOrder, updateOrderItemStatus, cancelOrderItem } from '../../api/ordenes'
import { getAccountsByOrder } from '../../api/cuentas'
import { getTables } from '../../api/mesas'
import { useNotify } from '../../context/NotifyContext'
import { useLiveRefresh } from '../../utils/liveEvents'
import Icon from '../../components/Icon'
import { admiteModoRapido } from '../../utils/modoToma'
import SelectorModoToma from '../../components/SelectorModoToma'
import { useVolver } from '../../utils/navegacion'
import { etiquetaTipoPedido } from '../../utils/tipoPedido'
import OrderDetail from '../OrderDetail'
import PedirPanel from './PedirPanel'
import CuentaRapida, { CobroExitoso } from './CuentaRapida'
import { nombreMesa } from './MisMesas'
import EditarLineaSheet from './EditarLineaSheet'
import { textoMods } from '../../components/GruposModificadores'
import OpcionesMesa from './OpcionesMesa'
import EnvioGratisButton, { esEnvioGratis, puedeCambiarEnvio } from '../../components/EnvioGratisButton'
// Personas sentadas: los comensales que de verdad tiene la orden (al instante al agregar,
// quitar o unir mesas); el contador guardado solo es respaldo.
const personasDe = (order) => order.comensales?.length ?? order.numeroComensales ?? 0

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const EN_COCINA = ['PENDIENTE', 'PREPARANDO']
const LISTO = ['LISTO', 'ENTREGADO_MESERO']

function minutos(desde) {
  if (!desde) return ''
  const m = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/**
 * Modo rápido · orden de una mesa en una sola pantalla:
 *  - Pedir: PedirPanel (menú directo y comanda; el mismo que abre el modal de Mis mesas).
 *  - Lo pedido: lo ya enviado por estado, con "Ya los llevé" para lo que cocina terminó.
 *  - Cuenta: CuentaRapida (entregar y cobrar en un paso).
 * Mover/unir/separar mesas y cancelar la orden: menú "Opciones" (OpcionesMesa). Dividir la
 * cuenta y lo más fino: "Vista detallada"
 * (?vista=detalle), que es OrderDetail sobre la misma orden. Órdenes sin mesa o ya cerradas
 * se muestran siempre en la vista detallada.
 */
export default function OrdenRapida() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const volver = useVolver()
  const { notify, confirmDialog } = useNotify()
  const [order, setOrder] = useState(null)
  const [cuentas, setCuentas] = useState([])
  const [mesasUnidas, setMesasUnidas] = useState([])
  const [busy, setBusy] = useState(false)
  const [editando, setEditando] = useState(null) // línea ya enviada que se está editando
  const [cobro, setCobro] = useState(null) // al cobrar: { cuentaId, mesa, total, cambio }

  function load() {
    getOrder(id).then((r) => setOrder(r.data.data)).catch(() => notify('No se pudo cargar la orden', 'error'))
    getAccountsByOrder(id).then((r) => setCuentas(r.data.data ?? [])).catch(() => setCuentas([]))
    getTables().then((r) => setMesasUnidas((r.data.data ?? []).filter((m) => m.unidaA && m.ordenActiva?.id === Number(id)))).catch(() => {})
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id])
  useLiveRefresh(load, { filtro: (e) => e.name === 'orden' })

  const items = useMemo(() => (order?.items ?? []).filter((i) => i.estado !== 'CANCELADO' && !i.cargoExtra), [order])
  // Línea de envío de un pedido a domicilio (no pasa por cocina): se muestra aparte.
  const envio = useMemo(() => (order?.items ?? []).find((i) => i.cargoExtra && i.estado !== 'CANCELADO'), [order])

  if (cobro) return <CobroExitoso cobro={cobro} />
  if (!order) return <p className="text-gray-600 py-10 text-center">Cargando…</p>
  // A domicilio, de la página web, cerrada, o pedida a propósito: la vista de siempre.
  if (!admiteModoRapido(order) || searchParams.get('vista') === 'detalle') {
    return <OrderDetail />
  }

  const vistaDetallada = `/orders/${id}?vista=detalle`
  const ver = searchParams.get('ver') || (items.length === 0 ? 'pedir' : 'pedir')
  const setVer = (v) => setSearchParams(v === 'pedir' ? {} : { ver: v }, { replace: true })
  const comensales = [...(order.comensales ?? [])].sort((a, b) => a.numero - b.numero)
  const esMesa = !!order.mesa
  const conPersonas = esMesa || order.tipoEntrega === 'COMER_AQUI'

  async function yaLosLleve(lista) {
    setBusy(true)
    try {
      for (const i of lista) await updateOrderItemStatus(id, i.id, 'ENTREGADO')
      notify('Marcados como entregados', 'success')
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudieron marcar', 'error') }
    finally { setBusy(false); load() }
  }

  /** Quitar del pedido (igual que el bote de la vista detallada): solo si aún no está en una cuenta. */
  async function quitar(i) {
    if (!(await confirmDialog(`¿Quitar ${i.productoNombre} del pedido?`, { confirmText: 'Quitar' }))) return
    try {
      await cancelOrderItem(id, i.id, 'Quitado desde modo rápido')
      notify('Quitado del pedido', 'success')
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo quitar', 'error') }
    finally { load() }
  }

  const enCocina = items.filter((i) => EN_COCINA.includes(i.estado))
  const listos = items.filter((i) => LISTO.includes(i.estado))
  const entregados = items.filter((i) => i.estado === 'ENTREGADO')
  const TABS = [['pedir', 'Pedir'], ['pedido', `Lo pedido (${items.length})`], ['cuenta', 'Cuenta']]
  const resumenItem = (i) => [textoMods(i.modificadores), i.observaciones].filter(Boolean).join(' · ')

  return (
    <div className="max-w-6xl space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => volver(esMesa ? '/tables' : '/takeaway')} aria-label="Regresar"
          className="w-11 h-11 rounded-full border border-[#E4E1DA] bg-white flex items-center justify-center">
          <Icon name="atras" className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-[160px]">
          <h1 className="text-2xl font-extrabold tracking-tight">
            {esMesa ? nombreMesa([order.mesa.numero, ...mesasUnidas.map((m) => m.numero)].join(' + ')) : `${etiquetaTipoPedido(order)} · ${order.clienteNombre ?? `#${order.id}`}`}
          </h1>
          <p className="text-sm text-gray-600">
            {conPersonas ? `${personasDe(order)} persona${personasDe(order) === 1 ? '' : 's'}` : `Pedido #${order.id}`} · {minutos(order.openedAt)} · {fmt(order.total)}
          </p>
        </div>
        <OpcionesMesa mesa={order.mesa} ordenId={order.id} onCambio={load} onCerrada={() => volver(esMesa ? '/tables' : '/takeaway')} />
        {/* Para llevar: el modo se elige ya dentro del pedido. En mesas se elige en Mesas. */}
        {esMesa
          ? <Link to={vistaDetallada} className="text-sm font-bold text-purple-700 hover:underline">Vista detallada</Link>
          : <SelectorModoToma />}
      </header>

      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-[#ECEAE4] p-1" role="tablist" aria-label="Secciones de la orden">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={ver === k} onClick={() => setVer(k)}
            className={`min-h-[44px] rounded-xl text-sm font-extrabold ${ver === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Montado aunque se vea otra pestaña: no se pierde "¿para quién?" ni las opciones recientes. */}
      <div hidden={ver !== 'pedir'}>
        <PedirPanel key={id} order={order} mesasUnidas={mesasUnidas} onCambio={load} />
      </div>

      {ver === 'pedido' && (
        <div className="space-y-3 max-w-3xl">
          {items.length === 0 && <p className="text-center text-sm text-gray-600 py-8">Todavía no se ha pedido nada.</p>}
          {[['Listo para llevar', listos, 'bg-[#C77700]'], ['En cocina', enCocina, 'bg-[#24519E]'], ['Entregado', entregados, 'bg-[#2E7D4F]']].map(([titulo, lista, dot]) => lista.length > 0 && (
            <section key={titulo} className="bg-white border border-[#E4E1DA] rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${dot}`} aria-hidden="true" />
                <h2 className="text-sm font-extrabold flex-1">{titulo} · {lista.reduce((s, i) => s + Number(i.cantidad), 0)}</h2>
                {titulo !== 'Entregado' && (
                  // Cocina no siempre lo marca: el mesero puede darlo por entregado desde cualquier estado.
                  <button type="button" disabled={busy} onClick={() => yaLosLleve(lista)}
                    className={`min-h-[40px] px-3.5 rounded-xl text-[13px] font-extrabold disabled:opacity-50 ${titulo === 'Listo para llevar' ? 'bg-[#6B4100] text-white' : 'border border-[#D9D5CC] bg-white text-gray-800'}`}>
                    {titulo === 'Listo para llevar' ? 'Ya los llevé' : 'Ya se entregó'}
                  </button>
                )}
              </div>
              {lista.map((i) => (
                <div key={i.id} className="flex items-center gap-1 -mx-2">
                  <button type="button" onClick={() => setEditando(i)} aria-label={`Editar ${i.productoNombre}`}
                    className="flex-1 min-w-0 flex gap-3 text-sm text-left rounded-xl px-2 py-1.5 hover:bg-[#F7F6F2]">
                    <span className="font-extrabold w-6 text-right">{Number(i.cantidad)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold">{i.productoNombre}</span>
                      {(resumenItem(i) || i.comensal) && (
                        <span className="block text-xs text-gray-600">{[i.comensal ? (i.comensal.nombre || `Persona ${i.comensal.numero}`) : null, resumenItem(i)].filter(Boolean).join(' · ')}</span>
                      )}
                    </span>
                    <span className="font-bold">{fmt(i.subtotal)}</span>
                    <Icon name="editar" className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />
                  </button>
                  {Number(i.cantidadFacturada ?? 0) === 0 && (
                    <button type="button" onClick={() => quitar(i)} aria-label={`Quitar ${i.productoNombre}`} title="Quitar del pedido"
                      className="w-9 h-9 shrink-0 rounded-lg text-red-700 hover:bg-red-50 flex items-center justify-center">
                      <Icon name="borrar" className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </section>
          ))}
          {envio && (
            <section className="bg-white border border-[#E4E1DA] rounded-2xl p-4 flex flex-wrap items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-400" aria-hidden="true" />
              <span className="flex-1 min-w-[140px] text-sm font-bold">{esEnvioGratis(envio) ? 'Envío a domicilio · gratis' : 'Envío a domicilio'}</span>
              <span className="text-sm font-bold">{fmt(envio.subtotal)}</span>
              {puedeCambiarEnvio(order, envio) && <EnvioGratisButton ordenId={order.id} item={envio} onCambio={load} />}
            </section>
          )}
          {items.length > 0 && <p className="text-xs text-gray-600 text-center">Toca un platillo para cambiarlo o quitarlo. Si cocina ya lo está preparando, avísales.</p>}
        </div>
      )}

      {ver === 'cuenta' && (
        <div className="max-w-3xl"><CuentaRapida order={order} cuentas={cuentas} vistaDetallada={vistaDetallada} onCambio={load} onCobrada={(c) => { setCobro(c); load() }} /></div>
      )}

      {editando && (
        <EditarLineaSheet ordenId={id} item={editando} comensales={comensales} onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); load() }} />
      )}
    </div>
  )
}
