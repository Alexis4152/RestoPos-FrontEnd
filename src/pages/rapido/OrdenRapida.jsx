import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getOrder, addOrderItem, addDiner, updateOrderItemStatus } from '../../api/ordenes'
import { getAccountsByOrder } from '../../api/cuentas'
import { getCategories } from '../../api/categories'
import { searchProducts, getTopSellingProducts } from '../../api/products'
import { getTables } from '../../api/mesas'
import { useNotify } from '../../context/NotifyContext'
import { useLiveRefresh } from '../../utils/liveEvents'
import Icon from '../../components/Icon'
import { resolveMediaUrl } from '../../utils/media'
import { admiteModoRapido } from '../../utils/modoToma'
import { leerPorEnviar, guardarPorEnviar } from '../../utils/porEnviar'
import SelectorModoToma from '../../components/SelectorModoToma'
import { etiquetaTipoPedido } from '../../utils/tipoPedido'
import OrderDetail from '../OrderDetail'
import OpcionesSheet, { gruposActivos } from './OpcionesSheet'
import CuentaRapida, { CobroExitoso } from './CuentaRapida'
import { nombreMesa } from './MisMesas'
import EditarLineaSheet from './EditarLineaSheet'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const EN_COCINA = ['PENDIENTE', 'PREPARANDO']
const LISTO = ['LISTO', 'ENTREGADO_MESERO']

