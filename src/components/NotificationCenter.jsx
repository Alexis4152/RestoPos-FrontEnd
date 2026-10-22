import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { getWebPendingOrders, acceptWebOrder, cancelOrder, getPickups, updateOrderItemStatus, getTakeawayOrders, getOrderNotices } from '../api/ordenes'
import { getReservacionesPendientes } from '../api/reservaciones'
import { getTables } from '../api/mesas'
import { useLiveRefresh } from '../utils/liveEvents'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { playChime } from '../utils/sound'
import Icon from './Icon'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))
const PAGO = { EFECTIVO: 'efectivo', TARJETA: 'tarjeta', TRANSFERENCIA: 'transferencia' }

/** Tipo de aviso → filtro, ícono y color (mismo sistema de colores que mesas y pedidos). */
const TIPO = {
  pedido: { tab: 'pedidos', icon: 'llevar', cls: 'bg-[#E6EDF8] text-[#1E4585]' },
  cobro: { tab: 'pedidos', icon: 'corte', cls: 'bg-[#E7F3EC] text-[#22603C]' },
  alerta: { tab: 'pedidos', icon: 'alerta', cls: 'bg-red-50 text-red-800' },
  entrega: { tab: 'pedidos', icon: 'entregas', cls: 'bg-[#E7F3EC] text-[#22603C]' },
  cocina: { tab: 'mesas', icon: 'cocina', cls: 'bg-[#FBF0DC] text-[#7A4A00]' },
  cuenta: { tab: 'mesas', icon: 'ventas', cls: 'bg-[#FBF0DC] text-[#7A4A00]' },
  reserva: { tab: 'reservas', icon: 'reservas', cls: 'bg-[#EEEAF8] text-[#4B3391]' },
}
const TABS = [
  { key: 'todas', label: 'Todas' },
  { key: 'pedidos', label: 'Pedidos' },
  { key: 'mesas', label: 'Mesas' },
  { key: 'reservas', label: 'Reservaciones' },
]

function hace(fecha) {
  if (!fecha) return ''
  const min = Math.round((Date.now() - new Date(fecha).getTime()) / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  if (min < 24 * 60) return new Date(fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  return new Date(fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

const leer = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v) } catch { return def } }
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sin storage */ } }

/**
 * Centro de notificaciones del POS (campana de la barra superior). Reemplaza a los avisos
 * sueltos de antes (panel de pedidos web, platos por recoger, píldora de reservaciones) con un
 * solo panel y un solo estilo. Cada usuario solo ve los avisos de sus secciones:
 *  - Pedidos web por aceptar (Para llevar / Órdenes): Aceptar / Rechazar con motivo.
 *  - Platillos listos de sus órdenes (Órdenes / Para llevar): "Ya los llevé".
 *  - Mesas que pidieron la cuenta (Mesas): Ver orden.
 *  - Comprobante de transferencia subido, por confirmar (Para llevar).
 *  - Reservaciones por confirmar (Mesas).
 *  - Informativos: cliente reportó un problema (24 h) y envíos a domicilio (3 h): el
 *    repartidor lo tomó, va en camino y lo entregó — estos tres también saltan.
 * Los avisos se calculan del estado actual (al atenderlos desaparecen solos). "Leído" se
 * guarda por usuario y tienda en este navegador. Lo nuevo suena (si el sonido está activo),
 * sale un aviso emergente abajo a la izquierda y, con la pestaña oculta, una notificación del
 * navegador. Todo se refresca en tiempo real (liveEvents.js).
 */
