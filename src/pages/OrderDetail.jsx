import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getOrder, addDiner, deleteDiner, addOrderItem, cancelOrderItem, cancelOrder, updateOrderItemStatus, updateOrderItem, acceptWebOrder } from '../api/ordenes'
import { createAccount, getAccountsByOrder, cancelAccount, getTicketPdf } from '../api/cuentas'
import { createPayment } from '../api/pagos'
import { getCategories, updateCategoryAvailabilityMode } from '../api/categories'
import { searchProducts, getTopSellingProducts } from '../api/products'
import { getOpenCashCut } from '../api/cashCuts'
import { printAccountTicket } from '../utils/printer'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { useLiveRefresh } from '../utils/liveEvents'
import { getModificadorGrupos } from '../api/modificadores'
import { resolveMediaUrl } from '../utils/media'
import { useEscapeKey } from '../hooks/useEscapeKey'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)

// Mismo patrón que el POS de DemoPV para validar formato de correo del lado del cliente —
// no reemplaza al @Email real del backend, solo adelanta el error más común.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ESTADO_ORDEN_LABEL = {
  ABIERTA: 'Abierta', EN_PROCESO: 'En proceso', LISTA: 'Lista',
  PENDIENTE_PAGO: 'Pendiente de pago', PAGADA: 'Pagada', CANCELADA: 'Cancelada',
}

const MODE_LABEL = { AUTO: 'Automático', FORCE_VISIBLE: 'Visible', FORCE_HIDDEN: 'Oculto' }
// "HH:mm:ss" (lo que manda el backend) -> "HH:mm", para mostrar el horario configurado de una categoría.
const toDisplayTime = (t) => (t ? t.slice(0, 5) : '')

/**
 * Detalle de una orden: comensales, productos pedidos, y el flujo de cobro (generar
 * cuenta total/por comensal/personalizada, registrar pago(s), ver/enviar ticket).
 * Se usa tanto para órdenes de mesa (llegando desde el tablero de Mesas) como para
 * órdenes para llevar / consultadas desde el historial de Órdenes.
 */
