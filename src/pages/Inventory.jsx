import { useEffect, useRef, useState } from 'react'
import {
  getProductsPage, createProduct, updateProduct, adjustStock, deleteProduct, searchProducts,
  getProductByBarcode, getSiblingStock, getBulkImportTemplate, bulkImportProducts,
} from '../api/products'
import { getCategories, createCategory } from '../api/categories'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)

const emptyForm = { name: '', description: '', barcode: '', price: '', cost: '', stock: '', minStock: '', unit: 'pieza', categoryId: '', disponible: true }
const PAGE_SIZES = [10, 20, 50, 100]

// Valor centinela para la opción "Otra..." del selector de categoría: no puede colisionar
// con un id real (los ids de categoría son numéricos), así que sirve para distinguir "el
// usuario quiere crear una categoría nueva" de una categoría existente seleccionada.
const NEW_CATEGORY_VALUE = '__new__'

/**
 * Página "Inventario": administración del catálogo de productos de la tienda del usuario
 * (alta/edición/desactivación) y ajustes manuales de stock fuera del flujo normal de venta
 * (entradas por compra, salidas por merma/corrección). A diferencia de Menú (que se enfoca
 * en "Disponible" — un 86'd temporal, sin exigir llevar stock), esta pantalla es para quien
 * SÍ quiere controlar existencias reales: código de barras, costo, stock mínimo y unidad.
 * También muestra un aviso persistente con los productos en su stock mínimo o por debajo.
 *
 * Paginación server-side (mismo patrón que Sales/CashCuts): `GET /products/page` hace la
 * búsqueda de texto, el filtro de categoría y el de stock bajo (botón de encendido/apagado)
 * en el servidor. El texto de búsqueda lleva un debounce de 250ms para no pegarle a la API
 * en cada tecla.
 *
 * Control de acceso (vía `isAdmin`, solo frontend — el backend es quien realmente lo hace
 * cumplir): crear/editar/desactivar productos y registrar salidas de stock (ajuste "OUT",
 * reducir stock manualmente fuera de una venta) están reservados a un nivel de administrador
 * (ADMIN, o SUPER_ADMIN/SUPERVISOR actuando sobre una tienda). Cualquier usuario con acceso
 * a esta pantalla puede registrar entradas de stock ("IN").
 *
 * Lector de código de barras (altas/ajustes rápidos): el escaneo se captura a nivel de
 * documento (no hace falta tener el foco en ningún campo en particular — ver el `useEffect`
 * de `onKeyDown`, que distingue un escaneo de tecleo humano por la velocidad entre teclas) y
 * hace una búsqueda EXACTA por código. Si el código ya existe, pregunta (solo admin) si
 * quiere "Editar producto" o "Ajustar stock"; un usuario sin ese permiso va directo a
 * "Ajustar stock" (modo "Agregar piezas"). Si no existe, abre "Nuevo producto" con el código
 * ya precargado.
 */
