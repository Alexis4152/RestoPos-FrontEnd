import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { getPublicTienda, getPublicMenu, getPublicMesas, createPublicPedido, getPublicPedido, uploadComprobantePedido, getClienteMe, logoutCliente, verificarCorreoCliente, reenviarVerificacionCliente } from '../api/publicSite'
import { useAuth } from '../context/AuthContext'
import { AuthScreen, MisPedidos, PerfilCliente, RestablecerScreen, esRepartidorDe } from './publicSite/Account'
import Deliveries from './Deliveries'
import ComprobanteTransferencia, { puedeSubirComprobante } from './publicSite/ComprobanteTransferencia'
import Reservaciones, { leerCodigosReserva, guardarCodigosReserva } from './publicSite/Reservaciones'
import { usePublicLiveRefresh, publicStreamBase } from '../utils/liveEvents'
import { applyTiendaBrand } from '../utils/theme'
import defaultLogo from '../assets/logo.png'
import { resolveMediaUrl } from '../utils/media'
import { useEscapeKey } from '../hooks/useEscapeKey'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))

const PAGO_LABEL = { EFECTIVO: '💵 Efectivo', TARJETA: '💳 Tarjeta', TRANSFERENCIA: '🏦 Transferencia' }
const PAGO_HINT = {
  EFECTIVO: 'Pagas al recibir o al recoger tu pedido.',
  TARJETA: 'Pagas con tarjeta al recibir o al recoger (terminal).',
  TRANSFERENCIA: 'Transfiere a la cuenta de abajo y sube la foto de tu comprobante en el seguimiento del pedido.',
}
const MESA_STYLE = {
  LIBRE: 'bg-green-50 border-green-300 text-green-800',
  OCUPADA: 'bg-red-50 border-red-300 text-red-800',
  RESERVADA: 'bg-yellow-50 border-yellow-300 text-yellow-800',
}
const MESA_LABEL = { LIBRE: 'Libre', OCUPADA: 'Ocupada', RESERVADA: 'Reservada' }
const STEPS = [
  { key: 'RECIBIDO', label: 'Recibido', hint: 'Esperando que el restaurante confirme tu pedido.' },
  { key: 'ACEPTADO', label: 'En preparación', hint: '¡Confirmado! Ya lo estamos preparando.' },
  { key: 'LISTO', label: 'Listo', hint: 'Tu pedido está listo.' },
  { key: 'EN_CAMINO', label: 'En camino', hint: 'El repartidor ya va hacia tu domicilio.', soloDomicilio: true },
  { key: 'ENTREGADO', label: 'Entregado', hint: '¡Gracias por tu compra!' },
]

// Persistencia del carrito y de los pedidos en seguimiento por tienda: si el cliente recarga
// la página no pierde lo que llevaba ni el seguimiento de sus pedidos.
const storageKey = (slug, what) => `restopos_web_${slug}_${what}`
function loadJson(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
function saveJson(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)) } catch { /* sin storage */ }
}

/** Precio unitario de una línea del carrito: base + extras elegidos. */
const lineUnit = (line) => Number(line.precio) + line.mods.reduce((s, m) => s + Number(m.precioExtra), 0)

/**
 * Página web pública de una tienda (`/sitio/:slug`), sin login y sin el diseño del punto de
 * venta: portada con datos de la tienda, menú con carrito para pedir para recoger o a
 * domicilio (eligiendo forma de pago), mesas libres/ocupadas en vivo y el seguimiento del
 * pedido ya enviado. Todo lo que muestra (y si se muestra) lo configura el admin en
 * "Configuración → Página web". El pedido llega al personal como "por aceptar".
 *
 * Acceso (misma lógica que el login del punto de venta): al entrar se pide iniciar sesión,
 * registrarse o continuar como invitado. Un cliente registrado ve su historial y califica sus
 * pedidos; un repartidor de la tienda ve aquí su pantalla de Entregas (ver Account.jsx).
 */