export default function OrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isAdmin, isMesero, hasSection } = useAuth()
  const { notify, confirmDialog } = useNotify()

  const [order, setOrder] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(false)

  const [showAddItem, setShowAddItem] = useState(false)
  const [products, setProducts] = useState([])
  const [productQuery, setProductQuery] = useState('')
  const [productCat, setProductCat] = useState('')
  const [pickerComensalId, setPickerComensalId] = useState('')
  // Categoría sobre la que se está por cambiar el modo de disponibilidad (AUTO/FORCE_VISIBLE/
  // FORCE_HIDDEN) desde el mini-modal apilado sobre "Agregar producto" — null si está cerrado.
  const [categoryModeTarget, setCategoryModeTarget] = useState(null)
  // "Marcar todo entregado" en curso, para deshabilitar ese botón mientras corren todas sus
  // llamadas (una por producto pendiente) y no duplicar la acción con un doble clic.
  const [marcandoTodo, setMarcandoTodo] = useState(false)
  const [cart, setCart] = useState({}) // { [productoId]: { cantidad, observaciones } }

  // Selector de modificadores: se abre, apilado sobre showAddItem, al "personalizar" un
  // producto que tiene grupos de modificadores (ej. "Término de cocción", "Extras") — esos
  // productos no pasan por el carrito de arriba, se agregan de uno en uno al confirmar.
  const [modPicker, setModPicker] = useState(null) // producto en personalización, o null
  const [modSelections, setModSelections] = useState({}) // { [grupoId]: [opcionId, ...] }
  const [modNota, setModNota] = useState('')
  // Acordeón: qué grupos están desplegados — todos cerrados al abrir el selector, para que un
  // producto con varios grupos (ej. sabores + extras + aparte) no se vea como una lista enorme
  // de un jalón. Se despliegan por separado al tocar cada uno.
  const [modExpandedGrupos, setModExpandedGrupos] = useState(() => new Set())

  // Filtro de la tabla de "Productos": 'ALL' (todos), 'SHARED' (solo lo Compartido, sin
  // comensal asignado), 'CANCELLED_ALL' (todo lo cancelado de cualquier comensal) o el id de
  // un comensal (sus productos, activos Y cancelados, para que el mesero pueda revisar de un
  // vistazo qué va a consumir y qué se le canceló).
  const [itemFilter, setItemFilter] = useState('ALL')
  // Edición de una línea ya agregada (ver `openEditItem`): comensal, cantidad, notas y
  // modificadores. `editGrupos` se carga del producto al abrir; `editModsTouched` evita
  // mandar modificadores si el mesero no los tocó (así no se re-validan sin necesidad).
  const [editItem, setEditItem] = useState(null)
  const [editCantidad, setEditCantidad] = useState(1)
  const [editComensalId, setEditComensalId] = useState('')
  const [editNota, setEditNota] = useState('')
  const [editGrupos, setEditGrupos] = useState([])
  const [editSelections, setEditSelections] = useState({})
  const [editModsTouched, setEditModsTouched] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editMotivo, setEditMotivo] = useState('')

  const [showAccount, setShowAccount] = useState(false)
  const [accountTipo, setAccountTipo] = useState('TOTAL')
  const [accountComensal, setAccountComensal] = useState('')
  const [customSelection, setCustomSelection] = useState({}) // { ordenDetalleId: cantidad }

  const [payModal, setPayModal] = useState(null) // cuenta
  // Colapsado por default: el detalle de productos de la cuenta es útil cuando un mismo
  // comensal tiene varias cuentas abiertas (ver "Ver productos de esta cuenta" más abajo),
  // pero no debe competir visualmente con el formulario de cobro por default.
  const [payItemsOpen, setPayItemsOpen] = useState(false)
  const [payMetodo, setPayMetodo] = useState('CASH')
  const [payMonto, setPayMonto] = useState('')
  const [payRecibido, setPayRecibido] = useState('')
  // Propina opcional, solo capturable junto con el PRIMER pago de la cuenta (mientras
  // totalPagado siga en 0 — ver PagoService#registrar, que la ignora después de eso). 'NONE'
  // (default), 'MONTO' (fijo) o 'PORCENTAJE' del subtotal ya generado de la cuenta.
  const [payPropinaTipo, setPayPropinaTipo] = useState('NONE')
  const [payPropinaValor, setPayPropinaValor] = useState('')
  const [payEmail, setPayEmail] = useState('')
  // 'physical': se imprime al vuelo en la impresora térmica vía QZ Tray al cobrar, igual que
  // el POS. 'digital': no se imprime nada, el ticket se manda por correo — por eso exige
  // capturar el email (ver `digitalEmailMissing`).
  const [ticketType, setTicketType] = useState('physical')
  const [paySuccess, setPaySuccess] = useState(null)
  const [printing, setPrinting] = useState(false)
  // Corte de caja abierto del cajero actual — igual que el POS de DemoPV, NO bloquea la
  // pantalla ni la generación de cuentas, solo deshabilita el botón de cobro final dentro
  // del modal de "Registrar pago" (ver el aviso y el botón deshabilitado más abajo).
  const [cashCut, setCashCut] = useState(null)

  function load() {
    getOrder(id).then((r) => setOrder(r.data.data))
    getAccountsByOrder(id).then((r) => setAccounts(r.data.data ?? [])).catch(() => setAccounts([]))
  }
  // Reinicia el filtro de la tabla (y el comensal del buscador) cada vez que `id` cambia, no
  // solo al montar: como la ruta es siempre `/orders/:id`, React reutiliza esta MISMA
  // instancia del componente al navegar de una orden a otra (no hay remount), así que sin
  // esto un filtro dejado en "Comensal 2" o "Compartido" en la orden anterior se quedaba
  // pegado en la nueva — los productos recién agregados sí se guardaban (por eso igual
  // aparecía el botón "Marcar todo entregado", que no depende del filtro) pero la tabla los
  // escondía por completo.
  useEffect(() => {
    load()
    setItemFilter('ALL')
    setPickerComensalId('')
  }, [id])
  useEffect(() => { getCategories().then((r) => setCategories(r.data.data ?? [])) }, [])
  // Silencioso a propósito: "no hay corte abierto" es un estado normal, no un error.
  useEffect(() => { getOpenCashCut().then((r) => setCashCut(r.data.data)).catch(() => {}) }, [])
  useEffect(() => {
    if (!showAddItem) return
    const loadProducts = productQuery
      ? searchProducts({ q: productQuery, categoryId: productCat || undefined, size: 60 })
      : getTopSellingProducts({ categoryId: productCat || undefined, limit: 24 })
    // Además del 86'd manual (disponible), se excluyen los productos cuya categoría no esté
    // disponible EN ESTE MOMENTO (ver Category#isAvailableNow en el backend, ya viene
    // calculado en cada producto como category.availableNow) — ej. items de "Desayuno" fuera
    // de su horario, o una categoría forzada oculta a mano.
    loadProducts.then((r) => setProducts((r.data.data ?? []).filter((p) => p.disponible !== false && p.category?.availableNow !== false)))
  }, [showAddItem, productQuery, productCat])

  /** Cambia el modo de disponibilidad de una categoría desde el mini-modal, y refleja el cambio en la lista local. */
  async function handleCategoryModeChange(mode) {
    if (!categoryModeTarget) return
    try {
      const updated = (await updateCategoryAvailabilityMode(categoryModeTarget.id, mode)).data.data
      setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setCategoryModeTarget(null)
      notify('Disponibilidad de la categoría actualizada', 'success')
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo actualizar la disponibilidad', 'error')
    }
  }

  // Cierra con ESC el modal abierto en este momento (agregar producto, generar cuenta o
  // cobrar) — mismo efecto que su botón "Cancelar". modPicker va primero: está apilado encima
  // de showAddItem (se abre al personalizar un producto con modificadores).
  useEscapeKey(() => {
    if (editItem) setEditItem(null)
    else if (categoryModeTarget) setCategoryModeTarget(null)
    else if (modPicker) setModPicker(null)
    else if (showAddItem) setShowAddItem(false)
    else if (showAccount) setShowAccount(false)
    else if (payModal) { setPayModal(null); setPaySuccess(null) }
  }, !!(showAddItem || showAccount || payModal || modPicker || categoryModeTarget || editItem))

  const holdTimeoutRef = useRef(null)
  const holdIntervalRef = useRef(null)
  // Por si el modal se cierra (o el componente se desmonta) mientras el mesero sigue
  // presionando +/- en la cantidad de "Personalizada" (ver stepCustomQty/startHoldStep más
  // abajo): sin esto, el setInterval seguiría corriendo de fondo indefinidamente.
  useEffect(() => () => { clearTimeout(holdTimeoutRef.current); clearInterval(holdIntervalRef.current) }, [])

  // Tiempo real: si cocina, otro mesero o el repartidor cambian esta orden, se ve sin recargar.
  useLiveRefresh(load, { filtro: (e) => e.name === 'orden' && String(e.data?.ordenId) === String(id) })

  if (!order) return <p className="text-gray-400">Cargando...</p>

  const remaining = (item) => Number(item.cantidad) - Number(item.cantidadFacturada || 0)
  // Etiqueta de pago de una línea: a diferencia de `remaining` (que solo dice si ya se
  // facturó ALGO de la línea a alguna cuenta), esto cruza contra el estado real de esas
  // cuentas — una línea puede estar 100% facturada y aun así seguir sin cobrarse si la
  // cuenta que la contiene todavía está PENDIENTE.
  function paymentLabel(item) {
    let qtyPagada = 0
    let qtyPendiente = 0
    for (const cuenta of accounts) {
      if (cuenta.estado === 'CANCELADA') continue
      for (const cd of cuenta.items ?? []) {
        if (cd.ordenDetalle?.id !== item.id) continue
        if (cuenta.estado === 'PAGADA') qtyPagada += Number(cd.cantidad)
        else qtyPendiente += Number(cd.cantidad)
      }
    }
    if (qtyPagada >= Number(item.cantidad)) return ' · pagado'
    if (qtyPagada > 0) return ' · pagado parcial'
    if (qtyPendiente > 0) return ' · en cuenta, pendiente de cobro'
    return ''
  }
  const isClosed = order.estado === 'PAGADA' || order.estado === 'CANCELADA'
  // Pedido de la página web a domicilio: lo cobra el repartidor al entregar, no la caja.
  const cobraRepartidor = order.origen === 'WEB' && order.tipoEntrega === 'DOMICILIO'
  // Lo que marca el mesero (ENTREGADO) se nombra según el tipo de orden; lo que marca cocina
  // (ENTREGADO_MESERO) es solo un paso intermedio — ver `Kitchen.jsx`.
  const entregadoLabel = order.mesa ? 'Entregado a mesa' : 'Entregado para llevar'
  const itemEstadoLabel = (item) => {
    if (item.cargoExtra && item.estado !== 'CANCELADO') return 'Cargo'
    if (item.estado === 'ENTREGADO_MESERO') return 'Entregado a mesero'
    if (item.estado === 'ENTREGADO') return entregadoLabel
    return item.estado
  }
  const activeItems = order.items?.filter((i) => i.estado !== 'CANCELADO') ?? []
  const billableItems = activeItems.filter((i) => remaining(i) > 0)
  // Filtro de la tabla de productos (ver `itemFilter`): por comensal muestra tanto lo que
  // va a consumir (activo) como lo que se le canceló, para que el mesero revise ambos de
  // un vistazo; "Todo lo cancelado" ignora el comensal y junta lo cancelado de todos.
  const filteredItems = (order.items ?? []).filter((item) => {
    if (itemFilter === 'ALL') return true
    if (itemFilter === 'CANCELLED_ALL') return item.estado === 'CANCELADO'
    if (itemFilter === 'SHARED') return !item.comensal
    return String(item.comensal?.id ?? '') === itemFilter
  })
  // Subtotal/Total del pie de la tabla: se recalculan según lo que el filtro de arriba esté
  // mostrando en ese momento (todo, un comensal, o lo cancelado), no el total fijo de la
  // orden completa — los cancelados no suman nada.
  const filteredSubtotal = filteredItems.reduce((sum, item) =>
    item.estado === 'CANCELADO' ? sum : sum + Number(item.precioUnitario) * Number(item.cantidad), 0)
  const filteredTotal = filteredItems.reduce((sum, item) =>
    item.estado === 'CANCELADO' ? sum : sum + Number(item.subtotal), 0)
  // Comensales con al menos un producto propio pendiente de cobrar — lo "Compartido"
  // (item.comensal == null) nunca cuenta aquí, tal como en una cuenta "por comensal"
  // individual. Base para "Generar todas las cuentas por comensal" (ver más abajo).
  const comensalesConPendiente = (order.comensales ?? []).filter((c) =>
    billableItems.some((i) => i.comensal?.id === c.id)
  )
  // true cuando ya no queda nada propio de ningún comensal por cobrar — todos pagaron lo
  // suyo por separado y solo falta lo "Compartido". Ahí "Por comensal" y "Personalizada" ya
  // no tienen sentido (no hay nada que atribuirle a nadie en particular): lo compartido se
  // cobra siempre en una sola cuenta "Total".
  const onlySharedPending = billableItems.length > 0 && billableItems.every((i) => !i.comensal)
  // Total que se cobraría con "Generar cuenta" > Total: la misma fórmula que usa el backend
  // (CuentaService#crearInternal) — precio unitario real de la línea (subtotal / cantidad,
  // ya con su descuento aplicado) por la cantidad aún pendiente de facturar.
  const billableTotal = billableItems.reduce((sum, item) => {
    const unitario = Number(item.subtotal) / Number(item.cantidad)
    return sum + unitario * remaining(item)
  }, 0)
  // Total en vivo de la cuenta "Personalizada": misma fórmula de arriba, pero solo de los
  // productos marcados y con la cantidad que el mesero eligió para cada uno (no lo pendiente
  // completo de la línea).
  const customTotal = billableItems.reduce((sum, item) => {
    if (!(item.id in customSelection)) return sum
    const unitario = Number(item.subtotal) / Number(item.cantidad)
    return sum + unitario * customSelection[item.id]
  }, 0)
  // Productos y monto del comensal elegido en "Por comensal" — parte de `billableItems`
  // (no de `order.items`) para mostrar SOLO lo que de verdad se va a facturar con este
  // "Generar": excluye lo cancelado y, sobre todo, lo que ese comensal ya tiene en OTRA
  // cuenta (pendiente o pagada) — sin esto se veía como si fuera a cobrarle de nuevo algo
  // que ya estaba en otra cuenta. Se recalcula solo con cambiar el <select>.
  const comensalItems = accountComensal
    ? billableItems.filter((i) => String(i.comensal?.id ?? '') === String(accountComensal))
    : []
  const comensalTotal = comensalItems.reduce((sum, item) => {
    const unitario = Number(item.subtotal) / Number(item.cantidad)
    return sum + unitario * remaining(item)
  }, 0)

  /** Agrega el siguiente comensal directo, sin pedir nombre — el backend le asigna el número que sigue. */
  async function handleAddDiner() {
    try {
      await addDiner(id, {})
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'Error') }
  }

  /** Quita un comensal — el backend rechaza esto si ya tiene algún producto asociado. */
  async function handleDeleteDiner(comensal) {
    if (!(await confirmDialog(`¿Quitar al Comensal ${comensal.numero}${comensal.nombre ? ` (${comensal.nombre})` : ''}?`, { confirmText: 'Quitar' }))) return
    try {
      await deleteDiner(id, comensal.id)
      if (itemFilter === String(comensal.id)) setItemFilter('ALL')
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo quitar', 'error') }
  }

  function openAddItem() {
    setProductQuery('')
    setProductCat('')
    setPickerComensalId('')
    setCart({})
    setShowAddItem(true)
  }

  function cartQty(productId) { return cart[productId]?.cantidad ?? 0 }

  function incrementCartItem(productId) {
    setCart((c) => ({ ...c, [productId]: { cantidad: (c[productId]?.cantidad ?? 0) + 1, observaciones: c[productId]?.observaciones ?? '' } }))
  }

  function decrementCartItem(productId) {
    setCart((c) => {
      const current = c[productId]
      if (!current) return c
      if (current.cantidad <= 1) {
        const next = { ...c }
        delete next[productId]
        return next
      }
      return { ...c, [productId]: { ...current, cantidad: current.cantidad - 1 } }
    })
  }

  function setCartNota(productId, observaciones) {
    setCart((c) => ({ ...c, [productId]: { ...c[productId], observaciones } }))
  }

  const cartCount = Object.values(cart).reduce((sum, i) => sum + i.cantidad, 0)

  /** Grupos de modificadores activos de un producto, con sus opciones también filtradas a activas. */
  function productModGrupos(p) {
    return (p.modificadorGrupos ?? [])
      .filter((g) => g.isActive !== false)
      .map((g) => ({ ...g, opciones: (g.opciones ?? []).filter((o) => o.isActive !== false) }))
  }

  function openModPicker(p) {
    const grupos = productModGrupos(p)
    const initial = {}
    grupos.forEach((g) => { initial[g.id] = [] })
    setModSelections(initial)
    setModNota('')
    setModExpandedGrupos(new Set())
    setModPicker(p)
  }

  function toggleModOpcion(grupo, opcionId) {
    setModSelections((sel) => {
      const current = sel[grupo.id] ?? []
      if (grupo.tipo === 'UNICO') {
        return { ...sel, [grupo.id]: current.includes(opcionId) ? [] : [opcionId] }
      }
      const next = current.includes(opcionId) ? current.filter((i) => i !== opcionId) : [...current, opcionId]
      return { ...sel, [grupo.id]: next }
    })
  }

  function toggleModGrupoExpanded(grupoId) {
    setModExpandedGrupos((s) => {
      const next = new Set(s)
      if (next.has(grupoId)) next.delete(grupoId)
      else next.add(grupoId)
      return next
    })
  }

  /** Resumen de lo ya elegido en un grupo, para mostrarlo en su encabezado mientras está
   *  cerrado (ej. "Pollo" o "Queso, Crema") — así no hace falta desplegarlo para ver qué se
   *  seleccionó. */
  function modGrupoResumen(g) {
    const ids = modSelections[g.id] ?? []
    if (ids.length === 0) return null
    return g.opciones.filter((o) => ids.includes(o.id)).map((o) => o.nombre).join(', ')
  }

  const modGrupos = modPicker ? productModGrupos(modPicker) : []
  const modOpcionIds = Object.values(modSelections).flat()
  const modExtrasTotal = modGrupos
    .flatMap((g) => g.opciones)
    .filter((o) => modOpcionIds.includes(o.id))
    .reduce((sum, o) => sum + Number(o.precioExtra), 0)
  const modTotal = modPicker ? Number(modPicker.price) + modExtrasTotal : 0
  const modFaltaObligatorio = modGrupos.some((g) => g.obligatorio && (modSelections[g.id]?.length ?? 0) === 0)

  async function handleConfirmModPicker() {
    if (modFaltaObligatorio) return
    setLoading(true)
    try {
      await addOrderItem(id, {
        productoId: modPicker.id,
        comensalId: pickerComensalId ? Number(pickerComensalId) : null,
        cantidad: 1,
        observaciones: modNota.trim() || undefined,
        modificadorOpcionIds: modOpcionIds,
      })
      setModPicker(null)
      load()
      notify('Producto agregado', 'success')
    } catch (err) {
      notify(err.response?.data?.message ?? 'Error al agregar', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmAddItems() {
    setLoading(true)
    try {
      for (const [productoId, { cantidad, observaciones }] of Object.entries(cart)) {
        if (cantidad <= 0) continue
        await addOrderItem(id, {
          productoId: Number(productoId),
          comensalId: pickerComensalId ? Number(pickerComensalId) : null,
          cantidad,
          observaciones: observaciones || undefined,
        })
      }
      setShowAddItem(false)
      setCart({})
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'Error al agregar') }
    finally { setLoading(false) }
  }

  // ── Editar producto ya agregado ──────────────────────────────────────
  // Reglas espejo de OrdenService#editarItem: lo ya facturado fija un mínimo de cantidad y
  // bloquea modificadores; lo que cocina ya entregó solo admite cambiar comensal o bajar cantidad.
  const editEntregado = editItem && ['ENTREGADO_MESERO', 'ENTREGADO'].includes(editItem.estado)
  const editFacturada = editItem ? Number(editItem.cantidadFacturada || 0) : 0
  const editMinCantidad = Math.max(1, editFacturada)
  const editMaxCantidad = editEntregado ? Number(editItem.cantidad) : Infinity
  const editModsBloqueados = editEntregado || editFacturada > 0

  async function openEditItem(item) {
    setEditItem(item)
    setEditCantidad(Number(item.cantidad))
    setEditComensalId(item.comensal?.id ? String(item.comensal.id) : '')
    setEditNota(item.observaciones ?? '')
    setEditModsTouched(false)
    setEditMotivo('')
    setEditGrupos([])
    setEditSelections({})
    if (!item.producto?.id) return
    try {
      const grupos = productModGrupos({ modificadorGrupos: (await getModificadorGrupos(item.producto.id)).data.data ?? [] })
      // La línea solo guarda nombres (grupo + opción), no ids: se preseleccionan por nombre.
      const sel = {}
      grupos.forEach((g) => {
        sel[g.id] = g.opciones
          .filter((o) => (item.modificadores ?? []).some((m) => m.grupoNombre === g.nombre && m.nombre === o.nombre))
          .map((o) => o.id)
      })
      setEditGrupos(grupos)
      setEditSelections(sel)
    } catch { /* sin grupos: se edita solo cantidad/comensal/notas */ }
  }

  function toggleEditOpcion(grupo, opcionId) {
    setEditModsTouched(true)
    setEditSelections((sel) => {
      const current = sel[grupo.id] ?? []
      if (grupo.tipo === 'UNICO') return { ...sel, [grupo.id]: current.includes(opcionId) ? [] : [opcionId] }
      return { ...sel, [grupo.id]: current.includes(opcionId) ? current.filter((i) => i !== opcionId) : [...current, opcionId] }
    })
  }

  const editOpcionIds = Object.values(editSelections).flat()
  const editFaltaObligatorio = editModsTouched && editGrupos.some((g) => g.obligatorio && (editSelections[g.id]?.length ?? 0) === 0)
  const editExtras = editModsTouched
    ? editGrupos.flatMap((g) => g.opciones).filter((o) => editOpcionIds.includes(o.id)).reduce((s, o) => s + Number(o.precioExtra), 0)
    : (editItem?.modificadores ?? []).reduce((s, m) => s + Number(m.precioExtra), 0)
  const editTotal = editItem
    ? (Number(editItem.precioUnitario) + editExtras) * editCantidad - Number(editItem.descuento || 0)
    : 0

  async function handleSaveEditItem() {
    if (editFaltaObligatorio) return
    setEditSaving(true)
    try {
      await updateOrderItem(id, editItem.id, {
        comensalId: editComensalId ? Number(editComensalId) : null,
        cantidad: editCantidad,
        observaciones: editNota.trim() || null,
        motivo: editMotivo.trim() || null,
        ...(editModsTouched ? { modificadorOpcionIds: editOpcionIds } : {}),
      })
      setEditItem(null)
      load()
      notify('Producto actualizado', 'success')
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo actualizar el producto', 'error')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleCancelItem(item) {
    if (!(await confirmDialog(`¿Cancelar "${item.productoNombre}"?`))) return
    try {
      await cancelOrderItem(id, item.id, 'Cancelado desde la orden')
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo cancelar') }
  }

  /**
   * Marca un producto como entregado a mesa / para llevar (ENTREGADO) — mismo endpoint que usa
   * cocina desde `Kitchen.jsx`, donde en cambio se marca como entregado a mesero (ENTREGADO_MESERO).
   */
  async function handleMarcarEntregado(item) {
    try {
      await updateOrderItemStatus(id, item.id, 'ENTREGADO')
      load()
    } catch (err) { notify(err.response?.data?.message ?? `No se pudo marcar como ${entregadoLabel.toLowerCase()}`) }
  }

  /** Marca TODOS los productos pendientes de la orden (ni cancelados ni ya entregados a mesa/para llevar) como entregados, de un jalón — sin importar el filtro de la tabla. */
  async function handleMarcarTodoEntregado() {
    const pendientes = (order.items ?? []).filter((i) => i.estado !== 'ENTREGADO' && i.estado !== 'CANCELADO')
    if (pendientes.length === 0) return
    setMarcandoTodo(true)
    try {
      await Promise.all(pendientes.map((i) => updateOrderItemStatus(id, i.id, 'ENTREGADO')))
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? `No se pudo marcar todo como ${entregadoLabel.toLowerCase()}`)
    } finally {
      setMarcandoTodo(false)
    }
  }

  /** Acepta un pedido de la página web: queda a nombre de quien acepta y pasa a cocina. */
  async function handleAcceptWeb() {
    try {
      await acceptWebOrder(id)
      notify('Pedido aceptado — ya está en cocina', 'success')
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo aceptar el pedido', 'error') }
  }

  /** Rechaza un pedido de la página web (lo cancela; el cliente ve el aviso en su página). */
  async function handleRejectWeb() {
    if (!(await confirmDialog('¿Rechazar este pedido? El cliente verá que no fue aceptado.', { confirmText: 'Rechazar pedido' }))) return
    try {
      await cancelOrder(id, 'No podemos atender tu pedido en este momento')
      navigate('/takeaway')
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo rechazar el pedido', 'error') }
  }

  async function handleCancelOrder() {
    if (!(await confirmDialog('¿Cancelar toda la orden?', { confirmText: 'Cancelar orden' }))) return
    try {
      await cancelOrder(id, 'Cancelada por el usuario')
      navigate(order.mesa ? `/tables?zona=${order.mesa.zona?.id ?? ''}` : '/takeaway')
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo cancelar la orden') }
  }

  function toggleCustomItem(item, checked) {
    setCustomSelection((s) => {
      const next = { ...s }
      if (checked) next[item.id] = remaining(item)
      else delete next[item.id]
      return next
    })
  }

  /** Sube/baja de 1 en 1 (en piezas, no en decimales) la cantidad de un producto en la
   *  cuenta "Personalizada", acotada entre 1 y lo que quede pendiente de esa línea. */
  function stepCustomQty(item, delta) {
    setCustomSelection((s) => {
      const current = s[item.id] ?? remaining(item)
      const max = remaining(item)
      const next = Math.min(max, Math.max(1, Math.round(current) + delta))
      return { ...s, [item.id]: next }
    })
  }

  /** Detiene el autorrepetir de mantener presionado +/− (ver `startHoldStep`). Se llama al
   *  soltar el botón, salir del área con el mouse, o levantar el dedo (touch). */
  function stopHoldStep() {
    clearTimeout(holdTimeoutRef.current)
    clearInterval(holdIntervalRef.current)
  }

  /** Da un primer paso inmediato al hacer clic y, si se mantiene presionado ~400ms, empieza
   *  a repetir el paso cada 100ms — mismo patrón "clic o mantener presionado" que un stepper
   *  nativo de sistema operativo, para no obligar al mesero a dar clics uno por uno. */
  function startHoldStep(item, delta) {
    stepCustomQty(item, delta)
    stopHoldStep()
    holdTimeoutRef.current = setTimeout(() => {
      holdIntervalRef.current = setInterval(() => stepCustomQty(item, delta), 100)
    }, 400)
  }

  async function handleCreateAccount(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = { tipo: accountTipo }
      if (accountTipo === 'POR_COMENSAL') payload.comensalId = Number(accountComensal)
      if (accountTipo === 'PERSONALIZADA') {
        payload.items = Object.entries(customSelection).map(([ordenDetalleId, cantidad]) => ({ ordenDetalleId: Number(ordenDetalleId), cantidad }))
      }
      await createAccount(id, payload)
      setShowAccount(false)
      setAccountComensal('')
      setCustomSelection({})
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'Error al generar la cuenta') }
    finally { setLoading(false) }
  }

  /**
   * Genera de un jalón una cuenta "por comensal" para cada comensal que tenga productos
   * propios pendientes — nunca incluye lo "Compartido" (mismo criterio que una cuenta por
   * comensal individual: solo lo que se le asignó directamente a él).
   */
  async function handleCreateAllPerDinerAccounts() {
    if (comensalesConPendiente.length === 0) return
    if (!(await confirmDialog(
      `¿Generar ${comensalesConPendiente.length} cuenta${comensalesConPendiente.length === 1 ? '' : 's'}, una por cada comensal con productos pendientes?`,
      { confirmText: 'Generar todas', danger: false }
    ))) return
    setLoading(true)
    try {
      await Promise.all(comensalesConPendiente.map((c) => createAccount(id, { tipo: 'POR_COMENSAL', comensalId: c.id })))
      setShowAccount(false)
      load()
      notify('Cuentas generadas correctamente', 'success')
    } catch (err) {
      notify(err.response?.data?.message ?? 'Error al generar las cuentas', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleCancelAccount(cuenta) {
    if (!(await confirmDialog(`¿Cancelar la cuenta ${cuenta.ticketFolio ?? cuenta.id}?`))) return
    try {
      await cancelAccount(cuenta.id, 'Cancelada por el usuario')
      load()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo cancelar') }
  }

  function openPayModal(cuenta) {
    setPayModal(cuenta)
    setPayItemsOpen(false)
    setPayMetodo('CASH')
    setPayMonto((Number(cuenta.total) - Number(cuenta.totalPagado)).toFixed(2))
    setPayRecibido('')
    setPayEmail('')
    setTicketType('physical')
    setPaySuccess(null)
    setPayPropinaTipo('NONE')
    setPayPropinaValor('')
  }

  /** Cambia el tipo de propina ('NONE'/'MONTO'/'PORCENTAJE') y ajusta el monto a pagar sugerido
   *  para que ya incluya la propina elegida — el cajero puede seguir editándolo después (ej.
   *  para un pago parcial). Solo tiene sentido mientras no se ha registrado ningún pago todavía. */
  function handlePropinaTipoChange(value) {
    setPayPropinaTipo(value)
    setPayPropinaValor('')
    setPayMonto(paySaldoPendiente.toFixed(2))
  }

  /** Cambia el método de pago, limpiando el monto recibido si ya no aplica (no es CASH) — mismo patrón que el POS. */
  function handlePaymentMethodChange(value) {
    setPayMetodo(value)
    if (value !== 'CASH') setPayRecibido('')
  }

  async function handlePay(e) {
    e.preventDefault()
    if (payMontoMissing || payMontoExceedsLimit || payMontoExceedsSaldo || payCashAmountMissing
      || payRecibidoExceedsLimit || payDigitalEmailMissing || payEmailTooLong || payEmailInvalid
      || payPropinaValorInvalid) return
    if (!(await confirmDialog(`¿Deseas registrar este pago por ${fmt(payMontoNum)}?`, { confirmText: 'Registrar pago', danger: false }))) return
    setLoading(true)
    try {
      const res = await createPayment(payModal.id, {
        metodo: payMetodo,
        monto: payMontoNum,
        recibido: payMetodo === 'CASH' && payRecibidoNum != null ? payRecibidoNum : undefined,
        emailTicket: ticketType === 'digital' ? payEmail.trim() : undefined,
        propinaPorcentaje: payPropinaTipo === 'PORCENTAJE' && payPropinaValorNum ? payPropinaValorNum : undefined,
        propinaMonto: payPropinaTipo === 'MONTO' && payPropinaValorNum ? payPropinaValorNum : undefined,
      })
      setPaySuccess({ pago: res.data.data, cuenta: payModal, ticketType, email: payEmail.trim() })
      load()
      // Se imprime "al vuelo" SOLO en modo físico: si la caja no tiene QZ Tray instalado/
      // corriendo, o la impresora está apagada, no debe tumbar el pago ya registrado — solo
      // se avisa para que el cajero pueda usar "Reimprimir" en cuanto lo resuelva.
      if (ticketType === 'physical') printTicketNow(payModal.id)
    } catch (err) { notify(err.response?.data?.message ?? 'Error al registrar el pago') }
    finally { setLoading(false) }
  }

  function closePayModal() {
    setPayModal(null)
    setPaySuccess(null)
  }

  /** Manda el ticket de una cuenta a la impresora térmica vía QZ Tray. Nunca bloquea el flujo de cobro. */
  async function printTicketNow(accountId) {
    setPrinting(true)
    try {
      await printAccountTicket(accountId)
    } catch (err) {
      notify(err.message ?? 'No se pudo imprimir el ticket', 'error')
    } finally {
      setPrinting(false)
    }
  }

  async function handleViewTicket(cuenta) {
    try {
      const res = await getTicketPdf(cuenta.id)
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      window.open(url, '_blank')
    } catch { notify('No se pudo generar el ticket') }
  }

  // Validaciones del modal de pago, calculadas en cada render (nunca guardadas en estado) —
  // mismo patrón que Corte de Caja: si se copiaran a un estado de errores, nada las limpiaría
  // cuando el usuario corrige el monto y la condición deja de cumplirse.
  const paySaldoPendiente = payModal ? Number(payModal.total) - Number(payModal.totalPagado) : 0
  const payMontoNum = payMonto === '' ? null : Number(payMonto)
  const payRecibidoNum = payRecibido === '' ? null : Number(payRecibido)
  // Propina: solo se puede capturar mientras la cuenta no tenga ningún pago todavía (ver
  // PagoService#registrar, que la ignora después). Vista previa nada más — el monto real
  // siempre lo recalcula el backend contra el subtotal que tiene registrado.
  const payPropinaEditable = payModal ? Number(payModal.totalPagado) === 0 : false
  const payPropinaValorNum = payPropinaValor === '' ? null : Number(payPropinaValor)
  // Mismo tope que Pago.monto en el backend (NUMERIC(12,2)) para el modo $, y 100 para el
  // modo % (@DecimalMax de PagoRequest.propinaPorcentaje) — sin esto, un número gigante se
  // arrastraba al total y "Monto a aplicar" terminaba mostrando notación científica.
  const payPropinaValorExceedsLimit = payPropinaValorNum != null && !Number.isNaN(payPropinaValorNum) && (
    payPropinaTipo === 'PORCENTAJE' ? payPropinaValorNum > 100 : payPropinaValorNum > 9999999999.99
  )
  const payPropinaValorNegative = payPropinaValorNum != null && payPropinaValorNum < 0
  const payPropinaValorInvalid = payPropinaValorExceedsLimit || payPropinaValorNegative
  const payPropinaPreview = payPropinaEditable && payPropinaValorNum != null && !Number.isNaN(payPropinaValorNum) && !payPropinaValorInvalid
    ? payPropinaTipo === 'PORCENTAJE'
      ? Math.round(paySaldoPendiente * payPropinaValorNum) / 100
      : payPropinaTipo === 'MONTO' ? payPropinaValorNum : 0
    : 0
  // Number((...).toFixed(2)) en vez de la suma flotante cruda: el campo "Monto a aplicar" se
  // autocompleta pasando por ese mismo toFixed (ver el onChange de la propina más abajo), así
  // que sin normalizar aquí igual, un residuo de coma flotante entre ambos cálculos podía
  // dejar el tope una fracción de centavo por debajo del monto ya autocompletado y bloquear
  // el envío con "el monto no puede exceder el saldo pendiente" aunque el backend sí lo aceptara.
  const paySaldoConPropina = Number((paySaldoPendiente + payPropinaPreview).toFixed(2))
  // Cambio a entregar en efectivo: solo tiene sentido para CASH, y solo una vez que se
  // capturó un monto recibido válido — con cualquier otro método, o sin capturar nada
  // todavía, queda en null (no se muestra ni se cobra). Mismo cálculo que el POS, pero
  // contra el monto que se está aplicando en ESTE pago, no contra el saldo total de la
  // cuenta (aquí sí se permiten pagos parciales, a diferencia del POS de DemoPV).
  const payChange = payMetodo === 'CASH' && payMontoNum != null && payRecibidoNum != null && !Number.isNaN(payRecibidoNum)
    ? payRecibidoNum - payMontoNum
    : null
  const payCashAmountMissing = payMetodo === 'CASH' && (payChange === null || payChange < 0)
  const payMontoMissing = payMontoNum == null || payMontoNum <= 0
  // Mismo límite que Pago.monto/recibido en el backend (NUMERIC(12,2), ver PagoRequest).
  const payMontoExceedsLimit = payMontoNum != null && payMontoNum > 9999999999.99
  const payRecibidoExceedsLimit = payMetodo === 'CASH' && payRecibidoNum != null && payRecibidoNum > 9999999999.99
  // Tolerancia de 1 centavo (no 0.001): dos cálculos en coma flotante hechos por separado
  // (este tope y el autocompletado del monto) pueden diferir por un residuo así aunque
  // representen el mismo valor en pesos.
  const payMontoExceedsSaldo = payMontoNum != null && payMontoNum > paySaldoConPropina + 0.01
  // Ticket digital exige correo (es el único medio de entrega en ese modo, a diferencia del
  // físico donde el correo simplemente no se usa).
  const payDigitalEmailMissing = ticketType === 'digital' && !payEmail.trim()
  const payEmailTooLong = payEmail.length > 150
  const payEmailInvalid = payEmail.trim() !== '' && !EMAIL_RE.test(payEmail.trim())

  return (
    <div>
      {order.pendienteAceptar && order.estado !== 'CANCELADA' && (
        <div className="mb-4 rounded-xl border-2 border-blue-500 bg-blue-50 px-4 py-3 flex flex-wrap items-center gap-3">
          <p className="flex-1 font-bold text-blue-900">🌐 Pedido de la página web por aceptar — cocina todavía no lo ve.</p>
          <button className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700" onClick={handleAcceptWeb}>✅ Aceptar pedido</button>
          <button className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50" onClick={handleRejectWeb}>Rechazar</button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            title="Regresar"
            onClick={() => navigate(order.mesa ? `/tables?zona=${order.mesa.zona?.id ?? ''}` : '/takeaway')}
            className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-white border border-gray-300 shadow-sm text-gray-600 hover:bg-purple-50 hover:text-purple-700 hover:border-purple-300 transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" clipRule="evenodd" d="M9.53 2.47a.75.75 0 010 1.06L4.81 8.25H16.5a.75.75 0 010 1.5H4.81l4.72 4.72a.75.75 0 11-1.06 1.06l-6-6a.75.75 0 010-1.06l6-6a.75.75 0 011.06 0z" />
            </svg>
          </button>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {order.mesa ? `Mesa ${order.mesa.numero}` : 'Para llevar'} — Orden #{order.id}
            </h2>
            <p className="text-sm text-gray-500">
              Mesero: {order.mesero?.name ?? '—'} ·{' '}
              <span className="font-medium">{ESTADO_ORDEN_LABEL[order.estado] ?? order.estado}</span>
            </p>
            {order.clienteNombre && (
              <p className="text-sm text-gray-700">👤 <span className="font-medium">{order.clienteNombre}</span>
                {order.clienteTelefono && <> · 📞 <a href={`tel:${order.clienteTelefono}`} className="hover:underline">{order.clienteTelefono}</a></>}
              </p>
            )}
            {order.direccion && <p className="text-sm text-gray-500">📍 {order.direccion}</p>}
            {order.origen === 'WEB' && (
              <p className="text-sm text-blue-700 font-medium">
                🌐 Pedido web · {order.tipoEntrega === 'DOMICILIO' ? '🛵 A domicilio' : '🛍️ Para recoger'}
                {order.metodoPago && <> · Paga con {({ EFECTIVO: 'efectivo', TARJETA: 'tarjeta', TRANSFERENCIA: 'transferencia' })[order.metodoPago] ?? order.metodoPago}</>}
              </p>
            )}
            {order.tipoEntrega === 'DOMICILIO' && (
              <p className="text-sm text-gray-600">
                🛵 {order.entregadaAt
                  ? `Entregado${order.repartidor ? ` por ${order.repartidor.name}` : ''} a las ${new Date(order.entregadaAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
                  : order.repartidor ? `Lo lleva ${order.repartidor.name}` : 'Sin repartidor asignado'}
              </p>
            )}
            {order.notas && <p className="text-sm text-gray-600">📝 {order.notas}</p>}
            {order.cliente && <p className="text-sm text-gray-600">⭐ Cliente registrado · {order.cliente.email}</p>}
            {order.reporteTipo && (
              <div className={`mt-1 rounded-lg border px-3 py-1.5 ${order.reporteTipo === 'BIEN' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-sm font-semibold">
                  {({ BIEN: '✅ El cliente reporta que llegó bien', MAL: '⚠️ El cliente reporta que llegó mal', FALTANTE: '❌ El cliente reporta que le faltó algo' })[order.reporteTipo]}
                  <span className="font-normal text-gray-500"> · {new Date(order.reporteAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </p>
                {order.reporteProductos && <p className="text-sm text-gray-700">Productos: {order.reporteProductos}</p>}
                {order.reporteComentario && <p className="text-sm text-gray-700 italic">"{order.reporteComentario}"</p>}
              </div>
            )}
            {order.resenaEstrellas && (
              <div className="mt-1 inline-block rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-1.5">
                <p className="text-sm">
                  <span className="text-yellow-500 tracking-tight">{'★'.repeat(order.resenaEstrellas)}</span>
                  <span className="text-gray-300 tracking-tight">{'★'.repeat(5 - order.resenaEstrellas)}</span>
                  <span className="ml-2 font-semibold text-gray-700">Calificación del cliente</span>
                </p>
                {order.resenaComentario && <p className="text-sm text-gray-700 italic">"{order.resenaComentario}"</p>}
              </div>
            )}
          </div>
        </div>
        {!isClosed && (
          <button className="btn-danger" onClick={handleCancelOrder}>Cancelar orden</button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Comensales — no aplica a las órdenes "para llevar" (sin mesa): no hay a quién
              repartirle los productos, así que ni tiene sentido el concepto aquí. */}
          {order.mesa && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800">Comensales</h3>
                {!isClosed && <button className="btn-secondary py-1 px-3 text-xs" onClick={handleAddDiner}>+ Agregar comensal</button>}
              </div>
              <div className="flex flex-wrap gap-2">
                {order.comensales?.map((c) => (
                  <span key={c.id} className="bg-gray-100 rounded-full pl-3 pr-1 py-1 text-sm text-gray-700 flex items-center gap-1.5">
                    Comensal {c.numero}{c.nombre ? ` (${c.nombre})` : ''}
                    {!isClosed && (
                      <button
                        type="button"
                        title="Quitar comensal"
                        className="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 leading-none"
                        onClick={() => handleDeleteDiner(c)}
                      >✕</button>
                    )}
                  </span>
                ))}
                {(!order.comensales || order.comensales.length === 0) && (
                  <p className="text-gray-400 text-sm">Sin comensales todavía</p>
                )}
              </div>
            </div>
          )}

          {/* Items */}
          <div className="card p-0 overflow-hidden">
            <div className="p-4 pb-0">
              <h3 className="font-semibold text-gray-800 mb-2">Productos</h3>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                {/* Filtra la tabla de abajo por comensal (lo que va a consumir + lo que se le
                    canceló) o para ver de un jalón todo lo cancelado de la orden, sin importar
                    de quién. */}
                <select className="input !w-auto text-xs py-1.5" value={itemFilter} onChange={(e) => setItemFilter(e.target.value)}>
                  <option value="ALL">Todos los productos</option>
                  <option value="SHARED">Compartido</option>
                  {order.mesa && order.comensales?.map((c) => (
                    <option key={c.id} value={String(c.id)}>Comensal {c.numero}{c.nombre ? ` (${c.nombre})` : ''}</option>
                  ))}
                  <option value="CANCELLED_ALL">Todo lo cancelado</option>
                </select>
                <div className="flex gap-2">
                  {!isClosed && (order.items ?? []).some((i) => i.estado !== 'ENTREGADO' && i.estado !== 'CANCELADO') && (
                    <button
                      className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                      disabled={marcandoTodo}
                      onClick={handleMarcarTodoEntregado}
                    >
                      ✅ Marcar todo {entregadoLabel.toLowerCase()}
                    </button>
                  )}
                  {!isClosed && <button className="btn-primary py-1.5 px-3 text-sm" onClick={openAddItem}>+ Agregar producto</button>}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm min-w-[600px]">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Producto', 'Comensal', 'Cant.', 'Subtotal', 'Estado', ''].map((h) => (
                      <th key={h} className="text-left px-4 py-2 font-medium text-gray-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredItems.map((item) => (
                    <tr key={item.id} className={item.estado === 'CANCELADO' ? 'opacity-40' : ''}>
                      <td className="px-4 py-2 text-gray-900">
                        {item.productoNombre}
                        {(item.modificadores ?? []).map((m) => (
                          <p key={m.id} className="text-xs text-gray-500">
                            {m.grupoNombre} {m.nombre}{Number(m.precioExtra) > 0 ? ` (+${fmt(m.precioExtra)})` : ''}
                          </p>
                        ))}
                        {item.observaciones && <p className="text-xs text-gray-400">{item.observaciones}</p>}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{item.comensal ? `Comensal ${item.comensal.numero}` : 'Compartido'}</td>
                      <td className="px-4 py-2 text-gray-700">{Number(item.cantidad).toString()}</td>
                      <td className="px-4 py-2 text-gray-700">{fmt(item.subtotal)}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {itemEstadoLabel(item)}{item.estado !== 'CANCELADO' ? paymentLabel(item) : ''}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2 justify-end">
                          {!isClosed && !item.cargoExtra && item.estado !== 'CANCELADO' && item.estado !== 'ENTREGADO' && (
                            <button
                              className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100"
                              onClick={() => handleMarcarEntregado(item)}
                            >
                              {entregadoLabel}
                            </button>
                          )}
                          {!isClosed && !item.cargoExtra && item.estado !== 'CANCELADO' && (
                            <button className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100"
                              onClick={() => openEditItem(item)}>Editar</button>
                          )}
                          {!isClosed && item.estado !== 'CANCELADO' && Number(item.cantidadFacturada) === 0 && (
                            <button className="text-red-500 hover:underline text-xs" onClick={() => handleCancelItem(item)}>Cancelar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredItems.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                      {(!order.items || order.items.length === 0) ? 'Sin productos todavía' : 'Nada que mostrar con este filtro'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end">
              <div className="text-sm space-y-1 text-right">
                <p className="text-gray-500">Subtotal: <span className="font-medium text-gray-800">{fmt(filteredSubtotal)}</span></p>
                <p className="text-gray-900 font-bold text-base">Total: {fmt(filteredTotal)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Cuentas / cobro */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-semibold text-gray-800 mb-3">Cuentas</h3>
            {!isClosed && billableItems.length > 0 && !cobraRepartidor && (
              <button
                className="btn-primary w-full py-2 text-sm mb-3"
                onClick={() => {
                  if (!order.mesa || onlySharedPending) setAccountTipo('TOTAL')
                  setShowAccount(true)
                }}
              >+ Generar cuenta</button>
            )}
            {/* Pedido web a domicilio: el cobro lo hace el repartidor al entregar (página web → Entregas). */}
            {!isClosed && cobraRepartidor && (
              <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-900">
                🛵 <b>Lo cobra el repartidor</b> al entregarlo{order.metodoPago ? ` (${({ EFECTIVO: 'efectivo', TARJETA: 'tarjeta', TRANSFERENCIA: 'transferencia' })[order.metodoPago] ?? order.metodoPago})` : ''}. No se genera cuenta en caja.
              </div>
            )}
            <div className="space-y-3">
              {accounts.map((c) => (
                <div key={c.id} className="border border-gray-100 rounded-lg p-3 text-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-gray-800">{c.ticketFolio ?? `Cuenta #${c.id}`}</p>
                      <p className="text-xs text-gray-500">
                        {c.tipo === 'TOTAL' ? 'Total' : c.tipo === 'POR_COMENSAL' ? `Comensal ${c.comensal?.numero}` : 'Personalizada'}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      c.estado === 'PAGADA' ? 'bg-green-100 text-green-700' : c.estado === 'CANCELADA' ? 'bg-gray-100 text-gray-500' : 'bg-orange-100 text-orange-700'
                    }`}>{c.estado}</span>
                  </div>
                  <p className="mt-1 text-gray-700">Total: <span className="font-semibold">{fmt(c.total)}</span> · Pagado: {fmt(c.totalPagado)}</p>
                  <div className="mt-3 space-y-2">
                    {c.estado === 'PENDIENTE' && hasSection('CASH_CUTS') && (
                      <button className="btn-primary w-full py-2 text-sm" onClick={() => openPayModal(c)}>Registrar pago</button>
                    )}
                    {c.estado === 'PENDIENTE' && (isAdmin || isMesero) && (
                      <button
                        className="w-full py-2 text-sm font-medium rounded-lg border border-red-200 text-red-600 bg-white hover:bg-red-50 transition-colors"
                        onClick={() => handleCancelAccount(c)}
                      >Cancelar cuenta</button>
                    )}
                    {c.estado === 'PAGADA' && (
                      <button className="btn-secondary w-full py-2 text-sm" onClick={() => handleViewTicket(c)}>Ver ticket</button>
                    )}
                  </div>
                </div>
              ))}
              {accounts.length === 0 && <p className="text-gray-400 text-sm">Sin cuentas generadas</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Add item modal */}
      {showAddItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowAddItem(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-3">Agregar producto</h3>

            {/* Buscador + comensal, siempre visibles arriba */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
              <input className="input" placeholder="🔍 Buscar platillo..." value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)} />
              <select className="input" value={pickerComensalId} onChange={(e) => setPickerComensalId(e.target.value)}>
                <option value="">Compartido (sin comensal)</option>
                {order.comensales?.map((c) => <option key={c.id} value={c.id}>Comensal {c.numero}{c.nombre ? ` (${c.nombre})` : ''}</option>)}
              </select>
            </div>

            {/* Categorías como chips (en vez de un <select>): cada una muestra si está disponible
                AHORA (🔒 = fuera de horario o forzada oculta) y trae, aparte del click para
                filtrar, un botón ⏱ para cambiar su modo de disponibilidad al momento — ej. el
                mesero se da cuenta de que se acabó el insumo del desayuno antes de tiempo. */}
            <div className="flex flex-wrap gap-2 mb-1">
              <button type="button" onClick={() => setProductCat('')}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  !productCat ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                Todas
              </button>
              {categories.map((c) => {
                const active = String(productCat) === String(c.id)
                return (
                  <div key={c.id}
                    className={`flex items-center gap-0.5 pl-3 pr-1 py-1 rounded-full text-xs font-medium border transition-colors ${
                      active ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200'
                    } ${!c.availableNow ? 'opacity-60' : ''}`}>
                    <button type="button" onClick={() => setProductCat(String(c.id))}>
                      {!c.availableNow && '🔒 '}{c.name}
                    </button>
                    <button type="button" title="Cambiar disponibilidad"
                      className={`w-5 h-5 rounded-full flex items-center justify-center ${active ? 'hover:bg-white/20' : 'hover:bg-gray-100'}`}
                      onClick={() => setCategoryModeTarget(c)}>
                      ⏱
                    </button>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mb-3">
              {productQuery ? 'Resultados de tu búsqueda' : productCat ? 'Más pedidos de esta categoría' : 'Más pedidos en general'}
            </p>

            {/* Grilla de productos: tarjeta horizontal compacta (miniatura + nombre + descripción/precio
                en una sola línea + stepper). 3 por fila y altura de tarjeta fija (h-24) para que el
                contenedor quepa exactamente 4 filas (12 tarjetas) sin cortarlas; el resto se ve con
                scroll dentro de esta grilla (el modal en sí no crece más allá de 90vh). */}
            <div className="overflow-y-auto max-h-[420px] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-3 content-start">
              {products.map((p) => {
                const qty = cartQty(p.id)
                // Un producto con grupos de modificadores no usa el carrito de arriba: cada
                // personalización se agrega de inmediato, una a la vez, desde su propio selector.
                const personalizable = productModGrupos(p).length > 0
                return (
                  <div key={p.id} className={`border border-gray-100 rounded-lg overflow-hidden flex shadow-sm ${qty > 0 ? 'min-h-24' : 'h-24'}`}>
                    {p.imageUrl ? (
                      <img src={resolveMediaUrl(p.imageUrl)} alt={p.name} className="w-24 h-24 object-cover shrink-0 self-start" />
                    ) : (
                      <div className="w-24 h-24 bg-gray-100 flex items-center justify-center text-2xl text-gray-300 shrink-0 self-start">🍽️</div>
                    )}
                    <div className="p-2 flex-1 min-w-0 flex flex-col justify-between">
                      <p className="text-sm font-semibold text-gray-800 leading-snug line-clamp-2">{p.name}</p>
                      <div className="flex items-center justify-between gap-1">
                        <div className="min-w-0 flex items-baseline gap-1">
                          <span className="text-sm font-bold text-purple-700 shrink-0">{fmt(p.price)}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {personalizable ? (
                            <button type="button" className="btn-secondary !py-1 !px-2 !text-xs" onClick={() => openModPicker(p)}>Personalizar</button>
                          ) : (
                            <>
                              {qty > 0 && (
                                <>
                                  <button type="button" className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 font-bold hover:bg-gray-200"
                                    onClick={() => decrementCartItem(p.id)}>−</button>
                                  <span className="font-semibold text-sm text-gray-800 w-4 text-center">{qty}</span>
                                </>
                              )}
                              <button type="button" className="w-6 h-6 rounded-full bg-purple-600 text-white font-bold hover:bg-purple-700"
                                onClick={() => incrementCartItem(p.id)}>+</button>
                            </>
                          )}
                        </div>
                      </div>
                      {qty > 0 && !personalizable && (
                        <input className="input !py-1 !text-xs mt-1" placeholder="Notas (opcional)"
                          value={cart[p.id]?.observaciones ?? ''} onChange={(e) => setCartNota(p.id, e.target.value)} />
                      )}
                    </div>
                  </div>
                )
              })}
              {products.length === 0 && (
                <p className="text-gray-400 text-sm col-span-full text-center py-8">
                  {productCat && categories.find((c) => String(c.id) === String(productCat))?.availableNow === false
                    ? 'Esta categoría no está disponible en este momento (fuera de horario, o forzada oculta)'
                    : 'Sin resultados'}
                </p>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-3 border-t border-gray-100 mt-2">
              <button type="button" className="btn-secondary" onClick={() => setShowAddItem(false)}>Cancelar</button>
              <button type="button" className="btn-primary" disabled={loading || cartCount === 0} onClick={handleConfirmAddItems}>
                {loading ? '...' : `Agregar ${cartCount > 0 ? `(${cartCount})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disponibilidad de categoría — apilado sobre "Agregar producto" (z-[60] > 50), mismo
          endpoint ligero que Categorías (PUT /categories/{id}/availability-mode), accesible
          aquí sin ser ADMIN (basta con llegar a esta pantalla, ya gateada por Órdenes/Para
          llevar/Menú). */}
      {categoryModeTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setCategoryModeTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">{categoryModeTarget.name}</h3>
            <p className="text-sm text-gray-500 mb-4">
              {categoryModeTarget.scheduleStart && categoryModeTarget.scheduleEnd
                ? `Horario configurado: ${toDisplayTime(categoryModeTarget.scheduleStart)}–${toDisplayTime(categoryModeTarget.scheduleEnd)}`
                : 'Sin horario configurado (disponible todo el día en automático).'}
            </p>
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(MODE_LABEL).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={`py-2 rounded-lg text-sm font-semibold border transition-colors ${
                    categoryModeTarget.availabilityMode === mode
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                  onClick={() => handleCategoryModeChange(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="text-sm text-gray-400 hover:text-gray-600 mt-4 w-full text-center" onClick={() => setCategoryModeTarget(null)}>Cerrar</button>
          </div>
        </div>
      )}

      {/* Editar producto ya agregado — comensal, cantidad, modificadores y notas. */}
      {editItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setEditItem(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Editar producto</p>
              <h3 className="text-lg font-bold text-gray-900 mt-0.5">{editItem.productoNombre}</h3>
              {editEntregado && (
                <p className="text-xs text-orange-700 bg-orange-50 rounded-lg px-2 py-1.5 mt-2">
                  Ya salió de cocina: solo puedes cambiar el comensal o bajar la cantidad. Para pedir más, agrégalo como producto nuevo.
                </p>
              )}
              {!editEntregado && editFacturada > 0 && (
                <p className="text-xs text-orange-700 bg-orange-50 rounded-lg px-2 py-1.5 mt-2">
                  Ya hay {editFacturada} en una cuenta: la cantidad no puede bajar de eso y los modificadores no se pueden cambiar.
                </p>
              )}
            </div>

            <div className="p-5 space-y-4">
              {order.mesa && (
                <div>
                  <label className="text-xs font-medium text-gray-600">Comensal</label>
                  <select className="input mt-1" value={editComensalId} onChange={(e) => setEditComensalId(e.target.value)}>
                    <option value="">Compartido (sin comensal)</option>
                    {order.comensales?.map((c) => <option key={c.id} value={c.id}>Comensal {c.numero}{c.nombre ? ` (${c.nombre})` : ''}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-600">Cantidad</label>
                <div className="flex items-center gap-3 mt-1">
                  <button type="button" className="w-9 h-9 rounded-full bg-gray-100 text-gray-700 text-lg font-bold hover:bg-gray-200 disabled:opacity-40"
                    disabled={editCantidad <= editMinCantidad} onClick={() => setEditCantidad((q) => Math.max(editMinCantidad, q - 1))}>−</button>
                  <span className="text-xl font-bold text-gray-900 w-8 text-center">{editCantidad}</span>
                  <button type="button" className="w-9 h-9 rounded-full bg-purple-600 text-white text-lg font-bold hover:bg-purple-700 disabled:opacity-40"
                    disabled={editCantidad >= editMaxCantidad} onClick={() => setEditCantidad((q) => Math.min(editMaxCantidad, q + 1))}>+</button>
                </div>
              </div>

              {editGrupos.length > 0 && (
                <div className="space-y-3">
                  {editGrupos.map((g) => (
                    <div key={g.id}>
                      <p className="text-sm font-semibold text-gray-700 mb-1.5">
                        {g.nombre} {g.obligatorio && <span className="text-red-500">*</span>}
                        {g.tipo !== 'UNICO' && <span className="text-xs font-normal text-gray-400"> (varias)</span>}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {g.opciones.map((o) => {
                          const selected = (editSelections[g.id] ?? []).includes(o.id)
                          return (
                            <button key={o.id} type="button" disabled={editModsBloqueados}
                              className={`px-3 py-1.5 rounded-full text-sm font-semibold border disabled:opacity-50 disabled:cursor-not-allowed ${
                                selected ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200'}`}
                              onClick={() => toggleEditOpcion(g, o.id)}
                            >{o.nombre}{Number(o.precioExtra) > 0 ? ` (+${fmt(o.precioExtra)})` : ''}</button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                  {editFaltaObligatorio && <p className="text-xs text-red-600">Falta elegir una opción obligatoria</p>}
                </div>
              )}

              {editCantidad < Number(editItem.cantidad) && (
                <div>
                  <label className="text-xs font-medium text-gray-600">Motivo de la reducción (opcional)</label>
                  <input className="input mt-1" placeholder="Ej. el cliente regresó uno, se capturó de más..." value={editMotivo}
                    onChange={(e) => setEditMotivo(e.target.value)} />
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-600">Notas para cocina</label>
                <input className="input mt-1" placeholder="Ej. sin cebolla..." value={editNota} disabled={editEntregado}
                  onChange={(e) => setEditNota(e.target.value)} />
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 space-y-3">
              <div className="rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-center">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Subtotal</p>
                <p className="text-2xl font-bold text-green-700 mt-0.5">{fmt(editTotal)}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setEditItem(null)}>Cancelar</button>
                <button type="button" className="btn-primary flex-1" disabled={editSaving || editFaltaObligatorio} onClick={handleSaveEditItem}>
                  {editSaving ? '...' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Selector de modificadores — apilado sobre "Agregar producto" (z-[60] > 50) para el
          producto elegido; confirma agregando UNA unidad ya personalizada a la orden. */}
      {modPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setModPicker(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Personalizar</p>
              <h3 className="text-lg font-bold text-gray-900 mt-0.5">{modPicker.name}</h3>
              <p className="text-sm text-gray-500 mt-1">Precio base: {fmt(modPicker.price)}</p>
            </div>

            <div className="p-5 space-y-3">
              {modGrupos.map((g) => {
                const expanded = modExpandedGrupos.has(g.id)
                const resumen = modGrupoResumen(g)
                const falta = g.obligatorio && (modSelections[g.id]?.length ?? 0) === 0
                return (
                  <div key={g.id} className="border border-gray-100 rounded-lg overflow-hidden">
                    <button type="button" onClick={() => toggleModGrupoExpanded(g.id)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-gray-50">
                      <span className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        {g.nombre} {g.obligatorio && <span className="text-red-500">*</span>}
                      </span>
                      <span className="flex items-center gap-2 text-xs shrink-0 ml-2">
                        {resumen ? (
                          <span className="text-purple-700 font-medium truncate max-w-[140px]">{resumen}</span>
                        ) : falta ? (
                          <span className="text-red-600">Elige una opción</span>
                        ) : (
                          <span className="text-gray-400">Sin elegir</span>
                        )}
                        <span className="text-gray-400">{expanded ? '▾' : '▸'}</span>
                      </span>
                    </button>
                    {expanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-gray-100">
                        {g.tipo === 'UNICO' ? (
                          <div className="flex flex-wrap gap-2">
                            {g.opciones.map((o) => {
                              const selected = (modSelections[g.id] ?? []).includes(o.id)
                              return (
                                <button key={o.id} type="button"
                                  className={`px-3 py-2 rounded-full text-sm font-semibold border ${
                                    selected ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200'}`}
                                  onClick={() => toggleModOpcion(g, o.id)}
                                >{o.nombre}{Number(o.precioExtra) > 0 ? ` (+${fmt(o.precioExtra)})` : ''}</button>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {g.opciones.map((o) => {
                              const selected = (modSelections[g.id] ?? []).includes(o.id)
                              return (
                                <button key={o.id} type="button"
                                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left ${
                                    selected ? 'border-purple-600 bg-purple-50' : 'border-gray-200 bg-white'}`}
                                  onClick={() => toggleModOpcion(g, o.id)}
                                >
                                  <span className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold shrink-0 ${
                                    selected ? 'bg-purple-600 text-white' : 'border border-gray-300'}`}>{selected ? '✓' : ''}</span>
                                  <span className="flex-1 text-sm text-gray-800 font-medium">{o.nombre}</span>
                                  <span className="text-sm text-gray-500 font-semibold">
                                    {Number(o.precioExtra) > 0 ? `+${fmt(o.precioExtra)}` : '$0.00'}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              <div>
                <label className="text-xs font-medium text-gray-600">Notas para cocina (opcional)</label>
                <input className="input mt-1" placeholder="Ej. sin cebolla, servilletas extra..." value={modNota} onChange={(e) => setModNota(e.target.value)} />
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 space-y-3">
              <div className="rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-center">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Total</p>
                <p className="text-2xl font-bold text-green-700 mt-0.5">{fmt(modTotal)}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModPicker(null)}>Cancelar</button>
                <button type="button" className="btn-primary flex-1" disabled={loading || modFaltaObligatorio} onClick={handleConfirmModPicker}>
                  {loading ? '...' : 'Agregar a la orden'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create account modal */}
      {showAccount && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowAccount(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Generar cuenta</h3>
            <form onSubmit={handleCreateAccount} className="space-y-3">
              {/* Sin mesa (orden "para llevar") no hay a quién repartirle la cuenta — el
                  cobro es siempre por el total, sin selector de tipo. */}
              {order.mesa && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {[['TOTAL', 'Total'], ['POR_COMENSAL', 'Por comensal'], ['PERSONALIZADA', 'Personalizada']].map(([v, label]) => {
                      const disabled = onlySharedPending && v !== 'TOTAL'
                      return (
                        <button key={v} type="button" disabled={disabled}
                          className={`py-2 rounded-lg text-xs font-semibold border ${
                            disabled ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                              : accountTipo === v ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200'}`}
                          onClick={() => setAccountTipo(v)}>{label}</button>
                      )
                    })}
                  </div>
                  {onlySharedPending && (
                    <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                      Ya solo queda lo <span className="font-medium">Compartido</span> por cobrar — cada comensal ya pagó lo
                      suyo por separado, así que esto se cobra en una sola cuenta.
                    </p>
                  )}
                </>
              )}
              {accountTipo === 'TOTAL' && (
                <div className="rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-center overflow-hidden">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Total a cobrar</p>
                  <p className="font-bold text-green-700 text-2xl mt-0.5 break-words">{fmt(billableTotal)}</p>
                </div>
              )}
              {accountTipo === 'POR_COMENSAL' && (
                <>
                  <div><label className="text-xs font-medium text-gray-600">Comensal *</label>
                    <select className="input" required value={accountComensal} onChange={(e) => setAccountComensal(e.target.value)}>
                      <option value="">Seleccionar...</option>
                      {order.comensales?.map((c) => <option key={c.id} value={c.id}>Comensal {c.numero}{c.nombre ? ` (${c.nombre})` : ''}</option>)}
                    </select></div>
                  {accountComensal && (
                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-100">
                          <tr>
                            {['Producto', 'Cant.', 'Precio'].map((h) => (
                              <th key={h} className="text-left px-2 py-1.5 font-medium text-gray-600">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {comensalItems.map((item) => {
                            const unitario = Number(item.subtotal) / Number(item.cantidad)
                            return (
                              <tr key={item.id}>
                                <td className="px-2 py-1.5 text-gray-700">{item.productoNombre}</td>
                                <td className="px-2 py-1.5 text-gray-500">{remaining(item).toString()}</td>
                                <td className="px-2 py-1.5 text-gray-900">{fmt(unitario * remaining(item))}</td>
                              </tr>
                            )
                          })}
                          {comensalItems.length === 0 && (
                            <tr><td colSpan={3} className="px-2 py-3 text-center text-gray-400">Este comensal no tiene productos pendientes de cobro</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {accountComensal && (
                    <div className="rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-center overflow-hidden">
                      <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Total a cobrar</p>
                      <p className="font-bold text-green-700 text-2xl mt-0.5 break-words">{fmt(comensalTotal)}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <div className="flex-1 border-t border-gray-100" /> o <div className="flex-1 border-t border-gray-100" />
                  </div>
                  <button
                    type="button"
                    className="btn-secondary w-full py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={loading || comensalesConPendiente.length === 0}
                    onClick={handleCreateAllPerDinerAccounts}
                  >
                    Generar una cuenta por cada comensal{comensalesConPendiente.length > 0 ? ` (${comensalesConPendiente.length})` : ''}
                  </button>
                  <p className="text-xs text-gray-400">
                    Genera todas de un jalón, una por comensal — solo lo que pidió cada quien, sin incluir lo "Compartido".
                  </p>
                </>
              )}
              {accountTipo === 'PERSONALIZADA' && (
                <div className="space-y-2 max-h-56 overflow-y-auto border border-gray-100 rounded-lg p-2">
                  {billableItems.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={item.id in customSelection} onChange={(e) => toggleCustomItem(item, e.target.checked)} />
                      <span className="flex-1">{item.productoNombre} (pendiente: {remaining(item).toString()})</span>
                      {item.id in customSelection && (
                        <div className="flex items-center gap-1">
                          <button type="button"
                            className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 font-bold hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            disabled={customSelection[item.id] <= 1}
                            onMouseDown={() => startHoldStep(item, -1)} onMouseUp={stopHoldStep} onMouseLeave={stopHoldStep}
                            onTouchStart={() => startHoldStep(item, -1)} onTouchEnd={stopHoldStep}
                          >−</button>
                          <input className="input no-spinner !w-14 py-1 text-center" type="number" min="1" max={remaining(item)} step="1"
                            value={customSelection[item.id]}
                            onChange={(e) => setCustomSelection((s) => ({
                              ...s,
                              [item.id]: Math.min(remaining(item), Math.max(1, Number(e.target.value) || 1)),
                            }))} />
                          <button type="button"
                            className="w-6 h-6 rounded-full bg-purple-600 text-white font-bold hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            disabled={customSelection[item.id] >= remaining(item)}
                            onMouseDown={() => startHoldStep(item, 1)} onMouseUp={stopHoldStep} onMouseLeave={stopHoldStep}
                            onTouchStart={() => startHoldStep(item, 1)} onTouchEnd={stopHoldStep}
                          >+</button>
                        </div>
                      )}
                    </label>
                  ))}
                  {billableItems.length === 0 && <p className="text-gray-400 text-sm">No hay productos pendientes de pago</p>}
                </div>
              )}
              {accountTipo === 'PERSONALIZADA' && Object.keys(customSelection).length > 0 && (
                <div className="rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-center overflow-hidden">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Total a cobrar</p>
                  <p className="font-bold text-green-700 text-2xl mt-0.5 break-words">{fmt(customTotal)}</p>
                </div>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowAccount(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={loading}>{loading ? '...' : 'Generar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay modal — mismo flujo/estilo/validaciones que el cobro del POS de DemoPV,
          adaptado a que aquí una cuenta puede pagarse en varias partes (pagos parciales). */}
      {payModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closePayModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {paySuccess ? (
              <div className="text-center py-2">
                <div className="text-5xl mb-4">✅</div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Pago registrado</h3>
                <p className="text-gray-500 mb-1">{paySuccess.cuenta.ticketFolio ?? `Cuenta #${paySuccess.cuenta.id}`}</p>
                <p className="text-2xl font-bold text-purple-700 mb-1">{fmt(paySuccess.pago.monto)}</p>
                {paySuccess.pago.recibido != null && (
                  <div className="text-sm text-gray-500 mb-1">
                    <p>Recibido: {fmt(paySuccess.pago.recibido)}</p>
                    <p className="font-semibold text-gray-700">Cambio: {fmt(paySuccess.pago.recibido - paySuccess.pago.monto)}</p>
                  </div>
                )}
                {paySuccess.ticketType === 'digital' ? (
                  <p className="text-sm text-purple-700 mb-6">📧 Ticket enviado a {paySuccess.email}</p>
                ) : (
                  <p className="text-sm text-gray-400 mb-6">{printing ? '🖨️ Imprimiendo…' : '🖨️ Ticket enviado a la impresora'}</p>
                )}
                <div className="flex gap-2">
                  {paySuccess.ticketType === 'physical' ? (
                    <button className="btn-secondary flex-1" disabled={printing} onClick={() => printTicketNow(paySuccess.cuenta.id)}>
                      {printing ? 'Imprimiendo…' : '🖨️ Reimprimir'}
                    </button>
                  ) : (
                    <button className="btn-secondary flex-1" onClick={() => handleViewTicket(paySuccess.cuenta)}>Ver ticket</button>
                  )}
                  <button className="btn-primary flex-1" onClick={closePayModal}>Listo</button>
                </div>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-bold mb-1">Registrar pago</h3>
                <p className="text-sm text-gray-500 mb-1">
                  {payModal.ticketFolio ?? `Cuenta #${payModal.id}`} · Saldo pendiente: {fmt(paySaldoPendiente)}
                </p>
                {Number(payModal.propina) > 0 && (
                  <p className="text-xs text-gray-400 mb-2">Incluye {fmt(payModal.propina)} de propina{payModal.propinaPorcentaje != null ? ` (${Number(payModal.propinaPorcentaje)}%)` : ''}</p>
                )}
                <button
                  type="button"
                  className="text-xs text-purple-600 hover:underline mb-3"
                  onClick={() => setPayItemsOpen((o) => !o)}
                >
                  {payItemsOpen ? '▾' : '▸'} Ver productos de esta cuenta{(payModal.items?.length ?? 0) > 0 ? ` (${payModal.items.length})` : ''}
                </button>
                {payItemsOpen && (
                  <div className="border border-gray-100 rounded-lg overflow-hidden mb-3">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-gray-50">
                        {(payModal.items ?? []).map((it) => (
                          <tr key={it.id}>
                            <td className="px-2 py-1.5 text-gray-700">
                              {it.ordenDetalle?.productoNombre ?? '—'}
                              {(it.ordenDetalle?.modificadores ?? []).map((m) => (
                                <p key={m.id} className="text-gray-400">{m.grupoNombre} {m.nombre}</p>
                              ))}
                            </td>
                            <td className="px-2 py-1.5 text-gray-500 text-right">{it.cantidad}</td>
                            <td className="px-2 py-1.5 text-gray-900 text-right">{fmt(it.monto)}</td>
                          </tr>
                        ))}
                        {(payModal.items ?? []).length === 0 && (
                          <tr><td colSpan={3} className="px-2 py-2 text-center text-gray-400">Sin productos</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {!cashCut && (
                  <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg px-3 py-2 mb-3">
                    ⚠️ No hay corte de caja abierto. Debes <Link to="/cash-cuts" className="underline font-semibold">abrir un corte</Link> antes de poder cobrar.
                  </div>
                )}

                <form onSubmit={handlePay} className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600">Ticket</label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <button type="button"
                        className={`py-2 rounded-lg text-sm font-semibold border transition-colors ${
                          ticketType === 'physical' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                        onClick={() => setTicketType('physical')}
                      >🖨️ Físico</button>
                      <button type="button"
                        className={`py-2 rounded-lg text-sm font-semibold border transition-colors ${
                          ticketType === 'digital' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                        onClick={() => setTicketType('digital')}
                      >📧 Digital</button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600">
                      Correo para enviar el ticket {ticketType === 'digital' ? <span className="text-red-500">*</span> : '(opcional)'}
                    </label>
                    {/* Sin type="email" a propósito: el navegador metía su propio globo de
                        validación de formato antes de que este formulario alcanzara a correr. */}
                    <input className="input mt-1" type="text" placeholder="cliente@correo.com"
                      value={payEmail} onChange={(e) => setPayEmail(e.target.value)} />
                    {payDigitalEmailMissing ? (
                      <p className="text-xs text-red-500 mt-1">El ticket digital se manda por correo, captura uno para poder cobrar.</p>
                    ) : payEmailInvalid ? (
                      <p className="text-xs text-red-500 mt-1">El correo no tiene un formato válido</p>
                    ) : payEmailTooLong ? (
                      <p className="text-xs text-red-500 mt-1">El correo no puede tener más de 150 caracteres</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600">Método de pago</label>
                    <select className="input mt-1" value={payMetodo} onChange={(e) => handlePaymentMethodChange(e.target.value)}>
                      <option value="CASH">💵 Efectivo</option>
                      <option value="CARD">💳 Tarjeta</option>
                      <option value="TRANSFER">🏦 Transferencia</option>
                    </select>
                  </div>

                  {payPropinaEditable && (
                    <div className="border border-gray-100 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-gray-600">Propina (opcional)</label>
                        <div className="flex gap-1">
                          {[['NONE', 'Sin propina'], ['MONTO', '$'], ['PORCENTAJE', '%']].map(([v, label]) => (
                            <button key={v} type="button"
                              className={`px-2 py-1 rounded text-xs font-semibold border ${
                                payPropinaTipo === v ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200'}`}
                              onClick={() => handlePropinaTipoChange(v)}
                            >{label}</button>
                          ))}
                        </div>
                      </div>
                      {payPropinaTipo !== 'NONE' && (
                        <div className="flex items-center gap-2">
                          <input
                            className="input !w-28" type="number" min="0" step="0.01" autoFocus
                            placeholder={payPropinaTipo === 'PORCENTAJE' ? 'Ej. 10' : 'Ej. 20.00'}
                            value={payPropinaValor}
                            onChange={(e) => {
                              const v = e.target.value
                              setPayPropinaValor(v)
                              const num = v === '' ? null : Number(v)
                              const numValid = num != null && !Number.isNaN(num) && num >= 0
                                && (payPropinaTipo === 'PORCENTAJE' ? num <= 100 : num <= 9999999999.99)
                              // Fuera de rango: no se arrastra al monto sugerido — se deja en el
                              // saldo base y el error de abajo le indica al cajero qué corregir,
                              // en vez de que "Monto a aplicar" termine mostrando algo como 1e+54.
                              const tip = numValid
                                ? (payPropinaTipo === 'PORCENTAJE' ? Math.round(paySaldoPendiente * num) / 100 : num)
                                : 0
                              setPayMonto((paySaldoPendiente + tip).toFixed(2))
                            }}
                          />
                          {payPropinaValorExceedsLimit ? (
                            <p className="text-xs text-red-600">
                              {payPropinaTipo === 'PORCENTAJE'
                                ? 'El porcentaje no puede exceder 100'
                                : 'El número es excesivamente grande — el máximo permitido es 9,999,999,999.99'}
                            </p>
                          ) : payPropinaValorNegative ? (
                            <p className="text-xs text-red-600">La propina no puede ser negativa</p>
                          ) : payPropinaPreview > 0 ? (
                            <p className="text-xs text-gray-500">
                              Propina: <span className="font-semibold text-gray-700">{fmt(payPropinaPreview)}</span>
                              {' · '}Total: <span className="font-semibold text-gray-700">{fmt(paySaldoConPropina)}</span>
                            </p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-medium text-gray-600">Monto a aplicar *</label>
                    <input className="input mt-1" type="number" min="0" step="0.01"
                      value={payMonto} onChange={(e) => setPayMonto(e.target.value)} />
                    {payMontoExceedsLimit ? (
                      <p className="text-red-600 text-xs mt-1">El número es excesivamente grande — el máximo permitido es 9,999,999,999.99</p>
                    ) : payMontoExceedsSaldo ? (
                      <p className="text-red-600 text-xs mt-1">El monto no puede exceder el saldo pendiente ({fmt(paySaldoConPropina)})</p>
                    ) : null}
                  </div>

                  {payMetodo === 'CASH' && (
                    <div>
                      <label className="text-xs font-medium text-gray-600">¿Con cuánto paga el cliente?</label>
                      <input className="input mt-1" type="number" min="0" step="0.01" placeholder="0.00"
                        value={payRecibido} onChange={(e) => setPayRecibido(e.target.value)} />
                      {payRecibidoExceedsLimit && (
                        <p className="text-red-600 text-xs mt-1">El número es excesivamente grande — el máximo permitido es 9,999,999,999.99</p>
                      )}
                      {!payRecibidoExceedsLimit && payRecibido !== '' && (
                        payChange != null && payChange >= 0 ? (
                          <div className="mt-2 rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-center overflow-hidden">
                            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Cambio a entregar</p>
                            <p className="font-bold text-green-700 text-2xl mt-0.5 break-words">{fmt(payChange)}</p>
                          </div>
                        ) : payMontoNum != null && (
                          <div className="mt-2 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-center overflow-hidden">
                            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Falta por cobrar</p>
                            <p className="font-bold text-red-600 text-2xl mt-0.5 break-words">{fmt(payMontoNum - (payRecibidoNum ?? 0))}</p>
                          </div>
                        )
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 justify-end pt-2">
                    <button type="button" className="btn-secondary" onClick={closePayModal}>Cancelar</button>
                    <button
                      type="submit"
                      className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                      disabled={loading || !cashCut || payMontoMissing || payMontoExceedsLimit || payMontoExceedsSaldo
                        || payCashAmountMissing || payRecibidoExceedsLimit || payDigitalEmailMissing || payEmailTooLong || payEmailInvalid
                        || payPropinaValorInvalid}
                      title={!cashCut ? 'Abre un corte de caja para poder cobrar'
                        : payPropinaValorInvalid ? 'Revisa el valor de la propina'
                        : payMontoExceedsSaldo ? 'El monto no puede exceder el saldo pendiente'
                        : (payMontoExceedsLimit || payRecibidoExceedsLimit) ? 'El monto capturado es excesivamente grande'
                        : payCashAmountMissing ? 'Captura cuánto pagó el cliente en efectivo'
                        : payDigitalEmailMissing ? 'Captura el correo del cliente para el ticket digital'
                        : payEmailInvalid ? 'El correo capturado no es válido' : undefined}
                    >
                      {loading ? 'Procesando...'
                        : !cashCut ? 'Abre un corte para cobrar'
                        : payDigitalEmailMissing ? 'Captura el correo del cliente'
                        : (payMontoExceedsLimit || payRecibidoExceedsLimit) ? 'El monto es excesivamente grande'
                        : payPropinaValorInvalid ? 'Revisa el valor de la propina'
                        : payMontoExceedsSaldo ? 'Revisa el monto a aplicar'
                        : payCashAmountMissing ? 'Captura el monto recibido'
                        : payEmailInvalid ? 'Revisa el correo del cliente'
                        : payMontoMissing ? 'Captura el monto a aplicar'
                        : `Cobrar ${fmt(payMontoNum ?? 0)}`}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
