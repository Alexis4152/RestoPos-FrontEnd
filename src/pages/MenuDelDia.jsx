import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getProducts } from '../api/products'
import { getCategories } from '../api/categories'
import { getMenus, createMenu, updateMenu, deleteMenu, usarMenuHoy, quitarMenuHoy } from '../api/menus'
import { useNotify } from '../context/NotifyContext'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { resolveMediaUrl } from '../utils/media'
import Icon from '../components/Icon'
import IconButton from '../components/IconButton'
import MenuHoja, { HojaEscalada, PLANTILLAS, plantillaGuardada, guardarPlantilla } from '../components/MenuHoja'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'

import ModalCloseButton from '../components/ModalCloseButton'
const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const mismos = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))
const SIN_CATEGORIA = 'sin'

/** Agrupa platillos por categoría, en el orden de las categorías de la tienda. */
function agrupar(lista, categorias) {
  const orden = new Map(categorias.map((c, i) => [c.id, i]))
  const out = new Map()
  lista.forEach((p) => {
    const k = p.category?.id ?? SIN_CATEGORIA
    if (!out.has(k)) out.set(k, { id: k, nombre: p.category?.name ?? 'Sin categoría', platillos: [] })
    out.get(k).platillos.push(p)
  })
  return [...out.values()].sort((a, b) => (orden.get(a.id) ?? 999) - (orden.get(b.id) ?? 999) || a.nombre.localeCompare(b.nombre, 'es'))
}

/**
 * "Menú": arma qué se vende hoy a partir del catálogo de Platillos.
 *
 * La tienda guarda varios menús con nombre ("Entre semana", "Fin de semana"...) y marca uno
 * como el de hoy. Mientras haya menú de hoy, solo sus platillos se pueden ordenar en el punto
 * de venta y en la página web (lo valida el backend, ver MenuDiaService); sin él se vende todo.
 *
 * Todo es de un toque: cada platillo es una tarjeta con su foto, tocarla lo agrega o lo quita,
 * y la barra de abajo guarda los cambios (o los descarta). Por categoría hay "Agregar todos /
 * Quitar todos". Fotos, precios y platillos nuevos se editan en Platillos.
 */