export default function PublicSite() {
  const { slug } = useParams()
  const [tienda, setTienda] = useState(null)
  const [menu, setMenu] = useState([])
  const [zonas, setZonas] = useState([])
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState('menu')
  const [activeCat, setActiveCat] = useState(null)
  const [search, setSearch] = useState('')

  const [cart, setCart] = useState(() => loadJson(storageKey(slug, 'cart'), []))
  const [cartOpen, setCartOpen] = useState(false)
  const [checkout, setCheckout] = useState(false)
  const [customize, setCustomize] = useState(null) // producto en personalización
  const [avisoCarrito, setAvisoCarrito] = useState(null) // lo que no se pudo agregar al "volver a pedir"

  // Acceso: cliente registrado ({ token, cliente }), invitado, o repartidor (sesión del
  // personal, ver esRepartidorDe). Sin ninguno se muestra la pantalla de acceso.
  const { user: staffUser, logout: staffLogout } = useAuth()
  const [clienteSesion, setClienteSesion] = useState(() => loadJson(storageKey(slug, 'cliente'), null))
  const [invitado, setInvitado] = useState(() => loadJson(storageKey(slug, 'invitado'), false))
  const [showAuth, setShowAuth] = useState(false)

  // Enlaces que llegan por correo: ?verificar=código (confirmar correo) y ?restablecer=código
  // (nueva contraseña). Se leen al abrir la página y se quitan de la URL al usarse.
  const [searchParams, setSearchParams] = useSearchParams()
  const tokenRestablecer = searchParams.get('restablecer')
  const [avisoCorreo, setAvisoCorreo] = useState(null) // { ok, texto }
  const [reenviando, setReenviando] = useState(false)
  useEffect(() => {
    const t = searchParams.get('verificar')
    if (!t) return
    verificarCorreoCliente(slug, t)
      .then((r) => {
        setAvisoCorreo({ ok: true, texto: '¡Listo! Tu correo quedó confirmado. Ya puedes hacer pedidos con tu cuenta.' })
        setClienteSesion((s) => (s && s.cliente?.id === r.data.data.id ? { ...s, cliente: r.data.data } : s))
      })
      .catch((err) => setAvisoCorreo({ ok: false, texto: err.response?.data?.message ?? 'No se pudo confirmar tu correo' }))
      .finally(() => { searchParams.delete('verificar'); setSearchParams(searchParams, { replace: true }) })
  }, [])
  async function reenviarCorreo() {
    setReenviando(true)
    try {
      const r = await reenviarVerificacionCliente(slug, clienteSesion.token)
      setAvisoCorreo({ ok: true, texto: r.data.message ?? 'Te enviamos de nuevo el correo de confirmación' })
    } catch (err) {
      setAvisoCorreo({ ok: false, texto: err.response?.data?.message ?? 'No se pudo reenviar el correo' })
    } finally { setReenviando(false) }
  }
  useEffect(() => {
    const t = searchParams.get('reservacion')
    if (!t) return
    guardarCodigosReserva(slug, [...leerCodigosReserva(slug), t])
    // Sin sesión entra como invitado para ver su reservación directo (sin pasar por el acceso).
    if (!clienteSesion) setInvitado(true)
    setTab('reservar')
    searchParams.delete('reservacion'); setSearchParams(searchParams, { replace: true })
  }, [])
  const [menuCuenta, setMenuCuenta] = useState(false)

  // Pedidos en seguimiento ([{ id, token }]): cada uno se queda hasta que se entrega o se
  // rechaza Y el cliente cierra su seguimiento — hacer otro pedido no borra los anteriores.
  // `token` es el código de seguimiento aleatorio que dio el backend al crear el pedido: solo
  // quien lo tiene (este navegador) puede ver el pedido. Entradas viejas sin token se descartan.
  const [pedidos, setPedidos] = useState(() => {
    const list = loadJson(storageKey(slug, 'pedidos'), [])
    return Array.isArray(list) ? list.filter((p) => p && p.token) : []
  })
  const [statuses, setStatuses] = useState({}) // { [id]: status }
  // Copia en ref para que el polling sepa cuáles ya terminaron sin reiniciarse con cada respuesta.
  const statusesRef = useRef(statuses)
  statusesRef.current = statuses

  useEffect(() => {
    getPublicTienda(slug)
      .then((r) => {
        const t = r.data.data
        setTienda(t)
        applyTiendaBrand(t.primaryColor)
        document.title = t.nombre
      })
      .catch(() => setNotFound(true))
    getPublicMenu(slug).then((r) => setMenu(r.data.data ?? [])).catch(() => setMenu([]))
  }, [slug])

  // Mesas en vivo (solo si la tienda las muestra): se refrescan cada 30 s.
  useEffect(() => {
    if (!tienda?.mostrarMesas) return
    const load = () => getPublicMesas(slug).then((r) => setZonas(r.data.data ?? [])).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [slug, tienda?.mostrarMesas])

  useEffect(() => { saveJson(storageKey(slug, 'cart'), cart) }, [slug, cart])
  useEffect(() => { saveJson(storageKey(slug, 'cliente'), clienteSesion) }, [slug, clienteSesion])
  useEffect(() => { saveJson(storageKey(slug, 'invitado'), invitado || null) }, [slug, invitado])

  // Al abrir la página con una sesión de cliente guardada, se confirma con el servidor (y se
  // refrescan sus datos); si ya venció, se borra y vuelve a pedir acceso.
  useEffect(() => {
    if (!clienteSesion?.token) return
    getClienteMe(slug, clienteSesion.token)
      .then((r) => setClienteSesion((s) => (s ? { ...s, cliente: r.data.data } : s)))
      .catch((err) => { if (err.response?.status === 401) setClienteSesion(null) })
  }, [slug])

  // El login/logout del personal reaplica su propio color: se vuelve a poner el de la tienda.
  useEffect(() => { if (tienda) applyTiendaBrand(tienda.primaryColor) }, [staffUser, tienda])
  useEffect(() => {
    saveJson(storageKey(slug, 'pedidos'), pedidos)
    saveJson(storageKey(slug, 'pedido'), null)
  }, [slug, pedidos])

  // Seguimiento: consulta cada 10 s los pedidos que todavía no terminan (entregado/rechazado).
  // Uno que el servidor ya no reconoce (400) se quita de la lista. Carga inicial aquí; los
  // cambios después llegan en tiempo real (ver <SeguimientoEnVivo> más abajo).
  function cargarPedido(p) {
    getPublicPedido(slug, p.token)
      .then((r) => setStatuses((st) => ({ ...st, [p.id]: r.data.data })))
      .catch((err) => { if (err.response?.status === 400) setPedidos((list) => list.filter((x) => x.id !== p.id)) })
  }
  useEffect(() => {
    pedidos.forEach((p) => {
      const actual = statusesRef.current[p.id]?.estado
      if (actual !== 'ENTREGADO' && actual !== 'RECHAZADO') cargarPedido(p)
    })
  }, [slug, pedidos])

  const cerrarSeguimiento = (id) => setPedidos((list) => list.filter((x) => x.id !== id))
  const pedidosActivos = pedidos.filter((p) => !['ENTREGADO', 'RECHAZADO'].includes(statuses[p.id]?.estado)).length

  const cartCount = cart.reduce((s, l) => s + l.cantidad, 0)
  const cartTotal = cart.reduce((s, l) => s + lineUnit(l) * l.cantidad, 0)

  const filteredMenu = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return menu
    return menu
      .map((c) => ({ ...c, productos: c.productos.filter((p) => `${p.nombre} ${p.descripcion ?? ''}`.toLowerCase().includes(q)) }))
      .filter((c) => c.productos.length > 0)
  }, [menu, search])

  function addToCart(producto, mods = [], nota = '', cantidad = 1) {
    const key = `${producto.id}|${mods.map((m) => m.id).sort((a, b) => a - b).join(',')}|${nota.trim()}`
    setCart((c) => {
      const existing = c.find((l) => l.key === key)
      if (existing) return c.map((l) => (l.key === key ? { ...l, cantidad: Math.min(99, l.cantidad + cantidad) } : l))
      return [...c, { key, productoId: producto.id, nombre: producto.nombre, precio: producto.precio, imageUrl: producto.imageUrl, mods, nota: nota.trim(), cantidad }]
    })
  }
  const setQty = (key, cantidad) => setCart((c) => (cantidad <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, cantidad: Math.min(99, cantidad) } : l))))
  const qtyOfProduct = (id) => cart.filter((l) => l.productoId === id).reduce((s, l) => s + l.cantidad, 0)

  function scrollToCat(id) {
    setActiveCat(id)
    document.getElementById(`cat-${id ?? 'otros'}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6 text-center">
        <div>
          <p className="text-5xl mb-4">🍽️</p>
          <h1 className="text-2xl font-bold text-gray-900">Página no disponible</h1>
          <p className="text-gray-500 mt-2">Este restaurante no existe o su página web no está activa por ahora.</p>
        </div>
      </div>
    )
  }
  if (!tienda) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-400">Cargando...</div>
  }

  const esRepartidor = esRepartidorDe(staffUser, tienda.tiendaId)
  const cliente = clienteSesion?.cliente ?? null
  const puedePedir = (tienda.recoger || tienda.domicilio) && !esRepartidor
  const puedeReservar = tienda.reservaciones && !esRepartidor

  /**
   * "Volver a pedir" desde Mis pedidos: suma al carrito los platillos del pedido anterior (con
   * los precios de hoy) y abre el carrito, avisando lo que ya no está disponible.
   */
  function repetirPedido({ lineas, noDisponibles, cambiaron }) {
    lineas.forEach((l) => addToCart({ id: l.productoId, nombre: l.nombre, precio: l.precio, imageUrl: l.imageUrl }, l.mods, l.nota ?? '', l.cantidad))
    const avisos = []
    if (noDisponibles.length > 0) avisos.push(`No disponible ahora: ${noDisponibles.join(', ')}.`)
    if (cambiaron.length > 0) avisos.push(`Revisa los extras de: ${cambiaron.join(', ')} (algunas opciones ya no existen).`)
    setAvisoCarrito(avisos.length > 0 ? avisos.join(' ') : null)
    setCheckout(false)
    setCartOpen(true)
  }

  function sesionVencida() {
    setClienteSesion(null)
    setTab('menu')
  }
  async function cerrarSesion() {
    setMenuCuenta(false)
    if (esRepartidor) await staffLogout()
    if (clienteSesion) { logoutCliente(slug, clienteSesion.token).catch(() => {}); setClienteSesion(null) }
    setInvitado(false)
    setTab('menu')
  }

  if (tokenRestablecer) {
    return (
      <RestablecerScreen slug={slug} tienda={tienda} token={tokenRestablecer}
        onListo={() => {
          searchParams.delete('restablecer'); setSearchParams(searchParams, { replace: true })
          // Cambiar la contraseña cerró todas sus sesiones: que vuelva a entrar.
          setClienteSesion(null); setShowAuth(true)
        }} />
    )
  }

  if ((!esRepartidor && !clienteSesion && !invitado) || showAuth) {
    return (
      <AuthScreen slug={slug} tienda={tienda}
        onCliente={(s) => { setClienteSesion(s); setInvitado(false); setShowAuth(false); setTab('menu') }}
        onRepartidor={() => { setClienteSesion(null); setShowAuth(false); setTab('entregas') }}
        onInvitado={() => { setInvitado(true); setShowAuth(false) }}
        onCancel={showAuth ? () => setShowAuth(false) : undefined} />
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 text-gray-900">
      {/* Barra superior */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-3">
          <img src={resolveMediaUrl(tienda.logoPath) || defaultLogo} alt="" className="w-10 h-10 rounded-full object-cover border border-gray-200" />
          <p className="font-bold text-lg truncate flex-1">{tienda.nombre}</p>
          <nav className="hidden sm:flex items-center gap-1 text-sm font-medium">
            {!esRepartidor && (
              <button onClick={() => setTab('menu')} className={`px-3 py-2 rounded-lg ${tab === 'menu' ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-100'}`}>Menú</button>
            )}
            {tienda.mostrarMesas && !esRepartidor && (
              <button onClick={() => setTab('mesas')} className={`px-3 py-2 rounded-lg ${tab === 'mesas' ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-100'}`}>Mesas</button>
            )}
            {puedeReservar && (
              <button onClick={() => setTab('reservar')} className={`px-3 py-2 rounded-lg ${tab === 'reservar' ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-100'}`}>📅 Reservar</button>
            )}
            {esRepartidor && (
              <button onClick={() => setTab('entregas')} className={`px-3 py-2 rounded-lg ${tab === 'entregas' ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-100'}`}>🛵 Entregas</button>
            )}
            {cliente && (
              <button onClick={() => setTab('mispedidos')} className={`px-3 py-2 rounded-lg ${tab === 'mispedidos' ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-100'}`}>Mis pedidos</button>
            )}
          </nav>
          {/* Cuenta: invitado → iniciar sesión; cliente/repartidor → menú con sus opciones */}
          {invitado && !cliente && !esRepartidor ? (
            <button onClick={() => setShowAuth(true)} className="px-3 py-2 rounded-lg text-sm font-semibold text-purple-700 hover:bg-purple-50 whitespace-nowrap">
              Iniciar sesión
            </button>
          ) : (
            <div className="relative">
              <button onClick={() => setMenuCuenta((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 max-w-[10rem]">
                <span>{esRepartidor ? '🛵' : '👤'}</span>
                <span className="truncate hidden sm:inline">{esRepartidor ? staffUser.name : cliente?.nombre?.split(' ')[0]}</span>
                <span className="text-xs">▾</span>
              </button>
              {menuCuenta && (
                <div className="absolute right-0 mt-1 w-52 rounded-xl border border-gray-200 bg-white shadow-xl py-1 z-40">
                  <p className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100 truncate">
                    {esRepartidor ? `Repartidor · ${staffUser.name}` : cliente?.email}
                  </p>
                  {cliente && (
                    <>
                      <button onClick={() => { setTab('mispedidos'); setMenuCuenta(false) }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">📦 Mis pedidos</button>
                      {puedeReservar && (
                        <button onClick={() => { setTab('reservar'); setMenuCuenta(false) }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">📅 Mis reservaciones</button>
                      )}
                      <button onClick={() => { setTab('perfil'); setMenuCuenta(false) }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">👤 Mis datos</button>
                    </>
                  )}
                  {esRepartidor && (
                    <button onClick={() => { setTab('entregas'); setMenuCuenta(false) }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">🛵 Mis entregas</button>
                  )}
                  <button onClick={cerrarSesion} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">Cerrar sesión</button>
                </div>
              )}
            </div>
          )}
          {!cliente && pedidos.length > 0 && (
            <button onClick={() => setTab('pedido')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold ${tab === 'pedido' ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
              📦 {pedidos.length === 1 ? 'Mi pedido' : `Mis pedidos (${pedidos.length})`}
              {pedidosActivos > 0 && tab !== 'pedido' && <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
            </button>
          )}
          {puedePedir && (
            <button onClick={() => { setCartOpen(true); setCheckout(false) }}
              className="relative px-4 py-2 rounded-full bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700">
              🛒 <span className="hidden sm:inline">Carrito</span>
              {cartCount > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">{cartCount}</span>}
            </button>
          )}
        </div>
        {/* Pestañas en móvil */}
        <div className="sm:hidden flex border-t border-gray-100 text-sm font-medium">
          {!esRepartidor && (
            <button onClick={() => setTab('menu')} className={`flex-1 py-2.5 ${tab === 'menu' ? 'text-purple-700 border-b-2 border-purple-600' : 'text-gray-500'}`}>Menú</button>
          )}
          {tienda.mostrarMesas && !esRepartidor && (
            <button onClick={() => setTab('mesas')} className={`flex-1 py-2.5 ${tab === 'mesas' ? 'text-purple-700 border-b-2 border-purple-600' : 'text-gray-500'}`}>Mesas</button>
          )}
          {puedeReservar && (
            <button onClick={() => setTab('reservar')} className={`flex-1 py-2.5 ${tab === 'reservar' ? 'text-purple-700 border-b-2 border-purple-600' : 'text-gray-500'}`}>Reservar</button>
          )}
          {esRepartidor && (
            <button onClick={() => setTab('entregas')} className={`flex-1 py-2.5 ${tab === 'entregas' ? 'text-purple-700 border-b-2 border-purple-600' : 'text-gray-500'}`}>Entregas</button>
          )}
          {cliente && (
            <button onClick={() => setTab('mispedidos')} className={`flex-1 py-2.5 ${tab === 'mispedidos' ? 'text-purple-700 border-b-2 border-purple-600' : 'text-gray-500'}`}>Mis pedidos</button>
          )}
        </div>
      </header>

      {/* Portada (no para el repartidor: él solo ve sus entregas) */}
      {!esRepartidor && (
      <section className="bg-gradient-to-br from-purple-700 via-purple-600 to-purple-500 text-white">
        <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14 flex flex-col sm:flex-row items-center gap-6">
          <img src={resolveMediaUrl(tienda.logoPath) || defaultLogo} alt="" className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover border-4 border-white/70 shadow-xl bg-white" />
          <div className="text-center sm:text-left">
            <h1 className="text-3xl sm:text-4xl font-extrabold">{tienda.nombre}</h1>
            {tienda.mensaje && <p className="mt-2 text-white/90 whitespace-pre-line max-w-2xl">{tienda.mensaje}</p>}
            <div className="mt-4 flex flex-wrap justify-center sm:justify-start gap-2 text-sm">
              {tienda.recoger && <span className="px-3 py-1 rounded-full bg-white/20">🛍️ Para recoger</span>}
              {tienda.domicilio && (
                <span className="px-3 py-1 rounded-full bg-white/20">
                  🛵 A domicilio{Number(tienda.costoEnvio) > 0 ? ` · envío ${fmt(tienda.costoEnvio)}` : ' · envío gratis'}
                </span>
              )}
              {puedeReservar && (
                <button type="button" onClick={() => setTab('reservar')} className="px-3 py-1 rounded-full bg-white text-purple-700 font-semibold hover:bg-white/90">📅 Reservar mesa</button>
              )}
              {tienda.direccion && <span className="px-3 py-1 rounded-full bg-white/20">📍 {tienda.direccion}</span>}
              {tienda.telefono && <a href={`tel:${tienda.telefono}`} className="px-3 py-1 rounded-full bg-white/20 hover:bg-white/30">📞 {tienda.telefono}</a>}
            </div>
          </div>
        </div>
      </section>
      )}

      <main className="max-w-6xl mx-auto px-4 py-8 pb-28">
        {avisoCorreo && (
          <div className={`mb-4 rounded-xl border px-4 py-3 text-sm flex items-start gap-3 ${avisoCorreo.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            <p className="flex-1">{avisoCorreo.texto}</p>
            <button type="button" onClick={() => setAvisoCorreo(null)} className="opacity-60 hover:opacity-100">✕</button>
          </div>
        )}
        {cliente && !cliente.emailVerificado && (
          <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 flex flex-wrap items-center gap-2">
            <p className="flex-1 min-w-[12rem]">📧 Confirma tu correo (<b>{cliente.email}</b>) con el enlace que te enviamos para poder hacer pedidos con tu cuenta.</p>
            <button type="button" disabled={reenviando} onClick={reenviarCorreo}
              className="rounded-full border border-yellow-400 px-3 py-1 font-semibold hover:bg-yellow-100 disabled:opacity-40">
              {reenviando ? 'Enviando...' : 'Reenviar correo'}
            </button>
          </div>
        )}
        {tab === 'menu' && !esRepartidor && (
          <>
            {!puedePedir && (
              <p className="mb-6 rounded-xl bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 text-sm">
                Por ahora este restaurante no recibe pedidos en línea, pero puedes ver su menú.
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center mb-4">
              <h2 className="text-2xl font-bold flex-1">Nuestro menú</h2>
              <input className="w-full sm:w-72 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                placeholder="🔍 Buscar platillo..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>

            {/* Categorías */}
            {filteredMenu.length > 0 && (
              <div className="sticky top-[105px] sm:top-16 z-20 -mx-4 px-4 py-2 bg-stone-50/95 backdrop-blur flex gap-2 overflow-x-auto shadow-sm">
                {filteredMenu.map((c) => (
                  <button key={c.id ?? 'otros'} onClick={() => scrollToCat(c.id)}
                    className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border ${
                      activeCat === c.id ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-200 hover:border-purple-300'}`}>
                    {c.nombre}
                  </button>
                ))}
              </div>
            )}

            {filteredMenu.length === 0 && (
              <p className="text-center text-gray-400 py-16">{search ? 'No encontramos ese platillo.' : 'El menú no está disponible en este momento.'}</p>
            )}

            {filteredMenu.map((c) => (
              <section key={c.id ?? 'otros'} id={`cat-${c.id ?? 'otros'}`} className="scroll-mt-40 sm:scroll-mt-32 mt-6">
                <h3 className="text-xl font-bold">{c.nombre}</h3>
                {c.descripcion && <p className="text-sm text-gray-500">{c.descripcion}</p>}
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {c.productos.map((p) => {
                    const qty = qtyOfProduct(p.id)
                    return (
                      <article key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex">
                        {p.imageUrl ? (
                          <img src={resolveMediaUrl(p.imageUrl)} alt={p.nombre} className="w-28 sm:w-32 min-h-28 object-cover shrink-0" />
                        ) : (
                          // Sin foto: mismo recuadro con plato que en el punto de venta.
                          <div className="w-28 sm:w-32 min-h-28 bg-gray-100 flex items-center justify-center text-3xl text-gray-300 shrink-0">🍽️</div>
                        )}
                        <div className="flex-1 p-4 flex flex-col min-w-0">
                          <p className="font-semibold leading-snug">{p.nombre}</p>
                          {p.descripcion && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{p.descripcion}</p>}
                          <div className="mt-auto pt-3 flex items-center justify-between gap-2">
                            <span className="font-bold text-purple-700">{fmt(p.precio)}</span>
                            {puedePedir && (
                              <button onClick={() => (p.grupos.length > 0 ? setCustomize(p) : addToCart(p))}
                                className="px-3 py-1.5 rounded-full bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700">
                                {qty > 0 ? `Agregar (${qty})` : 'Agregar'}
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </>
        )}

        {tab === 'mesas' && tienda.mostrarMesas && !esRepartidor && (
          <>
            <h2 className="text-2xl font-bold">Disponibilidad de mesas</h2>
            <p className="text-sm text-gray-500 mt-1">
              Se actualiza automáticamente.{' '}
              {puedeReservar
                ? <button type="button" onClick={() => setTab('reservar')} className="font-semibold text-purple-700 hover:underline">📅 Reserva tu mesa aquí</button>
                : <>Para reservar, llámanos{tienda.telefono ? ` al ${tienda.telefono}` : ''}.</>}
            </p>
            <div className="mt-3 flex gap-3 text-xs">
              {Object.entries(MESA_LABEL).map(([k, v]) => (
                <span key={k} className={`px-2 py-1 rounded-md border font-semibold ${MESA_STYLE[k]}`}>{v}</span>
              ))}
            </div>
            {zonas.length === 0 && <p className="text-center text-gray-400 py-16">No hay mesas para mostrar.</p>}
            <div className="mt-6 space-y-6">
              {zonas.map((z) => (
                <section key={z.nombre} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-lg font-bold">{z.nombre}</h3>
                    <p className="text-sm">
                      <span className="font-semibold text-green-700">{z.libres} libre{z.libres === 1 ? '' : 's'}</span>
                      <span className="text-gray-400"> · </span>
                      <span className="font-semibold text-red-700">{z.ocupadas} ocupada{z.ocupadas === 1 ? '' : 's'}</span>
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-3">
                    {z.mesas.map((m) => (
                      <div key={m.numero} className={`rounded-xl border-2 p-3 text-center ${MESA_STYLE[m.estado] ?? ''}`}>
                        <p className="font-bold">Mesa {m.numero}</p>
                        <p className="text-xs font-semibold uppercase mt-0.5">{MESA_LABEL[m.estado] ?? m.estado}</p>
                        {m.capacidad && <p className="text-xs opacity-70 mt-0.5">👥 {m.capacidad}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

        {esRepartidor && <Deliveries />}

        {tab === 'reservar' && puedeReservar && (
          <Reservaciones slug={slug} tienda={tienda} cliente={cliente} clienteToken={clienteSesion?.token} onSesionVencida={sesionVencida} />
        )}

        {tab === 'mispedidos' && cliente && (
          <MisPedidos slug={slug} tienda={tienda} token={clienteSesion.token} onSesionVencida={sesionVencida} onPedir={() => setTab('menu')}
            onRepetir={puedePedir ? repetirPedido : undefined} />
        )}

        {tab === 'perfil' && cliente && (
          <PerfilCliente slug={slug} token={clienteSesion.token} cliente={cliente} onSesionVencida={sesionVencida}
            onActualizado={(c) => setClienteSesion((s) => ({ ...s, cliente: c }))} />
        )}

        {tab === 'pedido' && (
          <div className="max-w-xl mx-auto space-y-6">
            <h2 className="text-2xl font-bold">{pedidos.length === 1 ? 'Mi pedido' : 'Mis pedidos'}</h2>
            {pedidos.length === 0 && <p className="text-center text-gray-400 py-10">No tienes pedidos en seguimiento.</p>}
            {[...pedidos].reverse().map((p) => (
              <PedidoTracker key={p.id} tienda={tienda} status={statuses[p.id]} onCerrar={() => cerrarSeguimiento(p.id)}
                slug={slug} token={p.token} onActualizado={(st) => setStatuses((s) => ({ ...s, [p.id]: st }))} />
            ))}
            {puedePedir && (
              <button onClick={() => setTab('menu')} className="w-full rounded-full border border-gray-300 bg-white py-3 font-semibold hover:bg-gray-50">
                Hacer otro pedido
              </button>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-6 text-sm text-gray-500 flex flex-col sm:flex-row gap-2 justify-between">
          <p>© {new Date().getFullYear()} {tienda.nombre}{tienda.direccion ? ` · ${tienda.direccion}` : ''}</p>
          <p className="text-gray-400">
            Pedidos en línea con RestoPOS{!esRepartidor && !cliente && (
              <> · <button type="button" onClick={() => setShowAuth(true)} className="hover:text-gray-600 hover:underline">Acceso repartidores</button></>
            )}
          </p>
        </div>
      </footer>

      {/* Botón flotante de carrito en móvil */}
      {puedePedir && cartCount > 0 && !cartOpen && (
        <button onClick={() => { setCartOpen(true); setCheckout(false) }}
          className="sm:hidden fixed bottom-4 inset-x-4 z-30 flex items-center justify-between rounded-full bg-purple-600 text-white px-5 py-3.5 font-semibold shadow-xl">
          <span>🛒 Ver carrito ({cartCount})</span><span>{fmt(cartTotal)}</span>
        </button>
      )}

      {/* Tiempo real del seguimiento de invitado: una conexión por pedido que sigue en curso. */}
      {pedidos.filter((p) => !['ENTREGADO', 'RECHAZADO'].includes(statuses[p.id]?.estado)).map((p) => (
        <SeguimientoEnVivo key={p.id} slug={slug} token={p.token} onCambio={() => cargarPedido(p)} />
      ))}

      {customize && (
        <CustomizeModal producto={customize} onClose={() => setCustomize(null)}
          onAdd={(mods, nota, cantidad) => { addToCart(customize, mods, nota, cantidad); setCustomize(null) }} />
      )}

      {cartOpen && (
        <CartDrawer
          slug={slug} tienda={tienda} cart={cart} total={cartTotal} checkout={checkout}
          cliente={cliente} clienteToken={clienteSesion?.token} onSesionVencida={() => { sesionVencida(); setCartOpen(false) }}
          setCheckout={setCheckout} setQty={setQty} onClose={() => { setCartOpen(false); setAvisoCarrito(null) }}
          aviso={avisoCarrito} onCerrarAviso={() => setAvisoCarrito(null)}
          onPedidoCreado={(p) => {
            setCart([])
            setCartOpen(false)
            // Registrado: lo ve en "Mis pedidos" (desde el servidor). Invitado: seguimiento por código en este navegador.
            if (cliente) setTab('mispedidos')
            else { setPedidos((list) => [...list.filter((x) => x.id !== p.id), p]); setTab('pedido') }
            window.scrollTo({ top: 0 })
          }}
        />
      )}
    </div>
  )
}

/** Modal para elegir modificadores (término, extras...), cantidad y nota de un producto. */
function CustomizeModal({ producto, onClose, onAdd }) {
  useEscapeKey(onClose)
  const [sel, setSel] = useState(() => Object.fromEntries(producto.grupos.map((g) => [g.id, []])))
  const [nota, setNota] = useState('')
  const [cantidad, setCantidad] = useState(1)

  function toggle(g, opcionId) {
    setSel((s) => {
      const cur = s[g.id] ?? []
      if (g.tipo === 'UNICO') return { ...s, [g.id]: cur.includes(opcionId) ? [] : [opcionId] }
      return { ...s, [g.id]: cur.includes(opcionId) ? cur.filter((i) => i !== opcionId) : [...cur, opcionId] }
    })
  }
  const mods = producto.grupos.flatMap((g) => g.opciones.filter((o) => (sel[g.id] ?? []).includes(o.id)).map((o) => ({ ...o, grupo: g.nombre })))
  const falta = producto.grupos.some((g) => g.obligatorio && (sel[g.id]?.length ?? 0) === 0)
  const unit = Number(producto.precio) + mods.reduce((s, m) => s + Number(m.precioExtra), 0)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {producto.imageUrl && <img src={resolveMediaUrl(producto.imageUrl)} alt="" className="w-full h-44 object-cover sm:rounded-t-2xl rounded-t-2xl" />}
        <div className="p-5 border-b border-gray-100">
          <h3 className="text-xl font-bold">{producto.nombre}</h3>
          {producto.descripcion && <p className="text-sm text-gray-500 mt-1">{producto.descripcion}</p>}
          <p className="font-semibold text-purple-700 mt-2">{fmt(producto.precio)}</p>
        </div>
        <div className="p-5 space-y-5 overflow-y-auto">
          {producto.grupos.map((g) => (
            <div key={g.id}>
              <div className="flex items-center justify-between">
                <p className="font-semibold">{g.nombre}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${g.obligatorio ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                  {g.obligatorio ? 'Obligatorio' : 'Opcional'}{g.tipo !== 'UNICO' ? ' · varias' : ''}
                </span>
              </div>
              <div className="mt-2 space-y-2">
                {g.opciones.map((o) => {
                  const on = (sel[g.id] ?? []).includes(o.id)
                  return (
                    <button key={o.id} type="button" onClick={() => toggle(g, o.id)}
                      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${on ? 'border-purple-600 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <span className={`w-5 h-5 shrink-0 flex items-center justify-center text-xs font-bold ${g.tipo === 'UNICO' ? 'rounded-full' : 'rounded'} ${on ? 'bg-purple-600 text-white' : 'border border-gray-300'}`}>{on ? '✓' : ''}</span>
                      <span className="flex-1">{o.nombre}</span>
                      {Number(o.precioExtra) > 0 && <span className="text-sm text-gray-500">+{fmt(o.precioExtra)}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div>
            <p className="font-semibold">Instrucciones especiales</p>
            <textarea className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              rows={2} maxLength={200} placeholder="Ej. sin cebolla" value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        </div>
        {unit > Number(producto.precio) && (
          <p className="px-4 pt-3 text-xs text-gray-600 text-right border-t border-gray-100">
            {fmt(producto.precio)} + {fmt(unit - Number(producto.precio))} extras = <b>{fmt(unit)}</b> c/u
          </p>
        )}
        <div className="p-4 border-t border-gray-100 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setCantidad((q) => Math.max(1, q - 1))} className="w-9 h-9 rounded-full bg-gray-100 font-bold">−</button>
            <span className="w-6 text-center font-semibold">{cantidad}</span>
            <button type="button" onClick={() => setCantidad((q) => Math.min(99, q + 1))} className="w-9 h-9 rounded-full bg-gray-100 font-bold">+</button>
          </div>
          <button type="button" disabled={falta} onClick={() => onAdd(mods, nota, cantidad)}
            className="flex-1 rounded-full bg-purple-600 text-white py-3 font-semibold hover:bg-purple-700 disabled:opacity-40">
            {falta ? 'Elige las opciones obligatorias' : `Agregar · ${fmt(unit * cantidad)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Panel lateral del carrito; en su segundo paso, el formulario para enviar el pedido. */
function CartDrawer({ slug, tienda, cart, total, checkout, setCheckout, setQty, onClose, onPedidoCreado, cliente, clienteToken, onSesionVencida, aviso, onCerrarAviso }) {
  useEscapeKey(onClose)
  const pagos = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'].filter((k) =>
    (k === 'EFECTIVO' && tienda.pagoEfectivo) || (k === 'TARJETA' && tienda.pagoTarjeta) || (k === 'TRANSFERENCIA' && tienda.pagoTransferencia))
  const [form, setForm] = useState(() => ({
    // Cliente registrado: sus datos ya vienen llenos (los puede cambiar para este pedido).
    nombre: cliente?.nombre ?? '', telefono: cliente?.telefono ?? '', direccion: cliente?.direccion ?? '', notas: '',
    tipoEntrega: tienda.recoger ? 'RECOGER' : 'DOMICILIO',
    metodoPago: pagos[0] ?? '',
  }))
  const [errors, setErrors] = useState({})
  const [sending, setSending] = useState(false)
  const [serverError, setServerError] = useState('')
  // Llave única de este intento de pedido: si el envío se repite (doble clic, red lenta), el
  // backend reconoce la llave y devuelve el mismo pedido en vez de crear otro.
  const [idemKey] = useState(nuevaLlave)
  const correoSinConfirmar = !!cliente && !cliente.emailVerificado

  const envio = form.tipoEntrega === 'DOMICILIO' ? Number(tienda.costoEnvio || 0) : 0
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })) }

  async function enviar(e) {
    e.preventDefault()
    if (sending || correoSinConfirmar) return
    const errs = {}
    if (!form.nombre.trim()) errs.nombre = 'Escribe tu nombre'
    if (!form.telefono.trim()) errs.telefono = 'Escribe tu teléfono'
    else if (form.telefono.replace(/\D/g, '').length < 8) errs.telefono = 'Revisa tu teléfono'
    if (form.tipoEntrega === 'DOMICILIO' && !form.direccion.trim()) errs.direccion = 'Escribe la dirección de entrega'
    if (!form.metodoPago) errs.metodoPago = 'Elige cómo vas a pagar'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSending(true)
    setServerError('')
    try {
      const res = await createPublicPedido(slug, {
        clienteNombre: form.nombre.trim(),
        clienteTelefono: form.telefono.trim(),
        tipoEntrega: form.tipoEntrega,
        direccion: form.tipoEntrega === 'DOMICILIO' ? form.direccion.trim() : undefined,
        metodoPago: form.metodoPago,
        notas: form.notas.trim() || undefined,
        items: cart.map((l) => ({
          productoId: l.productoId, cantidad: l.cantidad,
          observaciones: l.nota || undefined, modificadorOpcionIds: l.mods.map((m) => m.id),
        })),
      }, clienteToken, idemKey)
      onPedidoCreado({ id: res.data.data.id, token: res.data.data.token })
    } catch (err) {
      if (err.response?.status === 401) { onSesionVencida(); return }
      setServerError(err.response?.data?.message ?? 'No pudimos enviar tu pedido. Intenta de nuevo.')
    } finally {
      setSending(false)
    }
  }

  const inputCls = 'mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-300'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <aside className="bg-white w-full sm:max-w-md h-full flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="h-16 px-5 flex items-center justify-between border-b border-gray-100">
          {checkout ? (
            <button onClick={() => setCheckout(false)} className="text-sm font-medium text-gray-600 hover:text-gray-900">← Volver al carrito</button>
          ) : <h2 className="text-lg font-bold">Tu pedido</h2>}
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-gray-100 text-gray-500">✕</button>
        </div>

        {!checkout ? (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {aviso && (
                <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-900 flex items-start gap-2">
                  <p className="flex-1">⚠️ {aviso}</p>
                  <button type="button" onClick={onCerrarAviso} className="opacity-60 hover:opacity-100">✕</button>
                </div>
              )}
              {cart.length === 0 && <p className="text-center text-gray-400 py-16">Tu carrito está vacío.</p>}
              {cart.map((l) => (
                <div key={l.key} className="flex gap-3">
                  {l.imageUrl ? <img src={resolveMediaUrl(l.imageUrl)} alt="" className="w-16 h-16 rounded-xl object-cover" /> : <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center text-2xl">🍽️</div>}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold leading-snug">{l.nombre}</p>
                    {l.mods.map((m) => (
                      <p key={m.id} className="text-xs text-gray-500">{m.grupo}: {m.nombre}{Number(m.precioExtra) > 0 ? ` (+${fmt(m.precioExtra)})` : ''}</p>
                    ))}
                    {l.mods.some((m) => Number(m.precioExtra) > 0) && (
                      <p className="text-xs font-medium text-purple-700">{fmt(l.precio)} + {fmt(lineUnit(l) - Number(l.precio))} extras = {fmt(lineUnit(l))} c/u</p>
                    )}
                    {l.nota && <p className="text-xs text-gray-500 italic">"{l.nota}"</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setQty(l.key, l.cantidad - 1)} className="w-7 h-7 rounded-full bg-gray-100 font-bold">−</button>
                        <span className="w-5 text-center text-sm font-semibold">{l.cantidad}</span>
                        <button onClick={() => setQty(l.key, l.cantidad + 1)} className="w-7 h-7 rounded-full bg-gray-100 font-bold">+</button>
                      </div>
                      <span className="font-semibold">{fmt(lineUnit(l) * l.cantidad)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-5 border-t border-gray-100">
              <div className="flex justify-between font-bold text-lg mb-3"><span>Subtotal</span><span>{fmt(total)}</span></div>
              <button disabled={cart.length === 0} onClick={() => setCheckout(true)}
                className="w-full rounded-full bg-purple-600 text-white py-3.5 font-semibold hover:bg-purple-700 disabled:opacity-40">
                Continuar
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={enviar} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <p className="font-semibold mb-2">¿Cómo lo quieres?</p>
                <div className="grid grid-cols-2 gap-2">
                  {tienda.recoger && (
                    <button type="button" onClick={() => set('tipoEntrega', 'RECOGER')}
                      className={`rounded-xl border-2 p-3 text-left ${form.tipoEntrega === 'RECOGER' ? 'border-purple-600 bg-purple-50' : 'border-gray-200'}`}>
                      <p className="font-semibold">🛍️ Recoger</p><p className="text-xs text-gray-500">En el restaurante</p>
                    </button>
                  )}
                  {tienda.domicilio && (
                    <button type="button" onClick={() => set('tipoEntrega', 'DOMICILIO')}
                      className={`rounded-xl border-2 p-3 text-left ${form.tipoEntrega === 'DOMICILIO' ? 'border-purple-600 bg-purple-50' : 'border-gray-200'}`}>
                      <p className="font-semibold">🛵 A domicilio</p>
                      <p className="text-xs text-gray-500">{Number(tienda.costoEnvio) > 0 ? `Envío ${fmt(tienda.costoEnvio)}` : 'Envío gratis'}</p>
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <p className="font-semibold">Tus datos</p>
                <label className="block text-sm text-gray-600">Nombre *
                  <input className={inputCls} maxLength={100} value={form.nombre} onChange={(e) => set('nombre', e.target.value)} autoComplete="name" />
                  {errors.nombre && <span className="text-xs text-red-600">{errors.nombre}</span>}
                </label>
                <label className="block text-sm text-gray-600">Teléfono *
                  <input className={inputCls} type="tel" maxLength={30} value={form.telefono} onChange={(e) => set('telefono', e.target.value)} autoComplete="tel" />
                  {errors.telefono && <span className="text-xs text-red-600">{errors.telefono}</span>}
                </label>
                {form.tipoEntrega === 'DOMICILIO' && (
                  <label className="block text-sm text-gray-600">Dirección de entrega *
                    <textarea className={inputCls} rows={2} maxLength={200} placeholder="Calle, número, colonia, referencias" value={form.direccion} onChange={(e) => set('direccion', e.target.value)} autoComplete="street-address" />
                    {errors.direccion && <span className="text-xs text-red-600">{errors.direccion}</span>}
                  </label>
                )}
              </div>

              <div>
                <p className="font-semibold mb-2">Forma de pago</p>
                <div className="space-y-2">
                  {pagos.map((k) => (
                    <button key={k} type="button" onClick={() => set('metodoPago', k)}
                      className={`w-full rounded-xl border-2 px-3 py-2.5 text-left ${form.metodoPago === k ? 'border-purple-600 bg-purple-50' : 'border-gray-200'}`}>
                      <p className="font-semibold">{PAGO_LABEL[k]}</p>
                      <p className="text-xs text-gray-500">{PAGO_HINT[k]}</p>
                    </button>
                  ))}
                </div>
                {errors.metodoPago && <p className="text-xs text-red-600 mt-1">{errors.metodoPago}</p>}
                {form.metodoPago === 'TRANSFERENCIA' && <TransferenciaInfo tienda={tienda} />}
              </div>

              <label className="block text-sm text-gray-600">Comentarios del pedido (opcional)
                <textarea className={inputCls} rows={2} maxLength={500} value={form.notas} onChange={(e) => set('notas', e.target.value)} />
              </label>
            </div>
            <div className="p-5 border-t border-gray-100 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-600"><span>Productos</span><span>{fmt(total)}</span></div>
              {form.tipoEntrega === 'DOMICILIO' && <div className="flex justify-between text-sm text-gray-600"><span>Envío</span><span>{envio > 0 ? fmt(envio) : 'Gratis'}</span></div>}
              <div className="flex justify-between font-bold text-lg pt-1"><span>Total</span><span>{fmt(total + envio)}</span></div>
              {serverError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{serverError}</p>}
              {correoSinConfirmar && (
                <p className="text-sm text-yellow-900 bg-yellow-50 rounded-lg px-3 py-2">📧 Confirma tu correo para hacer pedidos con tu cuenta (revisa tu bandeja de entrada).</p>
              )}
              <button type="submit" disabled={sending || correoSinConfirmar}
                className="w-full mt-2 rounded-full bg-purple-600 text-white py-3.5 font-semibold hover:bg-purple-700 disabled:opacity-40">
                {sending ? 'Enviando...' : 'Enviar pedido'}
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  )
}

function TransferenciaInfo({ tienda }) {
  return (
    <div className="mt-3 rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900 space-y-0.5">
      <p className="font-semibold">Datos para transferir</p>
      {tienda.transferenciaBanco && <p>Banco: <span className="font-medium">{tienda.transferenciaBanco}</span></p>}
      {tienda.transferenciaTitular && <p>Titular: <span className="font-medium">{tienda.transferenciaTitular}</span></p>}
      {tienda.transferenciaClabe && <p>CLABE / cuenta: <span className="font-mono font-semibold select-all">{tienda.transferenciaClabe}</span></p>}
    </div>
  )
}

/**
 * Seguimiento de un pedido enviado: Recibido → En preparación → Listo → Entregado. Se queda
 * visible hasta que se entrega (o se rechaza); solo entonces aparece "Cerrar seguimiento".
 */
function PedidoTracker({ tienda, status, onCerrar, slug, token, onActualizado }) {
  if (!status) return <p className="text-center text-gray-400 py-8 bg-white rounded-2xl border border-gray-100">Cargando tu pedido...</p>
  const rechazado = status.estado === 'RECHAZADO'
  const steps = STEPS.filter((s) => !s.soloDomicilio || status.tipoEntrega === 'DOMICILIO')
  const idx = steps.findIndex((s) => s.key === status.estado)
  const terminado = rechazado || status.estado === 'ENTREGADO'

  return (
    <div>
      <div className={`bg-white rounded-2xl border shadow-sm p-6 ${terminado ? 'border-gray-100' : 'border-green-300'}`}>
        <p className="text-sm text-gray-500">Pedido #{status.id} · {status.tipoEntrega === 'DOMICILIO' ? '🛵 A domicilio' : '🛍️ Para recoger'}</p>
        {rechazado ? (
          <>
            <h2 className="text-2xl font-bold text-red-700 mt-1">Pedido no aceptado</h2>
            <p className="text-gray-600 mt-2">
              El restaurante no pudo aceptar tu pedido{status.motivoRechazo ? `: ${status.motivoRechazo}` : '.'}
              {tienda.telefono ? ` Si tienes dudas, llámanos al ${tienda.telefono}.` : ''}
            </p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold mt-1">{steps[idx]?.label ?? status.estado}</h2>
            <p className="text-gray-600 mt-1">{steps[idx]?.hint}</p>
            <ol className={`mt-6 grid gap-2 ${steps.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
              {steps.map((s, i) => (
                <li key={s.key} className="text-center">
                  <div className={`h-2 rounded-full ${i <= idx ? 'bg-purple-600' : 'bg-gray-200'}`} />
                  <p className={`text-xs mt-2 ${i <= idx ? 'text-purple-700 font-semibold' : 'text-gray-400'}`}>{s.label}</p>
                </li>
              ))}
            </ol>
          </>
        )}

        <div className="mt-6 border-t border-gray-100 pt-4 space-y-2">
          {status.items.map((it, i) => (
            <div key={i} className="flex justify-between gap-3 text-sm">
              <div>
                <p className="font-medium">{Number(it.cantidad)}× {it.nombre}</p>
                {it.modificadores.map((m) => <p key={m} className="text-xs text-gray-500">{m}</p>)}
              </div>
              <span>{fmt(it.subtotal)}</span>
            </div>
          ))}
          <div className="flex justify-between font-bold text-lg pt-2 border-t border-gray-100"><span>Total</span><span>{fmt(status.total)}</span></div>
          <p className="text-sm text-gray-500">Pago: {PAGO_LABEL[status.metodoPago] ?? status.metodoPago}</p>
          {status.metodoPago === 'TRANSFERENCIA' && !terminado && <TransferenciaInfo tienda={tienda} />}
          {puedeSubirComprobante(status) && slug && token && (
            <ComprobanteTransferencia status={status} onActualizado={onActualizado}
              onSubir={(file, incluyeEnvio) => uploadComprobantePedido(slug, token, file, incluyeEnvio)} />
          )}
        </div>
        {!terminado && <p className="text-xs text-gray-400 mt-4">Se actualiza solo. Este seguimiento se queda aquí hasta que recibas tu pedido.</p>}
        {terminado && (
          <button onClick={onCerrar} className="mt-4 w-full rounded-full border border-gray-300 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            Cerrar seguimiento
          </button>
        )}
      </div>
    </div>
  )
}

/** Sin interfaz: escucha en tiempo real los cambios de UN pedido (por su código) y avisa para recargarlo. */
function SeguimientoEnVivo({ slug, token, onCambio }) {
  usePublicLiveRefresh(`${publicStreamBase(slug)}/seguimiento/${encodeURIComponent(token)}/eventos`, onCambio)
  return null
}

/**
 * Llave aleatoria para Idempotency-Key. crypto.randomUUID solo existe en contexto seguro
 * (HTTPS o localhost); en la red local por IP (http://192.168.x.x) se arma con getRandomValues.
 */
function nuevaLlave() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try { return crypto.randomUUID() } catch { /* contexto no seguro */ }
  }
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