export default function Inventory() {
  const { isAdmin, isSuperAdmin } = useAuth()
  const { notify, confirmDialog } = useNotify()
  const [pageData, setPageData] = useState({ content: [], totalElements: 0, totalPages: 0 })
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(20)
  const [showModal, setShowModal] = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [adjustModal, setAdjustModal] = useState(null)
  const [adjustDirection, setAdjustDirection] = useState('IN')
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustFieldErrors, setAdjustFieldErrors] = useState({})
  const [loading, setLoading] = useState(false)
  // Carga de la tabla paginada, separado de `loading` (del formulario de guardar/ajustar)
  // para que un refresco en segundo plano de la tabla no deshabilite ni cambie el texto del
  // botón "Guardar"/"Confirmar" de un modal abierto al mismo tiempo.
  const [tableLoading, setTableLoading] = useState(true)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [lowStockItems, setLowStockItems] = useState([])
  const [adjustNotice, setAdjustNotice] = useState('')
  const [scanCode, setScanCode] = useState('')
  const [choiceModal, setChoiceModal] = useState(null)
  const [showSiblingStock, setShowSiblingStock] = useState(false)
  const [bulkImportModal, setBulkImportModal] = useState(false)
  const [bulkImportFile, setBulkImportFile] = useState(null)
  const [bulkImporting, setBulkImporting] = useState(false)
  const [bulkImportResult, setBulkImportResult] = useState(null)
  const scanInputRef = useRef(null)
  const modalOpenRef = useRef(false)

  /**
   * Trae la página actual del catálogo usando `page`/`size`, el texto de búsqueda y los
   * filtros de categoría/stock bajo vigentes — todo resuelto en el servidor (`GET
   * /products/page`). Se re-ejecuta automáticamente (debounce de 250ms sobre el texto) cada
   * vez que cambia cualquiera de esos valores.
   */
  function loadPage() {
    setTableLoading(true)
    getProductsPage({
      q: search.trim() || undefined,
      categoryId: filterCat || undefined,
      lowStock: lowStockOnly || undefined,
      page,
      size,
    }).then((r) => setPageData(r.data.data ?? { content: [], totalElements: 0, totalPages: 0 }))
      .finally(() => setTableLoading(false))
  }

  useEffect(() => {
    const t = setTimeout(loadPage, 250)
    return () => clearTimeout(t)
  }, [search, filterCat, lowStockOnly, page, size])

  /** Recarga categorías (filtro y formulario) y la lista de stock mínimo/bajo (aviso amarillo). */
  function loadAux() {
    getCategories().then((r) => setCategories(r.data.data ?? []))
    searchProducts({ lowStock: true, size: 200 }).then((r) => setLowStockItems(r.data.data ?? []))
  }

  useEffect(() => { loadAux() }, [])

  /** Refresca tabla + datos auxiliares tras una operación que puede afectar a ambos. */
  function reloadAll() {
    loadPage()
    loadAux()
  }

  const products = pageData.content ?? []
  const totalElements = pageData.totalElements ?? 0
  const totalPages = pageData.totalPages ?? 0
  const rangeFrom = totalElements === 0 ? 0 : page * size + 1
  const rangeTo = Math.min(totalElements, page * size + products.length)

  /** Abre el modal de producto en modo "alta", opcionalmente con un código de barras ya escaneado. */
  function openNew(prefillBarcode) {
    setEditProduct(null)
    setForm({ ...emptyForm, barcode: prefillBarcode ?? '' })
    setNewCategoryName('')
    setError('')
    setFieldErrors({})
    setShowModal(true)
  }

  /** Abre el modal de producto en modo "edición", precargando el formulario con los datos del producto. */
  function openEdit(p) {
    setEditProduct(p)
    setForm({
      name: p.name, description: p.description ?? '', barcode: p.barcode ?? '',
      price: p.price, cost: p.cost ?? '', stock: p.stock,
      minStock: p.minStock, unit: p.unit, categoryId: p.category?.id ?? '',
      disponible: p.disponible !== false,
    })
    setNewCategoryName('')
    setError('')
    setFieldErrors({})
    setShowModal(true)
  }

  /**
   * Abre el modal de "Ajustar stock" para `p` en modo "Agregar piezas". `initialQty` deja
   * la cantidad en 1 cuando se abre a raíz de un escaneo (ese primer escaneo ya cuenta como
   * la primera pieza); al abrirse desde el botón "Ajustar" de la tabla se deja vacía.
   */
  function openAdjust(p, initialQty = '') {
    setAdjustModal(p)
    setAdjustDirection('IN')
    setAdjustQty(initialQty)
    setAdjustReason('')
    setAdjustFieldErrors({})
  }

  /**
   * Punto único al que llegan tanto el campo "Escanear código de barras" como el listener
   * global de teclado: busca coincidencia EXACTA por código. Si el producto ya existe, le
   * pregunta al usuario qué quiere hacer (editar o ajustar stock) — salvo que no tenga
   * permiso de editar, en cuyo caso va directo a "Ajustar stock". Si no existe, abre "Nuevo
   * producto" con el código ya precargado.
   */
  async function handleScannedCode(code) {
    // Con el modal de "Ajustar stock" ya abierto, volver a escanear el MISMO producto suma
    // 1 a la cantidad en vez de reabrir otro modal — así se puede ajustar varias piezas
    // seguidas con la pistola lectora sin tocar el teclado.
    if (adjustModal) {
      if (code === adjustModal.barcode) {
        setAdjustQty((q) => String((Number(q) || 0) + 1))
      } else {
        notify(`Código "${code}" no coincide con el producto que estás ajustando`, 'warning')
      }
      return
    }
    const found = (await getProductByBarcode(code).catch(() => null))?.data?.data
    if (found) {
      if (isAdmin) setChoiceModal(found)
      else openAdjust(found, '1')
    } else {
      notify(`Código "${code}" no encontrado — completa los datos para darlo de alta`, 'info')
      openNew(code)
    }
  }

  /** Maneja el Enter del campo "Escanear código de barras" (lo manda automáticamente un lector tras "teclear" el código). */
  async function handleScanKeyDown(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const code = scanCode.trim()
    if (!code) return
    setScanCode('')
    await handleScannedCode(code)
    scanInputRef.current?.focus()
  }

  // El listener global de abajo se monta una sola vez (deps `[]`) para no reinstalar el
  // listener en cada tecla — así que su callback NO puede llamar directo a
  // `handleScannedCode`: esa función se vuelve a crear en cada render y cerraría sobre un
  // `adjustModal`/`isAdmin` obsoletos. Este ref siempre apunta a la versión más reciente.
  const handleScannedCodeRef = useRef(handleScannedCode)
  useEffect(() => { handleScannedCodeRef.current = handleScannedCode })

  // Mantiene al día si hay algún modal abierto con campos de texto propios, para que el
  // listener global de escaneo no interfiera con lo que el usuario esté tecleando ahí. El
  // modal de "Ajustar stock" queda fuera a propósito: mientras está abierto, seguir
  // escaneando el mismo producto debe sumar a la cantidad, no bloquearse.
  useEffect(() => { modalOpenRef.current = showModal || !!choiceModal || bulkImportModal }, [showModal, choiceModal, bulkImportModal])

  // Captura de escaneo "global": una pistola lectora teclea cada carácter en milisegundos y
  // termina con Enter, mucho más rápido que una persona escribiendo a mano — así que no
  // hace falta tener el foco en el campo de escaneo específico. Se descarta cualquier
  // secuencia con tiempo entre teclas mayor a SCAN_GAP_MS (probablemente un Enter humano) y
  // se ignora mientras haya algún modal abierto o el foco ya esté en el campo de escaneo.
  useEffect(() => {
    const SCAN_GAP_MS = 50
    const MIN_CODE_LENGTH = 3
    let buffer = ''
    let lastTime = 0

    function onKeyDown(e) {
      if (modalOpenRef.current || e.ctrlKey || e.metaKey || e.altKey) return
      const now = Date.now()
      const gap = now - lastTime
      lastTime = now

      if (e.key === 'Enter') {
        const code = buffer
        buffer = ''
        if (code.length < MIN_CODE_LENGTH || gap >= SCAN_GAP_MS) return
        if (document.activeElement === scanInputRef.current) return
        e.preventDefault()
        handleScannedCodeRef.current(code)
        return
      }

      if (e.key.length === 1) {
        buffer = gap < SCAN_GAP_MS ? buffer + e.key : e.key
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Cierra con ESC el modal que esté abierto, descartando lo capturado — mismo
  // comportamiento que el botón "Cancelar" de cada uno.
  useEffect(() => {
    if (!showModal && !adjustModal && !choiceModal && !bulkImportModal) return
    function onKeyDown(e) {
      if (e.key !== 'Escape') return
      if (showModal) setShowModal(false)
      else if (adjustModal) setAdjustModal(null)
      else if (choiceModal) setChoiceModal(null)
      else if (bulkImportModal) setBulkImportModal(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showModal, adjustModal, choiceModal, bulkImportModal])

  /**
   * Valida el formulario de producto del lado del cliente, replicando los límites que ya
   * exige `ProductRequest` en el backend (mismos textos de mensaje) — para detectar el
   * error ANTES de pedir confirmación de guardado, en vez de hacerlo hasta después del
   * viaje redondo al servidor. El backend sigue siendo quien de verdad decide.
   *
   * @returns {{[field: string]: string}} vacío si el formulario es válido
   */
  function validateProductForm() {
    const errors = {}
    // Nombre/Precio/Categoría no llevan el atributo HTML `required` (ver el JSX del modal)
    // — ese globo nativo del navegador se disparaba ANTES de que este formulario alcanzara
    // a correr. Estos checks son quienes cubren "obligatorio".
    if (!form.name.trim()) errors.name = 'El nombre es obligatorio'
    else if (form.name.length > 200) errors.name = 'El nombre no puede tener más de 200 caracteres'
    if (form.description.length > 50) errors.description = 'La descripción no puede tener más de 50 caracteres'
    if (form.barcode.length > 100) errors.barcode = 'El código de barras no puede tener más de 100 caracteres'
    if (form.unit.length > 20) errors.unit = 'La unidad no puede tener más de 20 caracteres'
    // Máximos alineados al límite real de columna en Postgres (ver ProductRequest en el
    // backend): NUMERIC(12,2) para price/cost, INTEGER para stock/minStock.
    if (form.price === '') errors.price = 'El precio es obligatorio'
    else if (Number(form.price) > 9999999999.99) errors.price = 'El precio no puede ser mayor a 9,999,999,999.99'
    if (form.cost !== '' && Number(form.cost) > 9999999999.99) errors.cost = 'El costo no puede ser mayor a 9,999,999,999.99'
    if (form.stock !== '' && Number(form.stock) > 2147483647) errors.stock = 'El stock no puede ser mayor a 2,147,483,647'
    if (form.minStock !== '' && Number(form.minStock) > 2147483647) errors.minStock = 'El stock mínimo no puede ser mayor a 2,147,483,647'
    if (!form.categoryId) errors.categoryId = 'Selecciona una categoría'
    else if (form.categoryId === NEW_CATEGORY_VALUE && !newCategoryName.trim()) errors.newCategoryName = 'Escribe el nombre de la nueva categoría'
    return errors
  }

  /**
   * Guarda el formulario de producto, creando uno nuevo o actualizando `editProduct` según
   * cuál esté seteado. Si el backend rechaza la operación, muestra el mensaje de error
   * dentro del propio modal (no usa `notify`) para que el usuario pueda corregir sin perder
   * lo capturado.
   *
   * Categoría nueva ("Otra..."): si el selector quedó en `NEW_CATEGORY_VALUE`, primero crea
   * la categoría con el nombre capturado y usa el id que devuelve el backend para el
   * producto — todo en un solo Guardar. Si la creación de la categoría falla, el producto
   * tampoco se guarda.
   */
  async function handleSave(e) {
    e.preventDefault()
    const validationErrors = validateProductForm()
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors)
      setError('')
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    const confirmMsg = editProduct
      ? `¿Deseas guardar los cambios de "${form.name}"?`
      : `¿Deseas agregar el producto "${form.name}"?`
    if (!(await confirmDialog(confirmMsg, { confirmText: editProduct ? 'Guardar cambios' : 'Agregar', danger: false }))) return
    setLoading(true)
    setError('')
    setFieldErrors({})
    try {
      let categoryId = form.categoryId
      if (categoryId === NEW_CATEGORY_VALUE) {
        const name = newCategoryName.trim()
        if (!name) { setError('Escribe el nombre de la nueva categoría'); setLoading(false); return }
        const newCategory = (await createCategory({ name })).data.data
        setCategories((prev) => [...prev, newCategory])
        categoryId = newCategory.id
      }
      const payload = {
        ...form, price: Number(form.price), cost: form.cost === '' ? null : Number(form.cost),
        stock: form.stock === '' ? null : Number(form.stock), minStock: form.minStock === '' ? null : Number(form.minStock),
        categoryId: Number(categoryId),
      }
      if (editProduct) {
        await updateProduct(editProduct.id, payload)
      } else {
        await createProduct(payload)
      }
      setShowModal(false)
      reloadAll()
      notify(editProduct ? 'Producto editado correctamente' : 'Producto guardado correctamente', 'success')
    } catch (err) {
      // Errores de validación/conflicto (ver GlobalExceptionHandler en el backend) traen
      // { campo: mensaje } en `data` — se reparten a `fieldErrors` para mostrarse justo
      // debajo de cada input. Cualquier otro error va al mensaje general.
      const data = err.response?.data?.data
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        setFieldErrors(data)
        setError('')
      } else {
        setFieldErrors({})
        setError(err.response?.data?.message ?? 'Error al guardar')
      }
      notify(editProduct ? 'Error al guardar el producto' : 'Error al registrar el producto', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Valores derivados del modal de "Ajustar stock":
  // - adjustQtyNum: cantidad siempre positiva que el usuario capturó (el signo lo decide `adjustDirection`).
  // - adjustSignedQty: la cantidad ya con signo según la dirección elegida — lo que se manda al backend.
  // - adjustPreviewStock: stock resultante que se le muestra al usuario ANTES de confirmar.
  const adjustQtyNum = Math.abs(Number(adjustQty) || 0)
  const adjustSignedQty = adjustDirection === 'OUT' ? -adjustQtyNum : adjustQtyNum
  const adjustPreviewStock = adjustModal ? adjustModal.stock + adjustSignedQty : null
  // Mismo límite que ProductService#adjustStock en el backend (máximo de un INTEGER de
  // Postgres) — cubre ambas direcciones porque compara el resultado ya con signo aplicado.
  const adjustPreviewExceedsLimit = adjustQtyNum > 2147483647 || adjustPreviewStock > 2147483647

  /**
   * Envía el ajuste manual de stock (entrada o salida) para el producto en `adjustModal`.
   * Tras un ajuste exitoso recarga el catálogo/lista de stock mínimo y, si el producto
   * quedó en su nivel mínimo o por debajo, muestra un aviso rojo adicional con el nombre y
   * las existencias restantes.
   */
  async function handleAdjust(e) {
    e.preventDefault()
    const validationErrors = {}
    if (adjustQtyNum <= 0) validationErrors.quantity = 'La cantidad debe ser mayor a 0'
    else if (adjustPreviewExceedsLimit) {
      validationErrors.quantity = 'El número es excesivamente grande — el máximo permitido es 2,147,483,647'
    }
    if (adjustReason.length > 255) validationErrors.reason = 'El motivo no puede tener más de 255 caracteres'
    if (Object.keys(validationErrors).length > 0) {
      setAdjustFieldErrors(validationErrors)
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    setAdjustFieldErrors({})
    const verb = adjustDirection === 'IN' ? 'agregar' : 'quitar'
    const prep = adjustDirection === 'IN' ? 'a' : 'de'
    const confirmMsg = `¿Deseas ${verb} ${adjustQtyNum} ${adjustModal.unit} ${prep} "${adjustModal.name}"?`
    if (!(await confirmDialog(confirmMsg, { confirmText: 'Confirmar', danger: adjustDirection === 'OUT' }))) return
    setLoading(true)
    try {
      const res = await adjustStock(adjustModal.id, { quantity: adjustSignedQty, reason: adjustReason })
      const updated = res.data.data
      setAdjustModal(null)
      setAdjustQty('')
      setAdjustReason('')
      reloadAll()
      notify(
        adjustDirection === 'IN'
          ? `${adjustQtyNum} ${adjustModal.unit} agregada(s) a "${adjustModal.name}"`
          : `${adjustQtyNum} ${adjustModal.unit} descontada(s) de "${adjustModal.name}"`,
        'success'
      )
      if (updated && updated.minStock > 0 && updated.stock <= updated.minStock) {
        setAdjustNotice(`⚠️ "${updated.name}" ya está en su nivel mínimo de stock (${updated.stock} ${updated.unit} disponibles)`)
      }
    } catch (err) {
      const data = err.response?.data?.data
      setAdjustFieldErrors(data && typeof data === 'object' && !Array.isArray(data) ? data : {})
      notify(err.response?.data?.message ?? 'Error al ajustar el stock', 'error')
    } finally {
      setLoading(false)
    }
  }

  /** Da de baja un producto (borrado suave — conserva el historial de ventas/movimientos que lo referencian). */
  async function handleDelete(p) {
    if (!(await confirmDialog(`¿Desactivar "${p.name}"?`, { confirmText: 'Desactivar' }))) return
    try {
      await deleteProduct(p.id)
      reloadAll()
      notify(`"${p.name}" desactivado correctamente`, 'success')
    } catch (err) {
      notify(err.response?.data?.message ?? 'Error al desactivar el producto', 'error')
    }
  }

  /** Descarga un blob ya en memoria (plantilla o reporte de errores) con el nombre dado. */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  /** Descarga la plantilla de carga masiva (ADMIN/SUPER_ADMIN/SUPERVISOR). */
  async function handleDownloadTemplate() {
    try {
      const res = await getBulkImportTemplate()
      downloadBlob(res.data, 'plantilla-carga-masiva-productos.xlsx')
    } catch (err) {
      notify('No se pudo descargar la plantilla', 'error')
    }
  }

  function openBulkImport() {
    setBulkImportModal(true)
    setBulkImportFile(null)
    setBulkImportResult(null)
  }

  /** Sube el archivo de carga masiva y se queda con el resultado — el usuario necesita ver el resumen de creados/errores antes de decidir qué hacer. */
  async function handleBulkImportSubmit(e) {
    e.preventDefault()
    if (!bulkImportFile) return
    setBulkImporting(true)
    try {
      const res = await bulkImportProducts(bulkImportFile)
      setBulkImportResult(res.data.data)
      reloadAll()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo procesar el archivo', 'error')
    } finally {
      setBulkImporting(false)
    }
  }

  /** Decodifica el Excel de errores (viene en base64 dentro de la misma respuesta) y lo descarga. */
  function handleDownloadErrorReport() {
    const bytes = Uint8Array.from(atob(bulkImportResult.errorReportBase64), (c) => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    downloadBlob(blob, 'errores-carga-masiva-productos.xlsx')
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Inventario</h2>
        <div className="flex flex-wrap gap-2">
          {isAdmin && <button className="btn-secondary text-sm" onClick={handleDownloadTemplate}>⬇️ Plantilla de carga masiva</button>}
          {isSuperAdmin && <button className="btn-secondary text-sm" onClick={openBulkImport}>📤 Carga masiva</button>}
          {isAdmin && <button className="btn-primary" onClick={() => openNew()}>+ Nuevo producto</button>}
        </div>
      </div>

      {adjustNotice && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <span>{adjustNotice}</span>
          <button className="text-red-400 hover:text-red-600 ml-4" onClick={() => setAdjustNotice('')}>✕</button>
        </div>
      )}

      {lowStockItems.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-lg px-4 py-3 mb-4">
          ⚠️ {lowStockItems.length} producto{lowStockItems.length > 1 ? 's' : ''} en stock mínimo o por debajo: {' '}
          {lowStockItems.map((p) => p.name).join(', ')}
        </div>
      )}

      {/* Escaneo de código de barras: alta/ajuste rápido, independiente del filtro de abajo. */}
      <div className="relative mb-4 max-w-md">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">📷</span>
        <input
          ref={scanInputRef}
          className="input pl-9 py-1.5"
          placeholder="Escanear código de barras (alta / ajuste rápido)"
          value={scanCode}
          onChange={(e) => setScanCode(e.target.value)}
          onKeyDown={handleScanKeyDown}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input className="input flex-1 min-w-[220px]" placeholder="Buscar por nombre o código..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0) }} />
        <select className="input w-52" value={filterCat} onChange={(e) => { setFilterCat(e.target.value); setPage(0) }}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          type="button"
          className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
            lowStockOnly ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          onClick={() => { setLowStockOnly((v) => !v); setPage(0) }}
        >
          ⚠️ Stock bajo
        </button>
        <button
          type="button"
          className="px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
          onClick={() => setShowSiblingStock(true)}
          title="Ver si otra tienda de tu mismo grupo tiene existencias de un producto"
        >
          🏬 Buscar en tiendas asociadas
        </button>
        {(search || filterCat || lowStockOnly) && (
          <button
            type="button" className="btn-secondary text-sm"
            onClick={() => { setSearch(''); setFilterCat(''); setLowStockOnly(false); setPage(0) }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Producto', 'Categoría', 'Código', 'Precio', 'Stock', 'Mín.', 'Disponible'].map((h) => (
                <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
              ))}
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                <td className="px-4 py-3 text-gray-500">{p.category?.name}</td>
                <td className="px-4 py-3 text-gray-400 font-mono text-xs">{p.barcode}</td>
                <td className="px-4 py-3 text-gray-700">{fmt(p.price)}</td>
                <td className="px-4 py-3">
                  <span className={`font-semibold ${p.minStock > 0 && p.stock <= p.minStock ? 'text-red-600' : 'text-green-600'}`}>
                    {p.stock} {p.unit}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400">{p.minStock}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${p.disponible !== false ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                    {p.disponible !== false ? 'Sí' : 'No'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 justify-end">
                    {isAdmin && (
                      <button className="text-blue-600 hover:underline text-xs" onClick={() => openEdit(p)}>Editar</button>
                    )}
                    <button className="text-purple-600 hover:underline text-xs" onClick={() => openAdjust(p)}>Ajustar</button>
                    {isAdmin && (
                      <button className="text-red-500 hover:underline text-xs" onClick={() => handleDelete(p)}>Desact.</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">{tableLoading ? 'Cargando...' : 'Sin productos'}</td></tr>
            )}
          </tbody>
        </table>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 text-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <span>Mostrar</span>
            <select
              className="input !w-auto py-1"
              value={size}
              onChange={(e) => { setSize(Number(e.target.value)); setPage(0) }}
            >
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>por página · {totalElements === 0 ? 'sin resultados' : `${rangeFrom}–${rangeTo} de ${totalElements}`}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn-secondary py-1 px-3 text-xs disabled:opacity-40"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ‹ Anterior
            </button>
            <span className="text-gray-500 text-xs">Página {totalPages === 0 ? 0 : page + 1} de {totalPages}</span>
            <button
              className="btn-secondary py-1 px-3 text-xs disabled:opacity-40"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente ›
            </button>
          </div>
        </div>
      </div>

      {/* Product modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{editProduct ? 'Editar producto' : 'Nuevo producto'}</h3>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Nombre <span className={fieldErrors.name ? 'text-red-600' : ''}>*</span></label>
                  <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  {fieldErrors.name && <p className="text-red-600 text-xs mt-1">{fieldErrors.name}</p>}</div>
                <div><label className="text-xs font-medium text-gray-600">Código de barras</label>
                  <input className="input" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
                  {fieldErrors.barcode && <p className="text-red-600 text-xs mt-1">{fieldErrors.barcode}</p>}</div>
                <div><label className="text-xs font-medium text-gray-600">Precio venta <span className={fieldErrors.price ? 'text-red-600' : ''}>*</span></label>
                  <input className="input" type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                  {fieldErrors.price && <p className="text-red-600 text-xs mt-1">{fieldErrors.price}</p>}</div>
                <div><label className="text-xs font-medium text-gray-600">Costo</label>
                  <input className="input" type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
                  {fieldErrors.cost && <p className="text-red-600 text-xs mt-1">{fieldErrors.cost}</p>}</div>
                <div><label className="text-xs font-medium text-gray-600">Stock inicial</label>
                  <input className="input" type="number" disabled={!!editProduct} value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })} />
                  {editProduct
                    ? <p className="text-gray-400 text-xs mt-1">Usa "Ajustar" en la tabla para cambiar el stock.</p>
                    : fieldErrors.stock && <p className="text-red-600 text-xs mt-1">{fieldErrors.stock}</p>}</div>
                <div><label className="text-xs font-medium text-gray-600">Stock mínimo</label>
                  <input className="input" type="number" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
                  {fieldErrors.minStock && <p className="text-red-600 text-xs mt-1">{fieldErrors.minStock}</p>}</div>
                <div><label className="text-xs font-medium text-gray-600">Unidad</label>
                  <input className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
                  {fieldErrors.unit && <p className="text-red-600 text-xs mt-1">{fieldErrors.unit}</p>}</div>
                <div><label className="text-xs font-medium text-gray-600">Categoría <span className={fieldErrors.categoryId ? 'text-red-600' : ''}>*</span></label>
                  <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    <option value={NEW_CATEGORY_VALUE}>Otra...</option>
                  </select>
                  {fieldErrors.categoryId && <p className="text-red-600 text-xs mt-1">{fieldErrors.categoryId}</p>}
                </div>
                {form.categoryId === NEW_CATEGORY_VALUE && (
                  <div><label className="text-xs font-medium text-gray-600">Nombre de la nueva categoría <span className={fieldErrors.newCategoryName ? 'text-red-600' : ''}>*</span></label>
                    <input className="input" autoFocus value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Ej. Bebidas" />
                    {fieldErrors.newCategoryName && <p className="text-red-600 text-xs mt-1">{fieldErrors.newCategoryName}</p>}</div>
                )}
              </div>
              <div><label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                {fieldErrors.description && <p className="text-red-600 text-xs mt-1">{fieldErrors.description}</p>}</div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.disponible} onChange={(e) => setForm({ ...form, disponible: e.target.checked })} />
                <span className="text-sm text-gray-700">Disponible para pedirse</span>
              </label>

              {error && <p className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</p>}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Choice modal: tras un escaneo de un código ya existente, pregunta qué hacer (solo admin llega aquí) */}
      {choiceModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setChoiceModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Producto encontrado</h3>
            <p className="text-sm text-gray-500 mb-4">{choiceModal.name} — código {choiceModal.barcode}</p>
            <div className="grid grid-cols-1 gap-2">
              <button type="button" className="btn-secondary" onClick={() => { const p = choiceModal; setChoiceModal(null); openEdit(p) }}>✏️ Editar producto</button>
              <button type="button" className="btn-primary" onClick={() => { const p = choiceModal; setChoiceModal(null); openAdjust(p, '1') }}>➕ Ajustar stock</button>
              <button type="button" className="btn-secondary text-red-600" onClick={() => { const p = choiceModal; setChoiceModal(null); handleDelete(p) }}>🚫 Desactivar producto</button>
            </div>
            <button type="button" className="text-sm text-gray-400 hover:text-gray-600 mt-4 w-full text-center" onClick={() => setChoiceModal(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Adjust modal */}
      {adjustModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setAdjustModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Ajustar stock</h3>
            <p className="text-sm text-gray-500 mb-4">{adjustModal.name} — actual: {adjustModal.stock} {adjustModal.unit} · mínimo: {adjustModal.minStock} {adjustModal.unit}</p>
            <form onSubmit={handleAdjust} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">¿Qué quieres hacer? *</label>
                <div className={`grid gap-2 ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <button type="button"
                    className={`py-2 rounded-lg text-sm font-semibold border transition-colors ${
                      adjustDirection === 'IN' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    onClick={() => { setAdjustDirection('IN'); setAdjustFieldErrors({}) }}
                  >➕ Agregar piezas</button>
                  {isAdmin && (
                    <button type="button"
                      className={`py-2 rounded-lg text-sm font-semibold border transition-colors ${
                        adjustDirection === 'OUT' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                      onClick={() => { setAdjustDirection('OUT'); setAdjustFieldErrors({}) }}
                    >➖ Quitar piezas</button>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Cantidad de piezas <span className={adjustFieldErrors.quantity ? 'text-red-600' : ''}>*</span></label>
                <div className="flex items-center gap-2">
                  <button type="button" className="w-9 h-9 rounded border text-gray-600 hover:bg-gray-100 text-lg leading-none"
                    onClick={() => setAdjustQty((q) => String(Math.max(0, (Number(q) || 0) - 1)))}>−</button>
                  {/* type="text" a propósito, no "number": un <input type="number"> deja teclear
                      "e" (notación científica) y la normaliza sola. */}
                  <input className="input text-center" type="text" inputMode="numeric" value={adjustQty}
                    onChange={(e) => setAdjustQty(e.target.value.replace(/[^0-9]/g, ''))} />
                  <button type="button" className="w-9 h-9 rounded border text-gray-600 hover:bg-gray-100 text-lg leading-none"
                    onClick={() => setAdjustQty((q) => String((Number(q) || 0) + 1))}>+</button>
                </div>
                {adjustFieldErrors.quantity && <p className="text-red-600 text-xs mt-1">{adjustFieldErrors.quantity}</p>}
              </div>
              {adjustQtyNum > 0 && (
                <div className={`text-sm rounded-lg px-3 py-2 ${(adjustPreviewStock < 0 || adjustPreviewExceedsLimit) ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'}`}>
                  {adjustPreviewExceedsLimit ? (
                    'El número es excesivamente grande — el máximo permitido es 2,147,483,647'
                  ) : (
                    <>
                      Nuevo stock: <span className="font-bold">{adjustPreviewStock}</span> {adjustModal.unit}
                      {adjustPreviewStock < 0 && ' — no puede ser negativo'}
                    </>
                  )}
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-600">Motivo</label>
                <input className="input" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Compra, merma, corrección..." />
                {adjustFieldErrors.reason && <p className="text-red-600 text-xs mt-1">{adjustFieldErrors.reason}</p>}
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setAdjustModal(null)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={loading || adjustQtyNum === 0 || adjustPreviewStock < 0 || adjustPreviewExceedsLimit}>
                  {loading ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSiblingStock && <SiblingStockModal onClose={() => setShowSiblingStock(false)} />}

      {/* Carga masiva de productos por Excel — solo SUPER_ADMIN (ver el botón que lo abre). */}
      {bulkImportModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setBulkImportModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Carga masiva de productos</h3>

            {!bulkImportResult ? (
              <>
                <p className="text-sm text-gray-500 mb-4">
                  Sube un Excel con el mismo formato que la plantilla — cada fila válida da de alta un producto nuevo.
                  Un código de barras repetido (contra el catálogo o dentro del mismo archivo) se reporta como error,
                  nunca actualiza el producto existente.
                </p>
                <form onSubmit={handleBulkImportSubmit} className="space-y-3">
                  <input
                    type="file" accept=".xlsx"
                    onChange={(e) => setBulkImportFile(e.target.files?.[0] || null)}
                    className="text-sm"
                  />
                  <div className="flex gap-2 justify-end pt-2">
                    <button type="button" className="btn-secondary" onClick={() => setBulkImportModal(false)} disabled={bulkImporting}>Cancelar</button>
                    <button type="submit" className="btn-primary" disabled={!bulkImportFile || bulkImporting}>
                      {bulkImporting ? 'Procesando...' : 'Subir archivo'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-700 mb-1">
                  <span className="font-semibold text-green-700">{bulkImportResult.created}</span> producto{bulkImportResult.created === 1 ? '' : 's'} creado{bulkImportResult.created === 1 ? '' : 's'}
                  {bulkImportResult.errorCount > 0 && (
                    <> — <span className="font-semibold text-red-600">{bulkImportResult.errorCount}</span> con error</>
                  )}
                </p>
                {bulkImportResult.errorCount > 0 && (
                  <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
                    {bulkImportResult.errors.map((e, i) => (
                      <div key={i} className="text-xs bg-red-50 text-red-700 rounded px-3 py-2">
                        <span className="font-semibold">Fila {e.row}:</span> {e.message}
                      </div>
                    ))}
                    {bulkImportResult.errorCount > bulkImportResult.errors.length && (
                      <p className="text-xs text-gray-400 pt-1">
                        y {bulkImportResult.errorCount - bulkImportResult.errors.length} error{bulkImportResult.errorCount - bulkImportResult.errors.length === 1 ? '' : 'es'} más — descarga el reporte completo abajo.
                      </p>
                    )}
                  </div>
                )}
                <div className="flex gap-2 justify-end pt-4">
                  {bulkImportResult.errorReportBase64 && (
                    <button type="button" className="btn-secondary text-sm mr-auto" onClick={handleDownloadErrorReport}>
                      ⬇️ Descargar reporte de errores
                    </button>
                  )}
                  <button type="button" className="btn-secondary" onClick={openBulkImport}>Cargar otro archivo</button>
                  <button type="button" className="btn-primary" onClick={() => setBulkImportModal(false)}>Cerrar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Modal "Buscar en tiendas asociadas": consulta de solo lectura de stock disponible en las
 * sucursales que comparten el mismo Supervisor de tiendas que la del usuario en sesión,
 * nunca la propia tienda (esa ya se ve en la tabla principal de Inventario).
 *
 * Visible para cualquier rol con acceso a esta pantalla, no solo ADMIN: un mesero o cajero
 * también necesita poder decirle a un cliente/proveedor "no lo tenemos aquí, pero sí en la
 * sucursal X" sin que eso le dé acceso a nada más de esa otra tienda. Si la tienda del
 * usuario no tiene un Supervisor asignado (o no tiene sucursales hermanas), el backend
 * regresa una página vacía en vez de un error — se muestra igual que "sin resultados".
 */
function SiblingStockModal({ onClose }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)

  // Debounce de 350ms — no busca nada con menos de 2 caracteres, para no pegarle a la API
  // con cada letra de una búsqueda que apenas empieza.
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([])
      setSearched(false)
      return
    }
    setLoading(true)
    const t = setTimeout(() => {
      getSiblingStock({ q: q.trim(), size: 50 })
        .then((r) => setResults(r.data.data?.content ?? []))
        .finally(() => { setLoading(false); setSearched(true) })
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-1">🏬 Buscar en tiendas asociadas</h3>
        <p className="text-sm text-gray-500 mb-4">
          Busca un producto por nombre o código para ver si hay existencias en otras sucursales de tu mismo grupo.
        </p>
        <input
          className="input" autoFocus placeholder="Nombre o código del producto..."
          value={q} onChange={(e) => setQ(e.target.value)}
        />

        <div className="mt-4">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-6">Buscando...</p>
          ) : !searched ? (
            <p className="text-sm text-gray-400 text-center py-6">Escribe al menos 2 letras para buscar.</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              Sin resultados en tiendas asociadas — puede que ninguna tenga existencias de eso, o que tu tienda no tenga sucursales asociadas todavía.
            </p>
          ) : (
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
              {results.map((p) => (
                <div key={`${p.tienda?.id}-${p.id}`} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">🏬 {p.tienda?.name ?? '—'}</p>
                  </div>
                  <span className="text-green-600 font-semibold text-sm shrink-0 ml-3">{p.stock} {p.unit}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}