function minutos(desde) {
  if (!desde) return ''
  const m = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

// La comanda por enviar se guarda por orden en esta pestaña: si el mesero sale sin querer, no la pierde.
// La comanda por enviar es el mismo borrador que "Por enviar a cocina" de la vista detallada.
const leerBorrador = (id) => leerPorEnviar(id)
const guardarBorrador = (id, lineas) => guardarPorEnviar(id, lineas, 'nota')
const claveLinea = (l) => [l.productoId, l.comensalId ?? '', [...(l.opcionIds ?? [])].sort().join('.'), l.nota ?? ''].join('|')

/**
 * Modo rápido · orden de una mesa en una sola pantalla:
 *  - Pedir: menú directo ("Lo más pedido" primero), tocar un platillo suma uno a la comanda;
 *    "¿Para quién?" se queda elegido ("Para la mesa" por default); los platillos con opciones
 *    abren OpcionesSheet con lo más pedido ya marcado; "Enviar a cocina" manda todo junto.
 *  - Lo pedido: lo ya enviado por estado, con "Ya los llevé" para lo que cocina terminó.
 *  - Cuenta: CuentaRapida (entregar y cobrar en un paso).
 * Editar o cancelar productos, dividir la cuenta, mover/unir mesas: "Vista detallada"
 * (?vista=detalle), que es OrderDetail sobre la misma orden. Órdenes sin mesa o ya cerradas
 * se muestran siempre en la vista detallada.
 */
export default function OrdenRapida() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { notify } = useNotify()
  const [order, setOrder] = useState(null)
  const [cuentas, setCuentas] = useState([])
  const [mesasUnidas, setMesasUnidas] = useState([])
  const [categorias, setCategorias] = useState([])
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [productos, setProductos] = useState([])
  const [paraQuien, setParaQuien] = useState(null) // comensalId o null = para la mesa
  const [comanda, setComanda] = useState(() => leerBorrador(id))
  const [anteriores, setAnteriores] = useState({}) // productoId -> última selección de opciones
  const [opciones, setOpciones] = useState(null) // producto en OpcionesSheet
  const [verComanda, setVerComanda] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editando, setEditando] = useState(null) // línea ya enviada que se está editando
  const [cobro, setCobro] = useState(null)
  // Cómo se ven los platillos: 'list' (tarjetas de texto) o 'images' (con foto). Es una
  // preferencia de este dispositivo, igual que en el punto de venta de DemoPV.
  const [vistaProd, setVistaProd] = useState(() => {
    try { return localStorage.getItem('restopos-rapido-vista') === 'images' ? 'images' : 'list' } catch { return 'list' }
  })
  function cambiarVista(v) {
    setVistaProd(v)
    try { localStorage.setItem('restopos-rapido-vista', v) } catch { /* sin almacenamiento */ }
  } // al cobrar: { cuentaId, mesa, total, cambio }

  function load() {
    getOrder(id).then((r) => setOrder(r.data.data)).catch(() => notify('No se pudo cargar la orden', 'error'))
    getAccountsByOrder(id).then((r) => setCuentas(r.data.data ?? [])).catch(() => setCuentas([]))
    getTables().then((r) => setMesasUnidas((r.data.data ?? []).filter((m) => m.unidaA && m.ordenActiva?.id === Number(id)))).catch(() => {})
  }
  useEffect(() => { load(); setComanda(leerBorrador(id)) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id])
  useEffect(() => { getCategories().then((r) => setCategorias(r.data.data ?? [])).catch(() => {}) }, [])
  useLiveRefresh(load, { filtro: (e) => e.name === 'orden' })
  useEffect(() => { guardarBorrador(id, comanda) }, [id, comanda])

  useEffect(() => {
    const t = setTimeout(() => {
      const pedir = q.trim()
        ? searchProducts({ q: q.trim(), categoryId: cat || undefined, size: 60 })
        : getTopSellingProducts({ categoryId: cat || undefined, limit: cat ? 60 : 24 })
      pedir.then((r) => setProductos((r.data.data ?? []).filter((p) => p.disponible !== false && p.isActive !== false && p.category?.availableNow !== false)))
        .catch(() => setProductos([]))
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [q, cat])

  const items = useMemo(() => (order?.items ?? []).filter((i) => i.estado !== 'CANCELADO' && !i.cargoExtra), [order])
  const piezasPorProducto = useMemo(() => {
    const out = {}
    comanda.forEach((l) => { out[l.productoId] = (out[l.productoId] ?? 0) + l.cantidad })
    return out
  }, [comanda])

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
  // Límite de personas: lugares de la mesa y las unidas (los captura el admin); null = sin límite.
  const esMesa = !!order.mesa
  const conPersonas = esMesa || order.tipoEntrega === 'COMER_AQUI'
  const paraTodos = esMesa ? 'Para la mesa' : 'Compartido'
  const cupo = esMesa && [order.mesa, ...mesasUnidas].every((m) => m.capacidad > 0)
    ? [order.mesa, ...mesasUnidas].reduce((s, m) => s + m.capacidad, 0) : null
  const mesaLlena = cupo != null && comensales.length >= cupo
  const nombreComensal = (cid) => {
    const c = comensales.find((x) => x.id === cid)
    return c ? (c.nombre || `Persona ${c.numero}`) : paraTodos
  }

  function agregarLinea(linea) {
    const l = { ...linea, comensalId: paraQuien }
    const k = claveLinea(l)
    setComanda((c) => {
      const i = c.findIndex((x) => claveLinea(x) === k)
      if (i >= 0) return c.map((x, j) => (j === i ? { ...x, cantidad: x.cantidad + l.cantidad } : x))
      return [...c, l]
    })
    if (linea.opcionIds?.length || linea.nota) {
      setAnteriores((a) => ({ ...a, [linea.productoId]: { unitario: linea.precio, ids: linea.opcionIds, resumen: linea.resumen, nota: linea.nota } }))
    }
  }

  function tocarProducto(p) {
    if (gruposActivos(p).length > 0) { setOpciones(p); return }
    agregarLinea({ productoId: p.id, nombre: p.name, precio: Number(p.price), cantidad: 1, opcionIds: [], resumen: '', nota: '' })
  }

  const cambiarCantidad = (k, delta) => setComanda((c) => c
    .map((x) => (claveLinea(x) === k ? { ...x, cantidad: x.cantidad + delta } : x))
    .filter((x) => x.cantidad > 0))

  async function nuevoComensal() {
    try {
      const r = await addDiner(id, {})
      setParaQuien(r.data.data?.id ?? null)
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo agregar', 'error') }
  }

  async function enviar() {
    setEnviando(true)
    let pendientes = [...comanda]
    try {
      while (pendientes.length) {
        const l = pendientes[0]
        await addOrderItem(id, {
          productoId: l.productoId,
          comensalId: l.comensalId ?? null,
          cantidad: l.cantidad,
          observaciones: l.nota || undefined,
          modificadorOpcionIds: l.opcionIds?.length ? l.opcionIds : undefined,
        })
        pendientes = pendientes.slice(1)
      }
      notify('Enviado a cocina', 'success')
      setVerComanda(false)
    } catch (err) {
      notify(`${err.response?.data?.message ?? 'No se pudo enviar'}${pendientes.length < comanda.length ? ' (lo anterior sí se envió)' : ''}`, 'error')
    } finally {
      setComanda(pendientes)
      setEnviando(false)
      load()
    }
  }

  async function yaLosLleve(lista) {
    setBusy(true)
    try {
      for (const i of lista) await updateOrderItemStatus(id, i.id, 'ENTREGADO')
      notify('Marcados como entregados', 'success')
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudieron marcar', 'error') }
    finally { setBusy(false); load() }
  }

  /** Lista editable de la comanda por enviar (barra de abajo en celular, columna derecha en escritorio). */
  const listaComanda = (alto) => (
    <ul className={`${alto} overflow-y-auto divide-y divide-[#ECE9E2]`} aria-label="Comanda por enviar">
      {comanda.map((l) => {
        const k = claveLinea(l)
        return (
          <li key={k} className="flex items-center gap-2 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{l.nombre}</p>
              <p className="text-xs text-gray-600 truncate">{[nombreComensal(l.comensalId), l.resumen, l.nota].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex items-center rounded-xl border border-[#D9D5CC]">
              <button type="button" aria-label={`Quitar uno de ${l.nombre}`} onClick={() => cambiarCantidad(k, -1)} className="w-10 h-10 text-lg font-extrabold">−</button>
              <span className="w-6 text-center text-sm font-extrabold">{l.cantidad}</span>
              <button type="button" aria-label={`Agregar uno de ${l.nombre}`} onClick={() => cambiarCantidad(k, 1)} className="w-10 h-10 text-lg font-extrabold">+</button>
            </div>
          </li>
        )
      })}
    </ul>
  )

  const piezasComanda = comanda.reduce((s, l) => s + l.cantidad, 0)
  const totalComanda = comanda.reduce((s, l) => s + l.precio * l.cantidad, 0)
  const enCocina = items.filter((i) => EN_COCINA.includes(i.estado))
  const listos = items.filter((i) => LISTO.includes(i.estado))
  const entregados = items.filter((i) => i.estado === 'ENTREGADO')
  const TABS = [['pedir', 'Pedir'], ['pedido', `Lo pedido (${items.length})`], ['cuenta', 'Cuenta']]
  const resumenItem = (i) => [(i.modificadores ?? []).map((m) => m.nombre).join(' · '), i.observaciones].filter(Boolean).join(' · ')

  return (
    <div className={`max-w-6xl space-y-4 ${ver === 'pedir' && piezasComanda > 0 ? 'pb-36 lg:pb-0' : ''}`}>
      <header className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate(esMesa ? '/tables' : '/takeaway')} aria-label={esMesa ? 'Volver a mis mesas' : 'Volver a Para llevar'}
          className="w-11 h-11 rounded-full border border-[#E4E1DA] bg-white flex items-center justify-center">
          <Icon name="atras" className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-[160px]">
          <h1 className="text-2xl font-extrabold tracking-tight">
            {esMesa ? nombreMesa([order.mesa.numero, ...mesasUnidas.map((m) => m.numero)].join(' + ')) : `${etiquetaTipoPedido(order)} · ${order.clienteNombre ?? `#${order.id}`}`}
          </h1>
          <p className="text-sm text-gray-600">
            {conPersonas ? `${order.numeroComensales} persona${order.numeroComensales === 1 ? '' : 's'}` : `Pedido #${order.id}`} · {minutos(order.openedAt)} · {fmt(order.total)}
          </p>
        </div>
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

      {ver === 'pedir' && (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5 lg:items-start">
        <div className="space-y-3">
          {conPersonas && <div>
            <p className="text-xs font-bold text-gray-600 mb-1.5">¿Para quién? Se queda elegido mientras agregas</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={paraQuien === null} onClick={() => setParaQuien(null)}
                className={`chip ${paraQuien === null ? 'chip-on' : ''}`}>{paraTodos}</button>
              {comensales.map((c) => (
                <button key={c.id} type="button" aria-pressed={paraQuien === c.id} onClick={() => setParaQuien(c.id)}
                  className={`chip min-w-[44px] justify-center ${paraQuien === c.id ? 'chip-on' : ''}`}>{c.nombre || c.numero}</button>
              ))}
              <button type="button" onClick={nuevoComensal} disabled={mesaLlena} aria-label="Agregar persona"
                title={mesaLlena ? `La mesa es para ${cupo} personas: une otra mesa para agregar más` : undefined}
                className="chip border-dashed min-w-[44px] justify-center disabled:opacity-40">+</button>
            </div>
          </div>}

          <label className="flex items-center gap-2 min-h-[44px] px-3 rounded-2xl border border-[#D9D5CC] bg-white">
            <Icon name="buscar" className="w-[18px] h-[18px] text-gray-600" />
            <span className="sr-only">Buscar platillo</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca: “enchi”, “café”…"
              className="flex-1 min-w-0 bg-transparent outline-none text-[15px] font-semibold" />
          </label>

          <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" aria-label="Categorías">
            <button type="button" aria-pressed={!cat} onClick={() => setCat('')}
              className={`shrink-0 min-h-[36px] px-3 rounded-full text-[13px] font-bold border ${!cat ? 'border-purple-600 bg-purple-50 text-purple-800' : 'border-[#D9D5CC] bg-white text-gray-700'}`}>
              Lo más pedido
            </button>
            {categorias.filter((c) => c.availableNow !== false).map((c) => (
              <button key={c.id} type="button" aria-pressed={String(cat) === String(c.id)} onClick={() => setCat(String(c.id))}
                className={`shrink-0 min-h-[36px] px-3 rounded-full text-[13px] font-bold border ${String(cat) === String(c.id) ? 'border-purple-600 bg-purple-50 text-purple-800' : 'border-[#D9D5CC] bg-white text-gray-700'}`}>
                {c.name}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-full bg-[#ECEAE4] p-1 shrink-0" role="radiogroup" aria-label="Vista de platillos">
            {[['list', 'Lista'], ['images', 'Imágenes']].map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={vistaProd === v} onClick={() => cambiarVista(v)}
                className={`min-h-[32px] px-3 rounded-full text-xs font-bold ${vistaProd === v ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}>
                {label}
              </button>
            ))}
          </div>
          </div>

          <div className={`grid gap-2.5 ${vistaProd === 'images' ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {productos.map((p) => {
              const n = piezasPorProducto[p.id] ?? 0
              const conOpciones = gruposActivos(p).length > 0
              const etiqueta = p.sinInventario
                ? <span className="text-[12px] font-bold text-red-700">Sin inventario</span>
                : p.controlaInventario && p.stock <= 5 && <span className="text-[12px] font-bold text-[#7A4A00]">Quedan {p.stock}</span>
              const contador = n > 0 && (
                <span className="absolute top-2 right-2 min-w-[26px] h-[26px] px-1 rounded-full bg-purple-600 text-white text-[13px] font-extrabold flex items-center justify-center">{n}</span>
              )
              if (vistaProd === 'images') {
                return (
                  <button key={p.id} type="button" onClick={() => tocarProducto(p)} disabled={p.sinInventario}
                    className={`relative text-left rounded-2xl bg-white overflow-hidden flex flex-col disabled:opacity-60 disabled:cursor-not-allowed ${n ? 'border-2 border-purple-600' : 'border border-[#E4E1DA] hover:border-purple-300'}`}>
                    <span className="aspect-square bg-[#F1EFEA] flex items-center justify-center overflow-hidden">
                      {p.imageUrl
                        ? <img src={resolveMediaUrl(p.imageUrl)} alt="" className="w-full h-full object-cover"
                            onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                        : <Icon name="menu" className="w-8 h-8 text-gray-400" />}
                    </span>
                    <span className="p-2.5 flex flex-col gap-0.5">
                      <span className="text-[14px] font-extrabold leading-tight line-clamp-2">{p.name}</span>
                      <span className="text-[13px] font-bold text-gray-600">{fmt(p.price)}{conOpciones ? ' · opciones' : ''}</span>
                      {etiqueta}
                    </span>
                    {contador}
                  </button>
                )
              }
              return (
                <button key={p.id} type="button" onClick={() => tocarProducto(p)} disabled={p.sinInventario}
                  className={`relative min-h-[84px] text-left p-3 rounded-2xl bg-white flex flex-col justify-between gap-1 disabled:opacity-60 disabled:cursor-not-allowed ${n ? 'border-2 border-purple-600' : 'border border-[#E4E1DA] hover:border-purple-300'}`}>
                  <span className="text-[15px] font-extrabold leading-tight pr-7">{p.name}</span>
                  <span className="text-[13px] font-bold text-gray-600">{fmt(p.price)}{conOpciones ? ' · opciones' : ''}</span>
                  {etiqueta}
                  {contador}
                </button>
              )
            })}
            {productos.length === 0 && <p className="col-span-full text-center text-sm text-gray-600 py-8">Sin platillos {q ? `para “${q}”` : 'en esta categoría'}.</p>}
          </div>
        </div>

        <aside aria-label="Comanda" className="hidden lg:block lg:sticky lg:top-4 bg-white border border-[#E4E1DA] rounded-2xl p-4 space-y-3">
          <h2 className="text-base font-extrabold">Comanda por enviar</h2>
          {comanda.length === 0
            ? <p className="text-sm text-gray-600 py-4">Toca los platillos para armarla. Se envía todo junto a cocina.</p>
            : listaComanda('max-h-[55vh]')}
          <button type="button" disabled={enviando || comanda.length === 0} onClick={enviar}
            className="w-full min-h-[54px] rounded-2xl bg-purple-600 hover:bg-purple-700 text-white text-base font-extrabold flex items-center justify-between px-5 disabled:opacity-50">
            <span>{enviando ? 'Enviando…' : 'Enviar a cocina'}</span><span>{fmt(totalComanda)}</span>
          </button>
        </aside>
        </div>
      )}

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
                <button key={i.id} type="button" onClick={() => setEditando(i)} aria-label={`Editar ${i.productoNombre}`}
                  className="w-full flex gap-3 text-sm text-left rounded-xl -mx-2 px-2 py-1.5 hover:bg-[#F7F6F2]">
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
              ))}
            </section>
          ))}
          {items.length > 0 && <p className="text-xs text-gray-600 text-center">Toca un platillo para cambiarlo o quitarlo. Si cocina ya lo está preparando, avísales.</p>}
        </div>
      )}

      {ver === 'cuenta' && (
        <div className="max-w-3xl"><CuentaRapida order={order} cuentas={cuentas} vistaDetallada={vistaDetallada} onCambio={load} onCobrada={(c) => { setCobro(c); load() }} /></div>
      )}

      {ver === 'pedir' && piezasComanda > 0 && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#E4E1DA] px-4 pt-3 pb-4 space-y-2">
          {verComanda && listaComanda('max-h-[40vh]')}
          <div className="flex items-center justify-between text-[13px] text-gray-700 gap-2">
            <span className="truncate"><b>{piezasComanda} por enviar:</b> {comanda.map((l) => `${l.cantidad} ${l.nombre}`).join(', ')}</span>
            <button type="button" onClick={() => setVerComanda((v) => !v)} aria-expanded={verComanda} className="font-bold text-purple-700 shrink-0 min-h-[32px]">
              {verComanda ? 'Ocultar' : 'Ver / editar'}
            </button>
          </div>
          <button type="button" disabled={enviando} onClick={enviar}
            className="w-full min-h-[54px] rounded-2xl bg-purple-600 hover:bg-purple-700 text-white text-base font-extrabold flex items-center justify-between px-5 disabled:opacity-50">
            <span>{enviando ? 'Enviando…' : 'Enviar a cocina'}</span><span>{fmt(totalComanda)}</span>
          </button>
        </div>
      )}

      {editando && (
        <EditarLineaSheet ordenId={id} item={editando} comensales={comensales} onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); load() }} />
      )}

      {opciones && (
        <OpcionesSheet producto={opciones} anterior={anteriores[opciones.id]} onCerrar={() => setOpciones(null)}
          onAgregar={(l) => { agregarLinea(l); setOpciones(null) }} />
      )}
    </div>
  )
}