export default function MenuDelDia() {
  const { notify, confirmDialog } = useNotify()
  const [menus, setMenus] = useState(null) // null = cargando
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [selId, setSelId] = useState(null)
  const [nombre, setNombre] = useState('')
  const [ids, setIds] = useState(new Set()) // borrador de platillos del menú elegido
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState('todos') // todos | en | fuera
  const [busy, setBusy] = useState(false)
  const [nuevo, setNuevo] = useState(null) // { nombre, base: 'todos' | 'vacio' | 'copia', copiaId }
  const [verPrevia, setVerPrevia] = useState(false) // vista previa en grande (en escritorio también va a un lado)
  const [plantilla, setPlantilla] = useState(plantillaGuardada)
  const [qr, setQr] = useState(null)
  const { user } = useAuth()

  const sel = menus?.find((m) => m.id === selId) ?? null
  const guardados = useMemo(() => new Set(sel?.productoIds ?? []), [sel])
  const sucio = !!sel && (nombre.trim() !== sel.nombre || !mismos(ids, guardados))
  const menuHoy = menus?.find((m) => m.hoy) ?? null

  function cargarMenus(elegir) {
    return getMenus().then((r) => {
      const lista = r.data.data ?? []
      setMenus(lista)
      const m = lista.find((x) => x.id === elegir) ?? lista.find((x) => x.id === selId) ?? lista.find((x) => x.hoy) ?? lista[0]
      elegirSinPreguntar(m ?? null)
      return lista
    }).catch(() => { setMenus([]); notify('No se pudieron cargar los menús', 'error') })
  }
  useEffect(() => {
    cargarMenus()
    getProducts().then((r) => setProductos((r.data.data ?? []).filter((p) => p.isActive !== false))).catch(() => {})
    getCategories().then((r) => setCategorias(r.data.data ?? [])).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Avisa antes de cerrar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!sucio) return undefined
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [sucio])

  function elegirSinPreguntar(m) {
    setSelId(m?.id ?? null)
    setNombre(m?.nombre ?? '')
    setIds(new Set(m?.productoIds ?? []))
  }
  async function elegir(m) {
    if (m.id === selId) return
    if (sucio && !(await confirmDialog(`Tienes cambios sin guardar en "${sel.nombre}". ¿Descartarlos?`, { title: 'Cambios sin guardar', confirmText: 'Descartar' }))) return
    elegirSinPreguntar(m)
  }

  const toggle = (id) => setIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const ponerVarios = (lista, poner) => setIds((s) => {
    const n = new Set(s)
    lista.forEach((p) => (poner ? n.add(p.id) : n.delete(p.id)))
    return n
  })

  async function guardar() {
    if (!nombre.trim()) { notify('Ponle un nombre al menú', 'error'); return }
    setBusy(true)
    try {
      await updateMenu(sel.id, { nombre: nombre.trim(), productoIds: [...ids] })
      notify(sel.hoy ? 'Menú guardado: ya se aplica en el punto de venta y la página web' : 'Menú guardado', 'success')
      await cargarMenus(sel.id)
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo guardar', 'error')
    } finally { setBusy(false) }
  }

  async function hacerHoy() {
    setBusy(true)
    try {
      if (sucio) await updateMenu(sel.id, { nombre: nombre.trim(), productoIds: [...ids] })
      await usarMenuHoy(sel.id)
      notify(`"${nombre.trim()}" es el menú de hoy`, 'success')
      await cargarMenus(sel.id)
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo cambiar el menú de hoy', 'error')
    } finally { setBusy(false) }
  }

  async function quitarHoy() {
    if (!(await confirmDialog('Sin menú de hoy se puede vender cualquier platillo del catálogo. ¿Continuar?', { title: 'Quitar menú de hoy', confirmText: 'Vender todo', danger: false }))) return
    setBusy(true)
    try {
      await quitarMenuHoy()
      notify('Sin menú de hoy: se vende todo el catálogo', 'success')
      await cargarMenus(selId)
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo quitar', 'error')
    } finally { setBusy(false) }
  }

  async function eliminar() {
    const aviso = sel.hoy ? ' Es el menú de hoy: al borrarlo se vuelve a vender todo el catálogo.' : ''
    if (!(await confirmDialog(`¿Eliminar el menú "${sel.nombre}"?${aviso}`, { title: 'Eliminar menú', confirmText: 'Eliminar' }))) return
    setBusy(true)
    try {
      await deleteMenu(sel.id)
      notify('Menú eliminado', 'success')
      setSelId(null)
      await cargarMenus(-1)
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo eliminar', 'error')
    } finally { setBusy(false) }
  }

  async function crear() {
    const n = nuevo.nombre.trim()
    if (!n) { notify('Ponle un nombre al menú', 'error'); return }
    const base = nuevo.base === 'todos' ? productos.map((p) => p.id)
      : nuevo.base === 'copia' ? (menus.find((m) => m.id === nuevo.copiaId)?.productoIds ?? []) : []
    setBusy(true)
    try {
      const r = await createMenu({ nombre: n, productoIds: base })
      setNuevo(null)
      notify(r.data.data?.hoy ? `"${n}" creado y ya es el menú de hoy` : `"${n}" creado`, 'success')
      await cargarMenus(r.data.data?.id)
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo crear', 'error')
    } finally { setBusy(false) }
  }

  async function abrirNuevo(base) {
    if (sucio && !(await confirmDialog(`Tienes cambios sin guardar en "${sel.nombre}". ¿Descartarlos?`, { title: 'Cambios sin guardar', confirmText: 'Descartar' }))) return
    // Copiar: por default del menú abierto, pero en el modal se elige cualquiera de los guardados.
    const copiaId = sel?.id ?? menus?.[0]?.id ?? null
    if (base === 'copia') setNuevo({ nombre: `${sel.nombre} (copia)`, base: 'copia', copiaId })
    else setNuevo({ nombre: menus?.length ? '' : 'Menú de hoy', base: base ?? 'todos', copiaId })
  }

  // ── Platillos visibles, agrupados por categoría ────────────────────
  const texto = q.trim().toLowerCase()
  const visibles = productos.filter((p) => (!texto || p.name.toLowerCase().includes(texto) || (p.category?.name ?? '').toLowerCase().includes(texto))
    && (filtro === 'todos' || (filtro === 'en' ? ids.has(p.id) : !ids.has(p.id))))
  const grupos = useMemo(() => agrupar(visibles, categorias), [visibles, categorias])
  // Vista previa: lo que hoy tiene el borrador, como lo verá el cliente (se actualiza al tocar).
  const previa = useMemo(() => agrupar(productos.filter((p) => ids.has(p.id)), categorias)
    .map((g) => ({ id: g.id, name: g.nombre, items: [...g.platillos].sort((a, b) => a.name.localeCompare(b.name, 'es')) })), [productos, ids, categorias])
  // QR de la página web para que la vista previa sea igual al menú impreso (si no hay página, va sin QR).
  useEffect(() => { api.get('/menu/qr').then((r) => setQr(r.data.data)).catch(() => setQr(null)) }, [])
  const elegirPlantilla = (v) => { setPlantilla(v); guardarPlantilla(v) }
  const enMenu = productos.filter((p) => ids.has(p.id)).length
  const previaProps = {
    secciones: previa, qr, plantilla, onPlantilla: elegirPlantilla, total: enMenu,
    tienda: user?.tienda, nombre: nombre.trim(),
  }
  const agregados = [...ids].filter((x) => !guardados.has(x)).length
  const quitados = [...guardados].filter((x) => !ids.has(x)).length

  if (menus === null) return <p className="text-gray-600 py-10 text-center">Cargando…</p>

  return (
    <div className="max-w-6xl space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-[28px] font-extrabold tracking-tight">Menú</h1>
          <p className="text-sm text-gray-600">Elige qué platillos se venden hoy. Toca un platillo para agregarlo o quitarlo.</p>
        </div>
        <Link to="/platillos" className="btn-secondary inline-flex items-center gap-2">Platillos</Link>
        <Link to="/menu-imprimible" className="btn-secondary inline-flex items-center gap-2">🖨️ Menú imprimible con QR</Link>
      </header>

      {menus.length === 0 ? (
        <section className="bg-white border border-[#E4E1DA] rounded-2xl p-6 sm:p-8 text-center space-y-4">
          <p className="text-4xl" aria-hidden="true">📖</p>
          <h2 className="text-xl font-extrabold">Arma tu primer menú</h2>
          <p className="text-sm text-gray-600 max-w-lg mx-auto">
            Mientras no tengas menú se vende todo tu catálogo de platillos. Crea uno, quita lo que hoy no hay,
            y solo eso se podrá pedir en el punto de venta y en tu página web. Puedes guardar varios
            (entre semana, fin de semana…) y cambiar entre ellos con un toque.
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            <button type="button" className="btn-primary min-h-[48px]" onClick={() => abrirNuevo('todos')}>Empezar con todos los platillos</button>
            <button type="button" className="btn-secondary min-h-[48px]" onClick={() => abrirNuevo('vacio')}>Empezar vacío</button>
          </div>
        </section>
      ) : (
        <>
          {/* Menús guardados: elegir cuál editar. El de hoy lleva su marca. */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Menús guardados">
            {menus.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={m.id === selId} onClick={() => elegir(m)}
                className={`shrink-0 min-h-[44px] px-4 rounded-full border text-sm font-bold flex items-center gap-2 ${m.id === selId ? 'border-purple-600 bg-purple-50 text-purple-800' : 'border-[#D9D5CC] bg-white text-gray-700 hover:border-purple-300'}`}>
                {m.hoy && <span className="w-2.5 h-2.5 rounded-full bg-[#2E7D4F]" aria-hidden="true" />}
                {m.nombre}
                {m.hoy && <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded-md bg-[#E7F3EC] text-[#22603C]">HOY</span>}
                <span className="text-xs font-semibold text-gray-500">{m.productoIds.length}</span>
              </button>
            ))}
            <button type="button" onClick={() => abrirNuevo('todos')}
              className="shrink-0 min-h-[44px] px-4 rounded-full border border-dashed border-[#B9B4AA] bg-white text-sm font-bold text-gray-700 hover:border-purple-400">
              + Nuevo menú
            </button>
          </div>

          {/* Qué se vende hoy, en una línea. */}
          <div className={`rounded-2xl px-4 py-3 text-sm flex flex-wrap items-center gap-x-3 gap-y-1 ${menuHoy ? 'bg-[#E7F3EC] text-[#22603C]' : 'bg-[#FBF0DC] text-[#6B4100]'}`}>
            {menuHoy ? (
              <>
                <span className="flex-1 min-w-[220px]">
                  Hoy se vende solo lo del menú <b>{menuHoy.nombre}</b> ({menuHoy.productoIds.length} platillos), en el punto de venta y en la página web.
                </span>
                <button type="button" disabled={busy} onClick={quitarHoy} className="font-bold underline disabled:opacity-50">Vender todo el catálogo</button>
              </>
            ) : (
              <span>Ningún menú es el de hoy: <b>se vende todo el catálogo</b>. Elige un menú y toca “Usar como menú de hoy”.</span>
            )}
          </div>

          {sel && (
            <section className="bg-white border border-[#E4E1DA] rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex-1 min-w-[220px]">
                  <span className="sr-only">Nombre del menú</span>
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100}
                    className="w-full text-xl font-extrabold bg-transparent border-b-2 border-transparent hover:border-[#E4E1DA] focus:border-purple-600 outline-none py-1" />
                  <span className="block text-sm text-gray-600 mt-0.5">{enMenu} de {productos.length} platillos en este menú</span>
                </label>
                {sel.hoy
                  ? <span className="min-h-[44px] px-4 rounded-xl bg-[#E7F3EC] text-[#22603C] text-sm font-extrabold flex items-center gap-2">✓ Es el menú de hoy</span>
                  : <button type="button" className="btn-primary min-h-[44px]" disabled={busy || ids.size === 0} onClick={hacerHoy}
                      title={ids.size === 0 ? 'Agrega al menos un platillo' : undefined}>
                      Usar como menú de hoy
                    </button>}
                <IconButton icon="copiar" label="Duplicar menú" variant="purple" disabled={busy} onClick={() => abrirNuevo('copia')} />
                <IconButton icon="basura" label="Eliminar menú" variant="danger" disabled={busy} onClick={eliminar} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 min-h-[44px] px-3 rounded-2xl border border-[#D9D5CC] bg-white flex-1 min-w-[200px] max-w-md">
                  <Icon name="buscar" className="w-[18px] h-[18px] text-gray-600" />
                  <span className="sr-only">Buscar platillo</span>
                  <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar platillo o categoría…"
                    className="flex-1 min-w-0 bg-transparent outline-none text-[15px] font-semibold" />
                </label>
                <div className="flex gap-1 rounded-full bg-[#ECEAE4] p-1" role="radiogroup" aria-label="Mostrar">
                  {[['todos', `Todos ${productos.length}`], ['en', `En el menú ${enMenu}`], ['fuera', `Fuera ${productos.length - enMenu}`]].map(([k, label]) => (
                    <button key={k} type="button" role="radio" aria-checked={filtro === k} onClick={() => setFiltro(k)}
                      className={`min-h-[36px] px-3 rounded-full text-[13px] font-bold ${filtro === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => setVerPrevia(true)}
                  className="lg:hidden min-h-[40px] px-3 rounded-full border border-[#D9D5CC] bg-white text-[13px] font-bold text-gray-700 inline-flex items-center gap-1.5">
                  <Icon name="ver" className="w-4 h-4" /> Vista previa
                </button>
              </div>
            </section>
          )}

          {sel && (
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5 lg:items-start">
          <div className="space-y-4 min-w-0">
          {grupos.length === 0 && (
            <p className="text-center text-sm text-gray-600 py-10">
              {productos.length === 0
                ? <>Aún no tienes platillos. Agrégalos en <Link to="/platillos" className="font-bold text-purple-700 hover:underline">Platillos</Link>.</>
                : filtro === 'en' ? 'Este menú todavía no tiene platillos: ve a "Fuera" y toca los que quieras agregar.'
                  : 'Nada coincide con la búsqueda.'}
            </p>
          )}

          {grupos.map((g) => {
            const dentro = g.platillos.filter((p) => ids.has(p.id)).length
            const todos = dentro === g.platillos.length
            return (
              <section key={g.id} aria-label={g.nombre} className="space-y-2.5">
                <div className="flex items-center gap-3 px-1">
                  <h2 className="text-lg font-extrabold">{g.nombre}</h2>
                  <span className="text-sm text-gray-600">{dentro}/{g.platillos.length} en el menú</span>
                  <button type="button" onClick={() => ponerVarios(g.platillos, !todos)}
                    className="ml-auto min-h-[36px] px-3 rounded-xl text-[13px] font-bold text-purple-700 hover:bg-purple-50">
                    {todos ? 'Quitar todos' : 'Agregar todos'}
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                  {g.platillos.map((p) => {
                    const on = ids.has(p.id)
                    return (
                      <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={on}
                        aria-label={`${p.name}: ${on ? 'en el menú, toca para quitar' : 'fuera del menú, toca para agregar'}`}
                        className={`relative text-left rounded-2xl bg-white overflow-hidden flex flex-col transition ${on ? 'border-2 border-purple-600 shadow-sm' : 'border border-[#E4E1DA] opacity-60 hover:opacity-90'}`}>
                        <span className={`aspect-[4/3] bg-[#F1EFEA] flex items-center justify-center overflow-hidden ${on ? '' : 'grayscale'}`}>
                          {p.imageUrl
                            ? <img src={resolveMediaUrl(p.imageUrl)} alt="" loading="lazy" className="w-full h-full object-cover"
                                onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                            : <Icon name="platillos" className="w-10 h-10 text-gray-400" />}
                        </span>
                        <span className="p-2.5 flex flex-col gap-0.5">
                          <span className="text-[14px] font-extrabold leading-tight line-clamp-2">{p.name}</span>
                          <span className="text-[13px] font-bold text-gray-600">{fmt(p.price)}</span>
                          {p.disponible === false && <span className="text-[12px] font-bold text-red-700">Agotado ahorita</span>}
                        </span>
                        <span aria-hidden="true"
                          className={`absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center text-lg font-extrabold shadow ${on ? 'bg-purple-600 text-white' : 'bg-white text-gray-700 border border-[#D9D5CC]'}`}>
                          {on ? '✓' : '+'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
          </div>

          <aside aria-label="Vista previa del menú" className="hidden lg:block lg:sticky lg:top-4">
            <VistaPrevia {...previaProps} onAmpliar={() => setVerPrevia(true)} />
          </aside>
          </div>
          )}
        </>
      )}

      {verPrevia && (
        <PreviaModal onCerrar={() => setVerPrevia(false)}>
          <VistaPrevia {...previaProps} enModal />
        </PreviaModal>
      )}

      {/* Guardar / descartar, siempre a la mano mientras haya cambios. */}
      {sucio && (
        <div className="sticky bottom-3 z-30 bg-white border border-[#E4E1DA] rounded-2xl shadow-lg px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 min-w-[200px] text-sm text-gray-700">
              <b>Cambios sin guardar</b>
              {agregados > 0 && <> · <span className="text-[#22603C] font-bold">+{agregados} agregado{agregados === 1 ? '' : 's'}</span></>}
              {quitados > 0 && <> · <span className="text-red-700 font-bold">−{quitados} quitado{quitados === 1 ? '' : 's'}</span></>}
              {sel?.hoy && <span className="block text-xs text-gray-600">Es el menú de hoy: al guardar se aplica al momento.</span>}
            </p>
            <button type="button" className="btn-secondary min-h-[48px]" disabled={busy} onClick={() => elegirSinPreguntar(sel)}>Descartar</button>
            <button type="button" className="btn-primary min-h-[48px]" disabled={busy || (sel?.hoy && ids.size === 0)} onClick={guardar}
              title={sel?.hoy && ids.size === 0 ? 'El menú de hoy necesita al menos un platillo' : undefined}>
              {busy ? 'Guardando…' : 'Guardar menú'}
            </button>
          </div>
        </div>
      )}

      {nuevo && (
        <NuevoMenuModal nuevo={nuevo} setNuevo={setNuevo} busy={busy} onCrear={crear} menus={menus}
          totalPlatillos={productos.length} />
      )}
    </div>
  )
}

function NuevoMenuModal({ nuevo, setNuevo, busy, onCrear, menus, totalPlatillos }) {
  useEscapeKey(() => setNuevo(null))
  const copia = menus.find((m) => m.id === nuevo.copiaId)
  const opciones = [
    ['todos', 'Todos los platillos', `${totalPlatillos} platillos; quitas lo que no haya`],
    ['vacio', 'Vacío', 'Agregas uno por uno'],
    ...(menus.length ? [['copia', 'Copia de un menú guardado', copia ? `${copia.productoIds.length} platillos de “${copia.nombre}”` : 'Elige cuál']] : []),
  ]
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <form role="dialog" aria-modal="true" aria-labelledby="nuevo-menu-titulo"
        onSubmit={(e) => { e.preventDefault(); onCrear() }}
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <ModalCloseButton onClick={() => setNuevo(null)} />
        <h3 id="nuevo-menu-titulo" className="text-lg font-extrabold pr-10">Nuevo menú</h3>
        <label className="block">
          <span className="text-sm font-semibold text-gray-700">Nombre</span>
          <input className="input mt-1" autoFocus maxLength={100} placeholder="Ej. Entre semana, Fin de semana, Cuaresma"
            value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-gray-700 mb-1">Empezar con</legend>
          {opciones.map(([k, titulo, detalle]) => (
            <label key={k} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer ${nuevo.base === k ? 'border-purple-600 bg-purple-50' : 'border-[#D9D5CC]'}`}>
              <input type="radio" name="base" checked={nuevo.base === k} onChange={() => setNuevo({ ...nuevo, base: k })} />
              <span>
                <span className="block text-sm font-bold">{titulo}</span>
                <span className="block text-xs text-gray-600">{detalle}</span>
              </span>
            </label>
          ))}
          {nuevo.base === 'copia' && (
            <label className="block pl-1">
              <span className="text-sm font-semibold text-gray-700">Copiar de</span>
              <select className="input mt-1" value={nuevo.copiaId ?? ''}
                onChange={(e) => {
                  const m = menus.find((x) => x.id === Number(e.target.value))
                  // Si el nombre era la sugerencia automática "(copia)", se actualiza con el menú elegido.
                  const auto = !nuevo.nombre.trim() || / \(copia\)$/.test(nuevo.nombre)
                  setNuevo({ ...nuevo, copiaId: m?.id ?? null, nombre: auto && m ? `${m.nombre} (copia)` : nuevo.nombre })
                }}>
                {menus.map((m) => (
                  <option key={m.id} value={m.id}>{m.nombre} · {m.productoIds.length} platillos{m.hoy ? ' · HOY' : ''}</option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setNuevo(null)}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={busy || !nuevo.nombre.trim()}>{busy ? 'Creando…' : 'Crear menú'}</button>
        </div>
      </form>
    </div>
  )
}

/**
 * Vista previa en vivo: la misma hoja del "Menú imprimible" (plantilla, fotos, precios y QR),
 * reducida al ancho disponible. Se actualiza al tocar cualquier platillo. La plantilla elegida
 * aquí se recuerda y es la que abre el Menú imprimible.
 */
function VistaPrevia({ secciones, qr, plantilla, onPlantilla, total, tienda, nombre, onAmpliar, enModal = false }) {
  const op = {
    plantilla, formato: 'carta', color: tienda?.primaryColor || '#1E4585',
    titulo: tienda?.name ?? 'Nuestro menú', subtitulo: nombre || 'Menú', pie: '',
    fotos: true, descripciones: true, columnas: 2, qr: true,
  }
  const hoja = <MenuHoja op={op} secciones={secciones} qr={qr} logo={resolveMediaUrl(tienda?.logoPath)} vacio="Toca los platillos para agregarlos a tu menú." />
  return (
    <div className={`bg-white border border-[#E4E1DA] rounded-2xl flex flex-col ${enModal ? 'max-h-[85vh]' : 'max-h-[calc(100vh-2rem)]'}`}>
      <div className="px-3 pt-3 pb-2 flex items-center gap-2 flex-wrap">
        <p className="text-sm font-extrabold flex-1">Vista previa <span className="font-semibold text-gray-600">· {total} platillo{total === 1 ? '' : 's'}</span></p>
        <div className="flex gap-1" role="radiogroup" aria-label="Diseño del menú">
          {Object.entries(PLANTILLAS).map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={plantilla === k} title={t.nombre} aria-label={`Diseño ${t.nombre}`}
              onClick={() => onPlantilla(k)}
              className={`w-7 h-7 rounded-full border-2 ${plantilla === k ? 'border-purple-600 ring-2 ring-purple-200' : 'border-[#D9D5CC]'}`}
              style={{ background: `linear-gradient(135deg, ${t.fondo} 55%, ${t.acento ?? tienda?.primaryColor ?? '#1E4585'} 55%)` }} />
          ))}
        </div>
      </div>
      <div className="overflow-y-auto px-3 pb-3">
        {onAmpliar
          ? (
            <button type="button" onClick={onAmpliar} title="Ver en grande" className="block w-full rounded-lg overflow-hidden border border-[#E4E1DA] cursor-zoom-in">
              <HojaEscalada>{hoja}</HojaEscalada>
            </button>
          )
          : <div className="rounded-lg overflow-hidden border border-[#E4E1DA]"><HojaEscalada>{hoja}</HojaEscalada></div>}
      </div>
      <p className="px-3 py-2 border-t border-[#E4E1DA] text-[11px] text-gray-600 text-center">
        Así quedará tu menú impreso.{' '}
        <Link to="/menu-imprimible" className="font-bold text-purple-700 hover:underline">Imprimir o descargar</Link>
      </p>
    </div>
  )
}

function PreviaModal({ onCerrar, children }) {
  useEscapeKey(onCerrar)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3">
      <div role="dialog" aria-modal="true" aria-label="Vista previa del menú" className="relative w-full max-w-3xl space-y-2">
        <ModalCloseButton onClick={onCerrar} />
        {children}
        <button type="button" onClick={onCerrar} className="w-full min-h-[48px] rounded-2xl bg-white text-sm font-extrabold">Cerrar vista previa</button>
      </div>
    </div>
  )
}