export default function NotificationCenter() {
  const navigate = useNavigate()
  const { user, hasSection } = useAuth()
  const { notify } = useNotify()
  const tiendaKey = `${user?.id ?? 'anon'}_${user?.tienda?.id ?? 'sin'}`
  const kLeidas = `pos_notif_leidas_${tiendaKey}`
  const kSonido = 'pos_notif_sonido'

  const puedePedidos = hasSection('TAKEAWAY') || hasSection('ORDERS')
  const puedeMesas = hasSection('TABLES')

  const [datos, setDatos] = useState({ web: [], pickups: [], mesas: [], llevar: [], reservas: [], reportes: [], entregados: [], tomados: [], enCamino: [], soltados: [], cuentasPorCobrar: [] })
  const [abierto, setAbierto] = useState(false)
  const [tab, setTab] = useState('todas')
  const [leidas, setLeidas] = useState(() => leer(kLeidas, {}))
  const [sonido, setSonido] = useState(() => leer(kSonido, true))
  const [toast, setToast] = useState(null)
  const [busy, setBusy] = useState(null)
  const [rechazando, setRechazando] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [, setTick] = useState(0)
  const vistosRef = useRef(null) // claves ya vistas en esta sesión (para sonar solo con lo nuevo)
  const toastTimer = useRef(null)

  useEffect(() => { setLeidas(leer(kLeidas, {})); vistosRef.current = null }, [kLeidas])
  useEffect(() => { guardar(kSonido, sonido) }, [sonido])
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t) }, [])
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
  }, [])
  useEscapeKey(() => { if (rechazando) setRechazando(null); else setAbierto(false) }, !!(abierto || rechazando))

  function load() {
    const vacio = { data: { data: [] } }
    const ok = (p) => p.catch(() => vacio)
    Promise.all([
      puedePedidos ? ok(getWebPendingOrders()) : vacio,
      puedePedidos ? ok(getPickups()) : vacio,
      puedeMesas ? ok(getTables()) : vacio,
      puedePedidos ? ok(getTakeawayOrders()) : vacio,
      puedeMesas ? ok(getReservacionesPendientes()) : vacio,
      puedePedidos ? getOrderNotices().catch(() => ({ data: { data: {} } })) : { data: { data: {} } },
    ]).then(([web, pickups, mesas, llevar, reservas, avisos]) => {
      setDatos({
        web: web.data.data ?? [], pickups: pickups.data.data ?? [], mesas: mesas.data.data ?? [],
        llevar: llevar.data.data ?? [], reservas: reservas.data.data ?? [],
        reportes: avisos.data.data?.reportes ?? [], entregados: avisos.data.data?.entregados ?? [],
        tomados: avisos.data.data?.tomados ?? [], enCamino: avisos.data.data?.enCamino ?? [],
        soltados: avisos.data.data?.soltados ?? [],
        cuentasPorCobrar: avisos.data.data?.cuentasPorCobrar ?? [],
      })
    })
  }
  useEffect(() => { load() }, [tiendaKey])
  useLiveRefresh(load, { filtro: (e) => ['orden', 'mesa', 'reservacion'].includes(e.name) })

  // ── Avisos (derivados del estado actual) ──
  const avisos = useMemo(() => {
    const out = []
    datos.web.forEach((o) => out.push({
      key: `web-${o.id}`, tipo: 'pedido', accion: true, fecha: o.openedAt,
      titulo: `Pedido web #${o.id} por aceptar`,
      detalle: [o.clienteNombre, o.tipoEntrega === 'DOMICILIO' ? 'A domicilio' : 'Para recoger', PAGO[o.metodoPago], fmt(o.total)].filter(Boolean).join(' · '),
      acciones: [
        { label: 'Aceptar', primaria: true, run: () => aceptar(o) },
        { label: 'Rechazar', run: () => { setMotivo('No podemos atender tu pedido en este momento'); setRechazando(o) } },
      ],
    }))
    datos.pickups.forEach((o) => {
      const items = o.items ?? []
      out.push({
        key: `pick-${o.id}-${items.map((i) => i.id).join('.')}`, tipo: 'cocina', accion: true,
        fecha: items.map((i) => i.entregadoCocinaAt).filter(Boolean).sort().pop(),
        titulo: `${o.mesa ? `Mesa ${o.mesa.numero}` : `Para llevar #${o.id}`}: ${items.length} platillo${items.length === 1 ? '' : 's'} listo${items.length === 1 ? '' : 's'}`,
        detalle: items.map((i) => `${Number(i.cantidad) > 1 ? `${Number(i.cantidad)}× ` : ''}${i.productoNombre}`).join(', '),
        acciones: [
          { label: o.mesa ? 'Ya los llevé' : 'Ya los entregué', primaria: true, run: () => llevado(o) },
          { label: 'Ver orden', run: () => ir(`/orders/${o.id}`) },
        ],
      })
    })
    // Caja (quien cobra): cada cuenta que se genera y falta cobrar; el cliente viene con su ticket.
    const conCuenta = new Set(datos.cuentasPorCobrar.map((c) => c.ordenId))
    datos.cuentasPorCobrar.forEach((c) => out.push({
      key: `cxc-${c.cuentaId}`, tipo: 'cobro', accion: true, fecha: c.fecha,
      titulo: `Cuenta por cobrar · ${c.lugar}`,
      detalle: [`Folio ${c.folio}`, fmt(c.total), c.generadaPor && `generó ${c.generadaPor}`].filter(Boolean).join(' · '),
      acciones: [{ label: 'Cobrar', primaria: true, run: () => ir(`/orders/${c.ordenId}`) }],
    }))
    datos.mesas.filter((m) => m.estado === 'PENDIENTE_PAGO' && m.ordenActiva && !m.unidaA && !conCuenta.has(m.ordenActiva.id)).forEach((m) => out.push({
      key: `cuenta-${m.ordenActiva.id}`, tipo: 'cuenta', accion: true, fecha: m.updatedAt,
      titulo: `Mesa ${m.numero} pidió la cuenta`,
      detalle: [m.zona?.nombre, m.ordenActiva.mesero?.name, fmt(m.ordenActiva.total)].filter(Boolean).join(' · '),
      acciones: [{ label: 'Ver orden', primaria: true, run: () => ir(`/orders/${m.ordenActiva.id}`) }],
    }))
    datos.llevar.filter((o) => o.metodoPago === 'TRANSFERENCIA' && o.comprobanteAt && o.estado !== 'PAGADA').forEach((o) => out.push({
      key: `comp-${o.id}-${o.comprobanteAt}`, tipo: 'cobro', accion: true, fecha: o.comprobanteAt,
      titulo: 'Comprobante de transferencia',
      detalle: `Pedido #${o.id} · ${o.clienteNombre ?? ''}${o.transferenciaIncluyeEnvio === false ? ' · el envío se cobra en efectivo' : ''}`,
      acciones: [{ label: 'Ver comprobante', primaria: true, run: () => ir(`/orders/${o.id}`) }],
    }))
    datos.reservas.forEach((r) => out.push({
      key: `res-${r.id}`, tipo: 'reserva', accion: true, fecha: r.createdAt,
      titulo: 'Reservación por confirmar',
      detalle: `${r.nombre} · ${r.personas} persona${r.personas === 1 ? '' : 's'} · ${new Date(r.fechaHora).toLocaleString('es-MX', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${r.accesible ? ' · mesa accesible' : ''}${r.periqueras > 0 ? ` · ${r.periqueras} periquera${r.periqueras === 1 ? '' : 's'}` : ''}`,
      acciones: [{ label: 'Revisar', primaria: true, run: () => ir('/reservaciones') }],
    }))
    datos.reportes.forEach((o) => out.push({
      key: `rep-${o.id}-${o.reporteAt}`, tipo: 'alerta', accion: false, fecha: o.reporteAt,
      titulo: o.reporteTipo === 'FALTANTE' ? 'Cliente reportó: le faltó algo' : 'Cliente reportó: llegó mal',
      detalle: `Pedido #${o.id}${o.reporteProductos ? ` · ${o.reporteProductos}` : ''}`,
      acciones: [{ label: 'Ver pedido', run: () => ir(`/orders/${o.id}`) }],
    }))
    // Envíos a domicilio: el repartidor lo tomó, va en camino y lo entregó. No piden acción,
    // pero sí saltan (sonido + aviso emergente) para que la caja sepa en qué va cada pedido.
    datos.tomados.forEach((o) => out.push({
      key: `tom-${o.id}-${o.tomadaAt}`, tipo: 'entrega', accion: false, emergente: true, fecha: o.tomadaAt,
      titulo: `${o.repartidor?.name ?? 'Un repartidor'} tomó el pedido #${o.id}`,
      detalle: [o.clienteNombre, o.direccion].filter(Boolean).join(' · '),
      acciones: [{ label: 'Ver pedido', run: () => ir(`/orders/${o.id}`) }],
    }))
    datos.enCamino.forEach((o) => out.push({
      key: `cam-${o.id}-${o.enCaminoAt}`, tipo: 'entrega', accion: false, emergente: true, fecha: o.enCaminoAt,
      titulo: `Pedido #${o.id} va en camino`,
      detalle: [o.repartidor?.name, o.clienteNombre].filter(Boolean).join(' · '),
      acciones: [{ label: 'Ver pedido', run: () => ir(`/orders/${o.id}`) }],
    }))
    // Un repartidor soltó un envío (con su motivo): vuelve a estar disponible para otro.
    datos.soltados.forEach((e) => out.push({
      key: `sol-${e.ordenId}-${e.fecha}`, tipo: 'alerta', accion: false, emergente: true, fecha: e.fecha,
      titulo: `${e.repartidor ?? 'El repartidor'} soltó el pedido #${e.ordenId}`,
      detalle: e.motivo ? `Motivo: ${e.motivo}` : 'Vuelve a estar disponible para otro repartidor',
      acciones: [{ label: 'Ver pedido', run: () => ir(`/orders/${e.ordenId}`) }],
    }))
    datos.entregados.forEach((o) => out.push({
      key: `ent-${o.id}`, tipo: 'entrega', accion: false, emergente: true, fecha: o.entregadaAt,
      titulo: `Pedido #${o.id} entregado`,
      detalle: `${o.repartidor?.name ?? 'Repartidor'} · ${o.estado === 'PAGADA' ? `cobrado ${fmt(o.total)}` : `por recibir en caja ${fmt(o.total)}`}`,
      acciones: [],
    }))
    return out.sort((a, b) => (b.accion - a.accion) || String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')))
  }, [datos])

  // Lo nuevo (no visto en esta sesión) suena y sale como aviso emergente.
  useEffect(() => {
    const claves = new Set(avisos.map((a) => a.key))
    if (vistosRef.current) {
      const nuevos = avisos.filter((a) => (a.accion || a.emergente) && !vistosRef.current.has(a.key))
      if (nuevos.length > 0) {
        const a = nuevos[0]
        setToast({ ...a, extra: nuevos.length - 1 })
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 8000)
        if (sonido) playChime()
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          try { new Notification(a.titulo, { body: a.detalle }) } catch { /* ignorar */ }
        }
      }
    }
    vistosRef.current = claves
    // Limpia de "leídas" lo que ya no existe, para no crecer sin fin.
    setLeidas((l) => {
      const n = Object.fromEntries(Object.entries(l).filter(([k]) => claves.has(k)))
      if (Object.keys(n).length !== Object.keys(l).length) guardar(kLeidas, n)
      return n
    })
  }, [avisos])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const esLeida = (a) => !!leidas[a.key]
  function marcar(keys) {
    setLeidas((l) => { const n = { ...l }; keys.forEach((k) => { n[k] = true }); guardar(kLeidas, n); return n })
  }
  function ir(ruta) { setAbierto(false); setToast(null); navigate(ruta) }

  async function aceptar(o) {
    setBusy(`web-${o.id}`)
    try { await acceptWebOrder(o.id); notify(`Pedido #${o.id} aceptado — ya está en cocina`, 'success'); load() }
    catch (err) { notify(err.response?.data?.message ?? 'No se pudo aceptar el pedido', 'error') }
    finally { setBusy(null) }
  }
  async function confirmarRechazo() {
    const o = rechazando
    setRechazando(null)
    setBusy(`web-${o.id}`)
    try { await cancelOrder(o.id, motivo.trim() || 'Pedido rechazado'); notify(`Pedido #${o.id} rechazado`, 'success'); load() }
    catch (err) { notify(err.response?.data?.message ?? 'No se pudo rechazar el pedido', 'error') }
    finally { setBusy(null) }
  }
  async function llevado(o) {
    setBusy(`pick-${o.id}`)
    try { await Promise.all((o.items ?? []).map((i) => updateOrderItemStatus(o.id, i.id, 'ENTREGADO'))); load() }
    catch (err) { notify(err.response?.data?.message ?? 'No se pudo marcar como entregado', 'error') }
    finally { setBusy(null) }
  }

  if (!puedePedidos && !puedeMesas) return null

  const sinLeer = avisos.filter((a) => !esLeida(a))
  const enTab = (a) => tab === 'todas' || TIPO[a.tipo].tab === tab
  const visibles = avisos.filter(enTab)
  const requieren = visibles.filter((a) => a.accion && !esLeida(a))
  const antes = visibles.filter((a) => !a.accion || esLeida(a))

  const Tarjeta = ({ a }) => {
    const t = TIPO[a.tipo]
    const noLeida = !esLeida(a)
    const ocupado = busy && a.key.startsWith(busy)
    return (
      <article className={`flex gap-3 p-3 rounded-2xl ${noLeida ? 'bg-[#F7F6F2]' : 'bg-white'}`}>
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${t.cls}`} aria-hidden="true">
          <Icon name={t.icon} className="w-[18px] h-[18px]" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <p className="flex-1 text-sm font-extrabold">{a.titulo}</p>
            <span className="text-xs text-gray-600 whitespace-nowrap">{hace(a.fecha)}</span>
            {noLeida && <span className="w-2 h-2 rounded-full bg-purple-600 shrink-0 self-center" aria-label="Sin leer" />}
          </div>
          {a.detalle && <p className="text-[13px] text-gray-700 mt-0.5">{a.detalle}</p>}
          {(a.acciones.length > 0 || noLeida) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {a.acciones.map((ac) => (
                <button key={ac.label} type="button" disabled={ocupado} onClick={() => { marcar([a.key]); ac.run() }}
                  className={`min-h-[36px] px-3 rounded-lg text-[13px] font-bold disabled:opacity-40 ${
                    ac.primaria ? 'bg-purple-600 text-white hover:bg-purple-700' : 'border border-[#D9D5CC] bg-white hover:bg-[#F7F6F2]'}`}>
                  {ac.label}
                </button>
              ))}
              {noLeida && !a.accion && (
                <button type="button" onClick={() => marcar([a.key])} className="text-[13px] font-semibold text-gray-600 hover:underline px-1">Marcar como leída</button>
              )}
            </div>
          )}
        </div>
      </article>
    )
  }

  return (
    <>
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}
        aria-label={`Notificaciones (${sinLeer.length} sin leer)`}
        className="relative w-11 h-11 rounded-xl border border-[#D9D5CC] bg-white text-gray-700 flex items-center justify-center hover:text-purple-700 hover:border-purple-300">
        <Icon name="campana" className="w-5 h-5" />
        {sinLeer.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-red-700 text-white text-[11px] font-extrabold flex items-center justify-center border-2 border-[#F4F3EF]">
            {sinLeer.length > 99 ? '99+' : sinLeer.length}
          </span>
        )}
      </button>

      {abierto && (
        <div className="fixed inset-0 z-[90]">
          <div className="absolute inset-0 bg-black/25" onClick={() => setAbierto(false)} />
          <aside aria-label="Notificaciones" className="absolute top-0 right-0 bottom-0 w-[440px] max-w-full bg-white border-l border-[#E4E1DA] shadow-2xl flex flex-col">
            <div className="px-5 pt-5 pb-3 border-b border-[#ECE9E2] space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="flex-1 text-xl font-extrabold">Notificaciones</h2>
                {sinLeer.length > 0 && (
                  <button type="button" onClick={() => marcar(avisos.map((a) => a.key))} className="text-[13px] font-extrabold text-purple-700 hover:underline px-1 py-2">
                    Marcar todo como leído
                  </button>
                )}
                <button type="button" onClick={() => setAbierto(false)} aria-label="Cerrar notificaciones"
                  className="w-9 h-9 rounded-xl bg-[#F1EFEA] text-gray-700 flex items-center justify-center text-lg">×</button>
              </div>
              <div className="flex flex-wrap gap-1.5" aria-label="Filtrar notificaciones">
                {TABS.filter((t) => t.key === 'todas' || (t.key === 'reservas' ? puedeMesas : t.key === 'mesas' ? (puedeMesas || puedePedidos) : puedePedidos)).map((t) => {
                  const n = avisos.filter((a) => (t.key === 'todas' || TIPO[a.tipo].tab === t.key) && !esLeida(a)).length
                  return (
                    <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => setTab(t.key)}
                      className={`chip !min-h-[36px] !text-[13px] ${tab === t.key ? 'chip-on' : ''}`}>
                      {t.label} <span className="opacity-70">{n}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pt-2 pb-5">
              {requieren.length > 0 && <p className="px-2 pt-2 pb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-600">Requieren acción</p>}
              {requieren.map((a) => <Tarjeta key={a.key} a={a} />)}
              {antes.length > 0 && <p className="px-2 pt-3 pb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-600">Antes</p>}
              {antes.map((a) => <Tarjeta key={a.key} a={a} />)}
              {visibles.length === 0 && <p className="text-center text-sm text-gray-600 py-12">Nada por aquí.</p>}
            </div>

            <div className="px-5 py-3 border-t border-[#ECE9E2] flex items-center gap-3 text-[13px] text-gray-700">
              <Icon name="sonido" className="w-[18px] h-[18px]" />
              <span className="flex-1">Sonido al llegar algo que requiere acción</span>
              <button type="button" role="switch" aria-checked={sonido} aria-label="Sonido" onClick={() => setSonido((s) => !s)}
                className={`w-11 h-[26px] rounded-full p-[3px] flex ${sonido ? 'bg-purple-600 justify-end' : 'bg-[#CFCAC0] justify-start'}`}>
                <span className="w-5 h-5 rounded-full bg-white block" />
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Aviso emergente: lo nuevo, abajo a la izquierda, se va solo en 8 s. */}
      {toast && !abierto && (
        <div role="status" className="fixed left-4 lg:left-[264px] bottom-4 z-[95] w-[380px] max-w-[calc(100vw-2rem)] rounded-2xl bg-gray-900 text-white px-4 py-3.5 flex items-start gap-3 shadow-2xl">
          <span className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0" aria-hidden="true">
            <Icon name={TIPO[toast.tipo].icon} className="w-[18px] h-[18px]" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold">{toast.titulo}</p>
            <p className="text-[13px] text-gray-300 truncate">{toast.detalle}</p>
            {toast.extra > 0 && <p className="text-xs text-gray-400 mt-0.5">y {toast.extra} aviso{toast.extra === 1 ? '' : 's'} más</p>}
          </div>
          <button type="button" onClick={() => { setToast(null); setAbierto(true) }} className="text-[13px] font-extrabold text-purple-200 hover:text-white py-1.5">Ver</button>
          <button type="button" onClick={() => setToast(null)} aria-label="Cerrar aviso" className="text-gray-400 hover:text-white text-lg leading-none py-1">×</button>
        </div>
      )}

      {rechazando && (
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={() => setRechazando(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold">Rechazar pedido #{rechazando.id}</h3>
            <label htmlFor="notif-motivo" className="block text-xs font-semibold text-gray-700 mt-3 mb-1">Motivo ({rechazando.clienteNombre} lo verá en su página)</label>
            <textarea id="notif-motivo" className="input" rows={3} maxLength={255} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" className="btn-secondary" onClick={() => setRechazando(null)}>Volver</button>
              <button type="button" className="btn-danger" onClick={confirmarRechazo}>Rechazar pedido</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
