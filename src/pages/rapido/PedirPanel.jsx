import { useEffect, useMemo, useState } from 'react'
import { addOrderItem, addDiner } from '../../api/ordenes'
import { getCategories } from '../../api/categories'
import { searchProducts, getTopSellingProducts } from '../../api/products'
import { useNotify } from '../../context/NotifyContext'
import { useAuth } from '../../context/AuthContext'
import { crearComanda } from '../../api/comandas'
import Icon from '../../components/Icon'
import { resolveMediaUrl } from '../../utils/media'
import { leerPorEnviar, guardarPorEnviar } from '../../utils/porEnviar'
import OpcionesSheet, { gruposActivos } from './OpcionesSheet'
import { BotonLocal, alternarLocal, useConsumoLocal } from '../../utils/consumoLocal'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)

// La comanda por enviar se guarda por orden en esta pestaña: si el mesero sale sin querer, no la pierde.
// Es el mismo borrador que "Por enviar a cocina" de la vista detallada, y el mismo entre el modal
// de Mis mesas y la pantalla completa: pasar de uno a otro no pierde lo armado.
const leerBorrador = (id) => leerPorEnviar(id)
const guardarBorrador = (id, lineas) => guardarPorEnviar(id, lineas, 'nota')
const claveLinea = (l) => [l.productoId, l.comensalId ?? '', [...(l.opcionIds ?? [])].sort().join('.'), l.nota ?? '',
  l.consumoLocal ? 'L' : ''].join('|')

/**
 * Modo rápido · "Pedir": menú directo ("Lo más pedido" primero), tocar un platillo suma uno a la
 * comanda; "¿Para quién?" se queda elegido ("Para la mesa" por default); los platillos con opciones
 * abren OpcionesSheet con lo más pedido ya marcado; "Enviar a cocina" manda todo junto.
 *
 * Lo usan OrdenRapida (pantalla completa) y el modal de Mis mesas (`enModal`): en el modal la
 * comanda va siempre en una barra fija al pie del modal, en vez de la columna derecha.
 * `onEnviado` se llama tras enviar a cocina sin errores.
 */
