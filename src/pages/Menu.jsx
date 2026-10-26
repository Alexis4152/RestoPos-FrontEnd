import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getProducts, createProduct, updateProduct, adjustStock, deleteProduct, searchProducts, uploadProductImage, removeProductImage } from '../api/products'
import { getCategories } from '../api/categories'
import { getModificadorGrupos, getModificadorGruposCopiables, createModificadorGrupo, updateModificadorGrupo, deleteModificadorGrupo, reorderModificadorGrupos } from '../api/modificadores'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { resolveMediaUrl } from '../utils/media'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { filaClick, FILA_CLICK } from '../utils/filaClick'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)

const emptyForm = { name: '', description: '', price: '', disponible: true, categoryId: '', controlaInventario: false }

/**
 * Página "Menú": administración de categorías y platillos/productos de la tienda.
 * El control de stock (opcional, pensado para un futuro módulo de insumos) sigue
 * disponible vía "Ajustar stock", pero no es obligatorio para operar un menú normal
 * (por eso "Disponible" — 86'd temporal — es el campo relevante del día a día, no el stock).
 */
export default function Menu() {
  const { isAdmin } = useAuth()
  const { notify, confirmDialog } = useNotify()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [adjustModal, setAdjustModal] = useState(null)
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // { campo: mensaje } — igual formato que GlobalExceptionHandler manda para @Valid (ver
  // ProductRequest en el backend), se muestran justo debajo de su input.
  const [fieldErrors, setFieldErrors] = useState({})
  // La foto se elige junto con el resto del formulario (disponible desde "Nuevo platillo", no
  // solo después de guardar) pero se sube aparte (multipart) DENTRO de handleSave, como parte
  // de la misma acción de "Guardar" — nunca un segundo paso independiente.
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('') // object URL del archivo recién elegido
  const [photoCleared, setPhotoCleared] = useState(false) // "Quitar foto" sin elegir una nueva

  // Modificadores: modModal = producto cuyos grupos se están administrando (lista, primer
  // nivel); modGrupoForm = formulario de alta/edición de UN grupo, apilado encima del anterior
  // — mismo patrón de modales encimados que el selector de modificadores en OrderDetail.
  const [modModal, setModModal] = useState(null)
  const [modGrupos, setModGrupos] = useState([])
  const [modGrupoForm, setModGrupoForm] = useState(null)
  const [modLoading, setModLoading] = useState(false)
  const [modError, setModError] = useState('')
  // Mismos topes que ModificadorGrupoRequest/ModificadorOpcionRequest en el backend (nombre
  // VARCHAR(100), precioExtra requerido y no negativo).
  const [modNombreError, setModNombreError] = useState('')
  const [modOpcionErrors, setModOpcionErrors] = useState([]) // paralelo a modGrupoForm.opciones
  // Copiar grupos ya armados de otros productos de la misma categoría — apilado sobre modModal,
  // igual que modGrupoForm. Copia siempre independiente (ver ModificadorGrupoService): editar
  // uno después no afecta al otro. Dos niveles para no crecer sin límite con muchos productos:
  // primero los productos (modCopyProduct null), luego los grupos DE ese producto — la
  // selección (modCopySelected) es acumulable entre productos, para copiar varios de un jalón.
  const [modCopyModal, setModCopyModal] = useState(false)
  const [modCopiables, setModCopiables] = useState([])
  const [modCopyProduct, setModCopyProduct] = useState(null) // nombre del producto elegido, o null
  const [modCopySelected, setModCopySelected] = useState(() => new Set()) // ids de grupos marcados
  const [modCopyExpanded, setModCopyExpanded] = useState(() => new Set()) // ids con sus opciones visibles
  const [modCopyLoading, setModCopyLoading] = useState(false)

  function load() {
    getProducts().then((r) => setProducts(r.data.data ?? []))
    getCategories().then((r) => setCategories(r.data.data ?? []))
  }

  useEffect(() => { load() }, [])

  // Cierra con ESC el modal que esté abierto (platillo, ajuste de stock, o modificadores),
  // descartando lo capturado — mismo efecto que "Cancelar"/"Cerrar". El formulario de grupo
  // (modGrupoForm) va primero: está apilado encima de la lista de grupos (modModal).
  useEscapeKey(() => {
    if (modGrupoForm) setModGrupoForm(null)
    else if (modCopyModal) { if (modCopyProduct) setModCopyProduct(null); else closeCopyModal() }
    else if (modModal) closeModModal()
    else if (showModal) closeProductModal()
    else if (adjustModal) setAdjustModal(null)
  }, !!(showModal || adjustModal || modModal || modGrupoForm || modCopyModal))

  const filtered = products.filter((p) => {
    const q = search.toLowerCase()
    const matchQ = !q || p.name?.toLowerCase().includes(q)
    const matchC = !filterCat || String(p.category?.id) === filterCat
    return matchQ && matchC
  })

  function openNew() {
    setEditProduct(null)
    setForm(emptyForm)
    setError('')
    setFieldErrors({})
    setPhotoFile(null)
    setPhotoPreview('')
    setPhotoCleared(false)
    setShowModal(true)
  }

  function openEdit(p) {
    setEditProduct(p)
    setForm({
      name: p.name, description: p.description ?? '', price: p.price,
      disponible: p.disponible !== false, categoryId: p.category?.id ?? '',
      controlaInventario: !!p.controlaInventario,
    })
    setError('')
    setFieldErrors({})
    setPhotoFile(null)
    setPhotoPreview('')
    setPhotoCleared(false)
    setShowModal(true)
  }

  /** Cierra el modal de platillo y libera el object URL de la vista previa, si había una. */
  function closeProductModal() {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setShowModal(false)
  }

  function handlePhotoPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('La imagen debe ser PNG, JPG o WEBP', 'error')
      e.target.value = ''
      return
    }
    // Mismo tope que ProductImageService en el backend (3 MB) — se revisa aquí antes de
    // guardar para avisar de inmediato en vez de esperar el viaje redondo al servidor.
    if (file.size > 3 * 1024 * 1024) {
      notify('La imagen no debe pesar más de 3 MB', 'error')
      e.target.value = ''
      return
    }
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(file)
    setPhotoCleared(false)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function handlePhotoClear() {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(null)
    setPhotoPreview('')
    setPhotoCleared(true)
  }

  // Mismos topes que ProductRequest en el backend (name VARCHAR(200), description tope de app
  // 50) — se valida aquí antes de pedir el guardado, para no viajar al servidor solo para que
  // lo rechace, y sin `required` nativo (el globo del navegador se disparaba antes de que este
  // formulario alcanzara a correr — mismo caso ya resuelto en Categorías/Zonas).
  function validateProductForm() {
    const errors = {}
    if (!form.name.trim()) errors.name = 'El nombre es obligatorio'
    else if (form.name.length > 200) errors.name = 'El nombre no puede tener más de 200 caracteres'
    if (form.description && form.description.length > 50) errors.description = 'La descripción no puede tener más de 50 caracteres'
    if (form.price === '' || form.price === null) errors.price = 'El precio es obligatorio'
    else if (Number(form.price) < 0) errors.price = 'El precio no puede ser negativo'
    if (!form.categoryId) errors.categoryId = 'Selecciona una categoría'
    return errors
  }

  async function handleSave(e) {
    e.preventDefault()
    const validationErrors = validateProductForm()
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors)
      setError('')
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    const wasEditing = !!editProduct
    setLoading(true)
    setError('')
    setFieldErrors({})
    try {
      const payload = { ...form, price: Number(form.price), categoryId: Number(form.categoryId) }
      const res = wasEditing ? await updateProduct(editProduct.id, payload) : await createProduct(payload)
      let saved = res.data.data

      // La foto es multipart (no cabe en el mismo POST/PUT de arriba) pero se aplica en la
      // MISMA acción de "Guardar", para que elegir/quitar la foto y guardar el platillo se
      // sientan como un solo paso — nunca un segundo clic aparte. Si esto falla, el platillo
      // ya quedó guardado: se avisa por separado en vez de perder los datos ya capturados.
      try {
        if (photoFile) {
          const imgRes = await uploadProductImage(saved.id, photoFile)
          saved = imgRes.data.data
        } else if (photoCleared && editProduct?.imageUrl) {
          const imgRes = await removeProductImage(saved.id)
          saved = imgRes.data.data
        }
      } catch (photoErr) {
        notify(photoErr.response?.data?.message ?? 'El platillo se guardó, pero no se pudo actualizar la foto', 'error')
      }

      closeProductModal()
      load()
      notify(wasEditing ? 'Platillo actualizado' : 'Platillo creado', 'success')
    } catch (err) {
      // Errores de validación (@Valid, ver GlobalExceptionHandler en el backend) traen
      // { campo: mensaje } en `data` — se reparten a fieldErrors para mostrarse justo debajo
      // de cada input, igual que Categorías/Zonas.
      const data = err.response?.data?.data
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        setFieldErrors(data)
        setError('')
      } else {
        setFieldErrors({})
        setError(err.response?.data?.message ?? 'Error al guardar')
      }
    } finally {
      setLoading(false)
    }
  }

  async function toggleDisponible(p) {
    try {
      await updateProduct(p.id, { name: p.name, description: p.description, price: p.price,
        disponible: !p.disponible, categoryId: p.category?.id })
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'Error')
    }
  }


  const adjustQtyNum = Math.abs(Number(adjustQty) || 0)

  async function handleAdjust(e, direction) {
    e.preventDefault()
    if (adjustQtyNum === 0) return
    setLoading(true)
    try {
      await adjustStock(adjustModal.id, { quantity: direction === 'OUT' ? -adjustQtyNum : adjustQtyNum, reason: adjustReason })
      setAdjustModal(null)
      setAdjustQty('')
      setAdjustReason('')
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'Error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(p) {
    if (!(await confirmDialog(`¿Desactivar "${p.name}"?`, { confirmText: 'Desactivar' }))) return
    await deleteProduct(p.id)
    load()
  }

  // ── Modificadores ──────────────────────────────────────────────────
  function openModModal(p) {
    setModModal(p)
    getModificadorGrupos(p.id).then((r) => setModGrupos(r.data.data ?? []))
  }
  function closeModModal() {
    setModModal(null)
    setModGrupos([])
  }
  function reloadModGrupos() {
    if (modModal) getModificadorGrupos(modModal.id).then((r) => setModGrupos(r.data.data ?? []))
  }

  /** Sube (-1) o baja (+1) un grupo y guarda el nuevo orden al momento; si falla, recarga el real. */
  async function moveGrupo(idx, dir) {
    const to = idx + dir
    if (to < 0 || to >= modGrupos.length) return
    const next = [...modGrupos]
    ;[next[idx], next[to]] = [next[to], next[idx]]
    setModGrupos(next)
    try {
      await reorderModificadorGrupos(modModal.id, next.map((g) => g.id))
      load() // la toma de órdenes lee los grupos desde products
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo guardar el orden', 'error')
      reloadModGrupos()
    }
  }

  function openCopyModal() {
    setModCopiables([])
    setModCopyProduct(null)
    setModCopySelected(new Set())
    setModCopyExpanded(new Set())
    setModCopyModal(true)
    getModificadorGruposCopiables(modModal.id).then((r) => setModCopiables(r.data.data ?? []))
  }
  function closeCopyModal() {
    setModCopyModal(false)
    setModCopiables([])
    setModCopyProduct(null)
  }

  function toggleCopySelected(id) {
    setModCopySelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleCopyExpanded(id) {
    setModCopyExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Productos con al menos un grupo copiable, agrupados — para no mostrar de un jalón todos
  // los grupos de toda la categoría, sino elegir primero el platillo y luego sus grupos.
  const modCopiablesPorProducto = modCopiables.reduce((acc, g) => {
    (acc[g.productoNombre] ??= []).push(g)
    return acc
  }, {})

  /** Copia TODOS los grupos marcados (de uno o varios productos) a este producto de un jalón —
   *  cada copia queda independiente desde que se crea: editarla después no afecta al original. */
  async function handleCopySelected() {
    const grupos = modCopiables.filter((g) => modCopySelected.has(g.id))
    if (grupos.length === 0) return
    setModCopyLoading(true)
    try {
      for (const g of grupos) {
        const payload = {
          nombre: g.nombre,
          tipo: g.tipo,
          obligatorio: g.obligatorio,
          opciones: (g.opciones ?? []).filter((o) => o.isActive !== false)
            .map((o) => ({ nombre: o.nombre, precioExtra: o.precioExtra })),
        }
        await createModificadorGrupo(modModal.id, payload)
      }
      closeCopyModal()
      reloadModGrupos()
      load()
      notify(`${grupos.length} grupo${grupos.length === 1 ? '' : 's'} copiado${grupos.length === 1 ? '' : 's'}`, 'success')
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo copiar', 'error')
    } finally {
      setModCopyLoading(false)
    }
  }

  function openNewGrupo() {
    setModError('')
    setModNombreError('')
    setModOpcionErrors([])
    setModGrupoForm({
      id: null, nombre: '', tipo: 'UNICO', obligatorio: false,
      opciones: [{ id: null, nombre: '', precioExtra: '' }],
    })
  }
  function openEditGrupo(g) {
    setModError('')
    setModNombreError('')
    setModOpcionErrors([])
    setModGrupoForm({
      id: g.id, nombre: g.nombre, tipo: g.tipo, obligatorio: g.obligatorio,
      opciones: (g.opciones ?? []).filter((o) => o.isActive !== false)
        .map((o) => ({ id: o.id, nombre: o.nombre, precioExtra: o.precioExtra })),
    })
  }

  function addOpcionRow() {
    setModGrupoForm((f) => ({ ...f, opciones: [...f.opciones, { id: null, nombre: '', precioExtra: '' }] }))
    setModOpcionErrors((errs) => [...errs, ''])
  }
  function removeOpcionRow(idx) {
    setModGrupoForm((f) => ({ ...f, opciones: f.opciones.filter((_, i) => i !== idx) }))
    setModOpcionErrors((errs) => errs.filter((_, i) => i !== idx))
  }
  /** Sube (-1) o baja (+1) una opción del formulario; el orden se guarda al dar "Guardar". */
  function moveOpcionRow(idx, dir) {
    const to = idx + dir
    const swap = (arr) => {
      if (to < 0 || to >= arr.length) return arr
      const next = [...arr]
      ;[next[idx], next[to]] = [next[to], next[idx]]
      return next
    }
    setModGrupoForm((f) => ({ ...f, opciones: swap(f.opciones) }))
    setModOpcionErrors(swap)
  }
  function updateOpcionField(idx, field, value) {
    setModGrupoForm((f) => ({ ...f, opciones: f.opciones.map((o, i) => (i === idx ? { ...o, [field]: value } : o)) }))
  }

  // Mismos topes que ModificadorGrupoRequest/ModificadorOpcionRequest en el backend: nombre
  // obligatorio (máx. 100 caracteres) para el grupo y cada opción. precioExtra NO es
  // obligatorio: en blanco se manda como $0 (ver handleSaveGrupo) — solo se marca error si
  // capturaron algo y es negativo. También replica las dos validaciones de nombres repetidos
  // que hace ModificadorGrupoService (grupo vs. otros grupos del mismo platillo, opción vs.
  // otra opción del mismo grupo) para avisar antes del viaje redondo al servidor — el backend
  // sigue siendo quien de verdad decide.
  function validateModGrupoForm() {
    let nombreError = !modGrupoForm.nombre.trim() ? 'El nombre es obligatorio'
      : modGrupoForm.nombre.length > 100 ? 'El nombre no puede tener más de 100 caracteres' : ''
    if (!nombreError) {
      const chocaConOtroGrupo = modGrupos.some((g) =>
        g.id !== modGrupoForm.id && g.nombre.trim().toLowerCase() === modGrupoForm.nombre.trim().toLowerCase())
      if (chocaConOtroGrupo) nombreError = 'Ya existe un grupo con este nombre en este platillo'
    }
    const nombresVistos = new Set()
    const opcionErrors = modGrupoForm.opciones.map((o) => {
      if (!o.nombre.trim()) return 'El nombre es obligatorio'
      if (o.nombre.length > 100) return 'Máximo 100 caracteres'
      if (o.precioExtra !== '' && Number(o.precioExtra) < 0) return 'No puede ser negativo'
      const clave = o.nombre.trim().toLowerCase()
      if (nombresVistos.has(clave)) return 'Nombre repetido en este grupo'
      nombresVistos.add(clave)
      return ''
    })
    return { nombreError, opcionErrors }
  }

  async function handleSaveGrupo(e) {
    e.preventDefault()
    const { nombreError, opcionErrors } = validateModGrupoForm()
    setModNombreError(nombreError)
    setModOpcionErrors(opcionErrors)
    if (nombreError || opcionErrors.some((msg) => msg)) {
      setModError('')
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    setModLoading(true)
    setModError('')
    try {
      const payload = {
        nombre: modGrupoForm.nombre.trim(),
        tipo: modGrupoForm.tipo,
        obligatorio: modGrupoForm.obligatorio,
        opciones: modGrupoForm.opciones.map((o) => ({
          id: o.id ?? undefined,
          nombre: o.nombre.trim(),
          precioExtra: o.precioExtra === '' ? 0 : Number(o.precioExtra),
        })),
      }
      if (modGrupoForm.id) await updateModificadorGrupo(modGrupoForm.id, payload)
      else await createModificadorGrupo(modModal.id, payload)
      setModGrupoForm(null)
      reloadModGrupos()
      load() // refresca products (incluye modificadorGrupos) para que la toma de órdenes lo vea al toque
      notify(modGrupoForm.id ? 'Grupo actualizado' : 'Grupo creado', 'success')
    } catch (err) {
      setModError(err.response?.data?.message ?? 'Error al guardar')
    } finally {
      setModLoading(false)
    }
  }

  async function handleDeleteGrupo(g) {
    if (!(await confirmDialog(`¿Eliminar el grupo "${g.nombre}"?`, { confirmText: 'Eliminar', danger: true }))) return
    try {
      await deleteModificadorGrupo(g.id)
      reloadModGrupos()
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo eliminar')
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="flex-1 text-[28px] font-extrabold tracking-tight text-gray-900">Menú</h1>
        <Link to="/menu-imprimible" className="btn-secondary inline-flex items-center gap-2">🖨️ Menú imprimible con QR</Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex flex-wrap gap-3">
          <input className="input sm:max-w-xs" placeholder="Buscar platillo..." value={search}
            onChange={(e) => setSearch(e.target.value)} />
          <select className="input sm:max-w-xs" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {isAdmin && <button className="btn-primary" onClick={openNew}>+ Nuevo platillo</button>}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Platillo', 'Categoría', 'Precio', 'Disponible', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((p) => (
              <tr key={p.id} {...filaClick(isAdmin ? () => openEdit(p) : null)} className={`${isAdmin ? FILA_CLICK : ''} hover:bg-gray-50`}>
                <td className="px-4 py-3 font-medium text-gray-900">
                  <div className="flex items-center gap-2">
                    {p.imageUrl && <img src={resolveMediaUrl(p.imageUrl)} alt="" className="w-8 h-8 rounded object-cover" />}
                    {p.name}
                    {p.controlaInventario && (
                      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${p.stock <= 0 ? 'bg-red-50 text-red-700' : 'bg-[#E6EDF8] text-[#1E4585]'}`}
                        title="Se descuenta al venderse. En 0 no se puede vender y en la página web sale No disponible">
                        {p.stock <= 0 ? 'Sin inventario' : `Inventario · quedan ${p.stock}`}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-500">{p.category?.name}</td>
                <td className="px-4 py-3 text-gray-700">{fmt(p.price)}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleDisponible(p)}
                    className={`text-xs font-semibold px-2 py-1 rounded-full ${p.disponible !== false ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                    {p.disponible !== false ? 'Sí' : 'No'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 justify-end">
                    {isAdmin && (
                      <button className="text-blue-600 hover:underline text-xs" onClick={() => openEdit(p)}>Editar</button>
                    )}
                    {isAdmin && (
                      <button className="text-purple-600 hover:underline text-xs" onClick={() => openModModal(p)}>Modif.</button>
                    )}
                    <button className="text-purple-600 hover:underline text-xs"
                      onClick={() => { setAdjustModal(p); setAdjustQty(''); setAdjustReason('') }}>Stock</button>
                    {isAdmin && (
                      <button className="text-red-500 hover:underline text-xs" onClick={() => handleDelete(p)}>Desact.</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin platillos</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Product modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeProductModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{editProduct ? 'Editar platillo' : 'Nuevo platillo'}</h3>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Nombre <span className={fieldErrors.name ? 'text-red-600' : ''}>*</span></label>
                  <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  {fieldErrors.name && <p className="text-red-600 text-xs mt-1">{fieldErrors.name}</p>}</div>
                <div><label className="text-xs font-medium text-gray-600">Precio <span className={fieldErrors.price ? 'text-red-600' : ''}>*</span></label>
                  <input className="input" type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                  {fieldErrors.price && <p className="text-red-600 text-xs mt-1">{fieldErrors.price}</p>}</div>
                <div><label className="text-xs font-medium text-gray-600">Categoría <span className={fieldErrors.categoryId ? 'text-red-600' : ''}>*</span></label>
                  <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    {/* Categoría legada/desactivada que ya no aparece en el catálogo activo:
                        se muestra tal cual para que el <select> siempre tenga una opción que
                        coincida con form.categoryId — nunca bloquea el guardado en silencio. */}
                    {form.categoryId && !categories.some((c) => String(c.id) === String(form.categoryId)) && (
                      <option value={form.categoryId}>{editProduct?.category?.name ?? 'Categoría desactivada'}</option>
                    )}
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {fieldErrors.categoryId && <p className="text-red-600 text-xs mt-1">{fieldErrors.categoryId}</p>}</div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                {fieldErrors.description && <p className="text-red-600 text-xs mt-1">{fieldErrors.description}</p>}</div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.disponible} onChange={(e) => setForm({ ...form, disponible: e.target.checked })} />
                Disponible para pedirse
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="mt-1" checked={!!form.controlaInventario} onChange={(e) => setForm({ ...form, controlaInventario: e.target.checked })} />
                <span>
                  <span className="block text-sm text-gray-700">Lleva inventario</span>
                  <span className="block text-xs text-gray-500">Para lo que se compra y se cuenta (refrescos, cervezas). Solo estos aparecen en Inventario y en las alertas de stock bajo.</span>
                </span>
              </label>

              {/* Disponible desde "Nuevo platillo" (no solo al editar): la foto se elige aquí
                  junto con el resto, y se sube como parte de la misma acción de "Guardar"
                  (ver handleSave) — nunca un segundo paso aparte. */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Foto</label>
                <div className="flex items-center gap-3">
                  {photoPreview ? (
                    <img src={photoPreview} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
                  ) : (!photoCleared && editProduct?.imageUrl) ? (
                    <img src={resolveMediaUrl(editProduct.imageUrl)} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-2xl">🍽️</div>
                  )}
                  <div className="flex flex-col gap-1">
                    <label className="btn-secondary text-xs cursor-pointer text-center">
                      {photoFile || (!photoCleared && editProduct?.imageUrl) ? 'Cambiar foto' : 'Subir foto'}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handlePhotoPick} />
                    </label>
                    {(photoFile || (!photoCleared && editProduct?.imageUrl)) && (
                      <button type="button" className="text-xs text-red-600 hover:underline" onClick={handlePhotoClear}>Quitar foto</button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">PNG, JPG o WEBP, máximo 3 MB.</p>
              </div>

              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={closeProductModal}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust stock modal (opcional, futuro control de insumos) */}
      {adjustModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setAdjustModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Ajustar stock</h3>
            <p className="text-sm text-gray-500 mb-4">{adjustModal.name} — actual: {adjustModal.stock} {adjustModal.unit}</p>
            <form className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Cantidad</label>
                <input className="input" type="number" min="1" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Motivo</label>
                <input className="input" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setAdjustModal(null)}>Cerrar</button>
                <button type="button" className="btn-secondary" disabled={loading || adjustQtyNum === 0} onClick={(e) => handleAdjust(e, 'OUT')}>− Salida</button>
                <button type="button" className="btn-primary" disabled={loading || adjustQtyNum === 0} onClick={(e) => handleAdjust(e, 'IN')}>+ Entrada</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modificadores del producto: grupos (ej. "Término de cocción", "Extras") — ver
          ModificadorGrupoController en el backend. */}
      {modModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeModModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold">Modificadores</h3>
              <button className="text-gray-400 hover:text-gray-600" onClick={closeModModal}>✕</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{modModal.name}</p>

            <div className="space-y-3">
              {modGrupos.map((g, idx) => (
                <div key={g.id} className="border border-gray-100 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-2">
                    {modGrupos.length > 1 && (
                      <div className="flex flex-col shrink-0 -my-1">
                        <button type="button" title="Subir grupo" disabled={idx === 0} onClick={() => moveGrupo(idx, -1)}
                          className="w-6 h-6 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent">▲</button>
                        <button type="button" title="Bajar grupo" disabled={idx === modGrupos.length - 1} onClick={() => moveGrupo(idx, 1)}
                          className="w-6 h-6 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent">▼</button>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800">{g.nombre}</p>
                      <div className="flex gap-1.5 mt-1.5">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
                          {g.tipo === 'UNICO' ? 'Selección única' : 'Selección múltiple'}
                        </span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${g.obligatorio ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                          {g.obligatorio ? 'Obligatorio' : 'Opcional'}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button className="text-blue-600 hover:underline text-xs" onClick={() => openEditGrupo(g)}>Editar</button>
                      <button className="text-red-500 hover:underline text-xs" onClick={() => handleDeleteGrupo(g)}>Eliminar</button>
                    </div>
                  </div>
                  <ul className="mt-3 space-y-1">
                    {(g.opciones ?? []).filter((o) => o.isActive !== false).map((o) => (
                      <li key={o.id} className="flex items-center justify-between text-sm text-gray-700">
                        <span>{o.nombre}</span>
                        <span className="text-gray-500">{Number(o.precioExtra) > 0 ? `+${fmt(o.precioExtra)}` : '$0.00'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {modGrupos.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-6">Este platillo todavía no tiene modificadores</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="py-3 rounded-lg border-2 border-dashed border-purple-200 text-purple-600 text-sm font-semibold hover:bg-purple-50" onClick={openNewGrupo}>
                  + Nuevo grupo
                </button>
                <button type="button" className="py-3 rounded-lg border-2 border-dashed border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50" onClick={openCopyModal}>
                  📋 Copiar de otro producto
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alta/edición de un grupo de modificadores — apilado sobre el modal de arriba. */}
      {modGrupoForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={() => setModGrupoForm(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{modGrupoForm.id ? 'Editar grupo' : 'Nuevo grupo de modificadores'}</h3>
            <form onSubmit={handleSaveGrupo} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre <span className={modNombreError ? 'text-red-600' : ''}>*</span></label>
                <input className="input" placeholder='Ej. "Término de cocción"' value={modGrupoForm.nombre}
                  onChange={(e) => setModGrupoForm((f) => ({ ...f, nombre: e.target.value }))} />
                {modNombreError && <p className="text-red-600 text-xs mt-1">{modNombreError}</p>}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button type="button"
                  className={`py-2 rounded-lg text-xs font-semibold border ${modGrupoForm.tipo === 'UNICO' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200'}`}
                  onClick={() => setModGrupoForm((f) => ({ ...f, tipo: 'UNICO' }))}
                >Selección única</button>
                <button type="button"
                  className={`py-2 rounded-lg text-xs font-semibold border ${modGrupoForm.tipo === 'MULTIPLE' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200'}`}
                  onClick={() => setModGrupoForm((f) => ({ ...f, tipo: 'MULTIPLE' }))}
                >Selección múltiple</button>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={modGrupoForm.obligatorio}
                  onChange={(e) => setModGrupoForm((f) => ({ ...f, obligatorio: e.target.checked }))} />
                Obligatorio elegir algo de este grupo
              </label>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Opciones *</label>
                <div className="space-y-2">
                  {modGrupoForm.opciones.map((o, idx) => (
                    <div key={idx}>
                      <div className="flex items-center gap-2">
                        {modGrupoForm.opciones.length > 1 && (
                          <div className="flex flex-col shrink-0">
                            <button type="button" title="Subir opción" disabled={idx === 0} onClick={() => moveOpcionRow(idx, -1)}
                              className="w-5 h-4 text-[10px] leading-none text-gray-400 hover:text-gray-700 disabled:opacity-30">▲</button>
                            <button type="button" title="Bajar opción" disabled={idx === modGrupoForm.opciones.length - 1} onClick={() => moveOpcionRow(idx, 1)}
                              className="w-5 h-4 text-[10px] leading-none text-gray-400 hover:text-gray-700 disabled:opacity-30">▼</button>
                          </div>
                        )}
                        <input className="input flex-1" placeholder="Nombre de la opción" value={o.nombre}
                          onChange={(e) => updateOpcionField(idx, 'nombre', e.target.value)} />
                        <input className="input !w-24" type="number" min="0" step="0.01" placeholder="0.00" value={o.precioExtra}
                          onChange={(e) => updateOpcionField(idx, 'precioExtra', e.target.value)} />
                        <button type="button" title="Quitar opción"
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-gray-100 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          onClick={() => removeOpcionRow(idx)} disabled={modGrupoForm.opciones.length <= 1}
                        >✕</button>
                      </div>
                      {modOpcionErrors[idx] && <p className="text-red-600 text-xs mt-1">{modOpcionErrors[idx]}</p>}
                    </div>
                  ))}
                </div>
                <button type="button" className="text-xs font-semibold text-purple-600 hover:underline mt-2" onClick={addOpcionRow}>+ Agregar opción</button>
              </div>

              {modError && <p className="text-red-600 text-sm">{modError}</p>}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setModGrupoForm(null)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={modLoading}>{modLoading ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Copiar grupos ya armados de otros productos de la misma categoría — apilado sobre el
          modal de arriba. Primero el producto, luego sus grupos (con sus opciones desplegables),
          para no mostrar de un jalón todos los grupos de toda la categoría. La selección se
          acumula entre productos: "Copiar seleccionados" copia todos de un jalón. Cada copia
          queda independiente (ver ModificadorGrupoService). */}
      {modCopyModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={closeCopyModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 pb-4 border-b border-gray-100">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  {modCopyProduct && (
                    <button type="button" className="text-gray-400 hover:text-gray-600" title="Regresar a productos" onClick={() => setModCopyProduct(null)}>‹</button>
                  )}
                  {modCopyProduct ?? 'Copiar de otro producto'}
                </h3>
                <button className="text-gray-400 hover:text-gray-600" onClick={closeCopyModal}>✕</button>
              </div>
              <p className="text-sm text-gray-500">
                {modCopyProduct
                  ? 'Marca los grupos que quieras copiar a este platillo'
                  : `Platillos de la categoría "${modModal?.category?.name ?? '—'}" con modificadores`}
              </p>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-2">
              {!modCopyProduct ? (
                Object.keys(modCopiablesPorProducto).length > 0 ? (
                  Object.entries(modCopiablesPorProducto).map(([prodName, grupos]) => {
                    const seleccionados = grupos.filter((g) => modCopySelected.has(g.id)).length
                    return (
                      <button key={prodName} type="button"
                        className="w-full text-left border border-gray-100 rounded-lg p-3 hover:border-purple-300 hover:bg-purple-50 flex items-center justify-between gap-2"
                        onClick={() => setModCopyProduct(prodName)}
                      >
                        <span className="font-semibold text-gray-800 text-sm">{prodName}</span>
                        <span className="text-xs text-gray-400 shrink-0">
                          {seleccionados > 0 && <span className="text-purple-600 font-semibold">{seleccionados} marcado{seleccionados === 1 ? '' : 's'} · </span>}
                          {grupos.length} grupo{grupos.length === 1 ? '' : 's'} ›
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <p className="text-gray-400 text-sm text-center py-6">No hay grupos de modificadores en otros platillos de esta categoría</p>
                )
              ) : (
                (modCopiablesPorProducto[modCopyProduct] ?? []).map((g) => {
                  const expanded = modCopyExpanded.has(g.id)
                  const selected = modCopySelected.has(g.id)
                  const opciones = (g.opciones ?? []).filter((o) => o.isActive !== false)
                  return (
                    <div key={g.id} className={`border rounded-lg p-3 ${selected ? 'border-purple-400 bg-purple-50' : 'border-gray-100'}`}>
                      <div className="flex items-start gap-2">
                        <input type="checkbox" className="mt-1" checked={selected} onChange={() => toggleCopySelected(g.id)} />
                        <label className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleCopySelected(g.id)}>
                          <p className="font-semibold text-gray-800 text-sm">{g.nombre}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {g.tipo === 'UNICO' ? 'Selección única' : 'Selección múltiple'}
                            {g.obligatorio ? ' · Obligatorio' : ''}
                            {' · '}{opciones.length} opciones
                          </p>
                        </label>
                        <button type="button" className="text-xs text-purple-600 hover:underline shrink-0"
                          onClick={() => toggleCopyExpanded(g.id)}>{expanded ? 'Ocultar' : 'Ver'}</button>
                      </div>
                      {expanded && (
                        <ul className="mt-2 pl-6 space-y-1 border-t border-gray-100 pt-2">
                          {opciones.map((o) => (
                            <li key={o.id} className="flex items-center justify-between text-xs text-gray-600">
                              <span>{o.nombre}</span>
                              <span>{Number(o.precioExtra) > 0 ? `+${fmt(o.precioExtra)}` : '$0.00'}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            <div className="p-6 pt-4 border-t border-gray-100 flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={closeCopyModal}>Cancelar</button>
              <button type="button" className="btn-primary" disabled={modCopyLoading || modCopySelected.size === 0} onClick={handleCopySelected}>
                {modCopyLoading ? 'Copiando...' : `Copiar seleccionados${modCopySelected.size > 0 ? ` (${modCopySelected.size})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