export default function PedirPanel({ order, mesasUnidas = [], onCambio, onEnviado, enModal = false }) {
  const id = String(order.id)
  const { notify, confirmDialog } = useNotify()
  const consumo = useConsumoLocal(order) // consumo local: +$ por pieza en platillos marcados
  const { user } = useAuth()
  // "Enviar a cocina" (impresora de cocina) o "Crear orden" (impresora de tickets): por tienda.
  const aCocina = user?.tienda?.enviarACocina !== false
  const textoEnviar = aCocina ? 'Enviar a cocina' : 'Crear orden'
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
  // Cómo se ven los platillos: 'list' (tarjetas de texto) o 'images' (con foto). Es una
  // preferencia de este dispositivo, igual que en el punto de venta de DemoPV.
  const [vistaProd, setVistaProd] = useState(() => {
    try { return localStorage.getItem('restopos-rapido-vista') === 'images' ? 'images' : 'list' } catch { return 'list' }
  })
  function cambiarVista(v) {
    setVistaProd(v)
    try { localStorage.setItem('restopos-rapido-vista', v) } catch { /* sin almacenamiento */ }
  }

  useEffect(() => { setComanda(leerBorrador(id)) }, [id])
  useEffect(() => { getCategories().then((r) => setCategorias(r.data.data ?? [])).catch(() => {}) }, [])
  useEffect(() => { guardarBorrador(id, comanda) }, [id, comanda])

  useEffect(() => {
    const t = setTimeout(() => {
      const pedir = q.trim()
        // paraOrdenar: solo lo del menú de hoy (si la tienda tiene uno).
        ? searchProducts({ q: q.trim(), categoryId: cat || undefined, size: 60, paraOrdenar: true })
        : getTopSellingProducts({ categoryId: cat || undefined, limit: cat ? 60 : 24, paraOrdenar: true })
      pedir.then((r) => setProductos((r.data.data ?? []).filter((p) => p.disponible !== false && p.isActive !== false && p.category?.availableNow !== false)))
        .catch(() => setProductos([]))
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [q, cat])

  const piezasPorProducto = useMemo(() => {
    const out = {}
    comanda.forEach((l) => { out[l.productoId] = (out[l.productoId] ?? 0) + l.cantidad })
    return out
  }, [comanda])

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
      setAnteriores((a) => ({ ...a, [linea.productoId]: { unitario: linea.precio, ids: linea.opcionIds, resumen: linea.resumen, nota: linea.nota,
        consumoLocal: linea.consumoLocal } }))
    }
  }

  function tocarProducto(p) {
    if (gruposActivos(p).length > 0) { setOpciones(p); return }
    const local = consumo.porDefecto(p)
    agregarLinea({ productoId: p.id, nombre: p.name, precio: Number(p.price) + (local ? consumo.monto : 0), cantidad: 1, opcionIds: [],
      resumen: '', nota: '', consumoLocal: local, aplicaLocal: consumo.aplica(p) })
  }

  const cambiarCantidad = (k, delta) => setComanda((c) => c
    .map((x) => (claveLinea(x) === k ? { ...x, cantidad: x.cantidad + delta } : x))
    .filter((x) => x.cantidad > 0))

  async function nuevoComensal() {
    try {
      const r = await addDiner(id, {})
      setParaQuien(r.data.data?.id ?? null)
      onCambio?.()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo agregar', 'error') }
  }

  async function enviar() {
    setEnviando(true)
    let pendientes = [...comanda]
    const enviados = []
    try {
      while (pendientes.length) {
        const l = pendientes[0]
        const r = await addOrderItem(id, {
          productoId: l.productoId,
          comensalId: l.comensalId ?? null,
          cantidad: l.cantidad,
          observaciones: l.nota || undefined,
          modificadorOpcionIds: l.opcionIds?.length ? l.opcionIds : undefined,
          consumoLocal: !!l.consumoLocal,
        })
        if (r.data.data?.id) enviados.push(r.data.data.id)
        pendientes = pendientes.slice(1)
      }
      notify(aCocina ? 'Enviado a cocina' : 'Orden creada', 'success')
      setVerComanda(false)
      onEnviado?.()
    } catch (err) {
      notify(`${err.response?.data?.message ?? 'No se pudo enviar'}${pendientes.length < comanda.length ? ' (lo anterior sí se envió)' : ''}`, 'error')
    } finally {
      // La comanda impresa (cocina o tickets, según la tienda) la saca la estación de impresión.
      if (enviados.length) crearComanda(id, enviados).catch(() => notify('Se guardó, pero no se pudo mandar a imprimir la comanda', 'error'))
      setComanda(pendientes)
      setEnviando(false)
      onCambio?.()
    }
  }

  /** Lista editable de la comanda por enviar (barra de abajo en celular/modal, columna derecha en escritorio). */
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
            {l.aplicaLocal && consumo.activo && (
              <BotonLocal on={!!l.consumoLocal} monto={consumo.monto}
                onClick={() => setComanda((c) => alternarLocal(c, k, claveLinea, consumo.monto))} />
            )}
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

  /** Descartar lo que aún no se envía a cocina (igual que en la vista detallada). */
  async function descartar() {
    if (await confirmDialog('¿Descartar lo que no se ha enviado a cocina?', { confirmText: 'Descartar' })) {
      setComanda([])
      setVerComanda(false)
    }
  }
  const botonDescartar = (
    <button type="button" disabled={enviando || comanda.length === 0} onClick={descartar}
      className="min-h-[54px] px-4 rounded-2xl border border-[#D9D5CC] bg-white text-gray-800 text-sm font-extrabold disabled:opacity-50">
      Descartar
    </button>
  )

  const barraEnviar = piezasComanda > 0 && (
    <div className={enModal
      ? 'sticky bottom-0 -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 mt-3 bg-white border-t border-[#E4E1DA] px-4 sm:px-5 pt-3 pb-4 space-y-2'
      : 'lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#E4E1DA] px-4 pt-3 pb-4 space-y-2'}>
      {verComanda && listaComanda('max-h-[40vh]')}
      <div className="flex items-center justify-between text-[13px] text-gray-700 gap-2">
        <span className="truncate"><b>{piezasComanda} por enviar:</b> {comanda.map((l) => `${l.cantidad} ${l.nombre}`).join(', ')}</span>
        <button type="button" onClick={() => setVerComanda((v) => !v)} aria-expanded={verComanda} className="font-bold text-purple-700 shrink-0 min-h-[32px]">
          {verComanda ? 'Ocultar' : 'Ver / editar'}
        </button>
      </div>
      <div className="flex gap-2">
        {botonDescartar}
        <button type="button" disabled={enviando} onClick={enviar}
          className="flex-1 min-h-[54px] rounded-2xl bg-purple-600 hover:bg-purple-700 text-white text-base font-extrabold flex items-center justify-between px-5 disabled:opacity-50">
          <span>{enviando ? 'Enviando…' : textoEnviar}</span><span>{fmt(totalComanda)}</span>
        </button>
      </div>
    </div>
  )

  return (
    <>
      <div className={enModal ? '' : `lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5 lg:items-start ${piezasComanda > 0 ? 'pb-36 lg:pb-0' : ''}`}>
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

          {/* Categorías en su propia fila (se recorren completas) y debajo, a la derecha, cómo ver los platillos. */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" aria-label="Categorías">
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
          <div className="flex gap-1 rounded-full bg-[#ECEAE4] p-1 w-fit ml-auto -mt-1" role="radiogroup" aria-label="Vista de platillos">
            {[['list', 'Lista'], ['images', 'Imágenes']].map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={vistaProd === v} onClick={() => cambiarVista(v)}
                className={`min-h-[32px] px-3 rounded-full text-xs font-bold ${vistaProd === v ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}>
                {label}
              </button>
            ))}
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

        {!enModal && (
          <aside aria-label="Comanda" className="hidden lg:block lg:sticky lg:top-4 bg-white border border-[#E4E1DA] rounded-2xl p-4 space-y-3">
            <h2 className="text-base font-extrabold">Comanda por enviar</h2>
            {comanda.length === 0
              ? <p className="text-sm text-gray-600 py-4">Toca los platillos para armarla. Se envía todo junto a cocina.</p>
              : listaComanda('max-h-[55vh]')}
            <div className="flex gap-2">
              {botonDescartar}
              <button type="button" disabled={enviando || comanda.length === 0} onClick={enviar}
                className="flex-1 min-h-[54px] rounded-2xl bg-purple-600 hover:bg-purple-700 text-white text-base font-extrabold flex items-center justify-between px-5 disabled:opacity-50">
                <span>{enviando ? 'Enviando…' : textoEnviar}</span><span>{fmt(totalComanda)}</span>
              </button>
            </div>
          </aside>
        )}
      </div>

      {barraEnviar}

      {opciones && (
        <OpcionesSheet producto={opciones} anterior={anteriores[opciones.id]} consumo={consumo} onCerrar={() => setOpciones(null)}
          onAgregar={(l) => { agregarLinea(l); setOpciones(null) }} />
      )}
    </>
  )
}
