import { useEffect, useState } from 'react'
import { getCategories, createCategory, updateCategory, deleteCategory, updateCategoryAvailabilityMode } from '../api/categories'
import { useNotify } from '../context/NotifyContext'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { filaClick, FILA_CLICK } from '../utils/filaClick'

const emptyForm = { name: '', description: '', scheduleStart: '', scheduleEnd: '' }

const MODE_LABEL = { AUTO: 'Automático', FORCE_VISIBLE: 'Visible', FORCE_HIDDEN: 'Oculto' }
// "HH:mm:ss" (lo que manda el backend) -> "HH:mm" (lo que espera <input type="time">).
const toInputTime = (t) => (t ? t.slice(0, 5) : '')

/**
 * Pantalla "Categorías": CRUD de las categorías de producto de la tienda del usuario en
 * sesión, movida aquí (dentro de "Configuración") desde donde antes vivía embebida en la
 * pantalla de Menú, para que administrar el catálogo de categorías no dependa de estar
 * parado en la pantalla de platillos. Reservada al ADMIN de la tienda (ruta `adminOnly`,
 * igual que Apariencia y Datos de la tienda).
 */
export default function Categories() {
  const { notify, confirmDialog } = useNotify()
  const [categories, setCategories] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editCategory, setEditCategory] = useState(null)
  const [form, setForm] = useState(emptyForm)
  // Error general del modal de categoría (reglas de negocio sin campo asociado, o
  // cualquier fallo que no venga de @Valid).
  const [error, setError] = useState('')
  // Errores de validación por campo, { nombreDelCampo: mensaje } — mismo formato que
  // GlobalExceptionHandler ya manda para @Valid (ver CategoryRequest en el backend). Se
  // muestran justo debajo de su input y ponen en rojo el asterisco de "obligatorio".
  const [fieldErrors, setFieldErrors] = useState({})
  const [loading, setLoading] = useState(false)

  function load() {
    getCategories().then((r) => setCategories(r.data.data ?? []))
  }

  useEffect(() => { load() }, [])

  // Cierra con ESC el modal de categoría (mismo efecto que "Cancelar"), descartando lo capturado.
  useEscapeKey(() => {
    setShowModal(false)
  }, !!showModal)

  /** Abre el modal en blanco para crear una categoría nueva. */
  function openNew() {
    setEditCategory(null)
    setForm(emptyForm)
    setError('')
    setFieldErrors({})
    setShowModal(true)
  }

  /** Abre el modal precargado con los datos de la categoría a editar. */
  function openEdit(c) {
    setEditCategory(c)
    setForm({
      name: c.name, description: c.description ?? '',
      scheduleStart: toInputTime(c.scheduleStart), scheduleEnd: toInputTime(c.scheduleEnd),
    })
    setError('')
    setFieldErrors({})
    setShowModal(true)
  }

  /**
   * Cambia el modo de disponibilidad de una categoría directamente desde la tabla (sin abrir
   * el modal de edición completo) — mismo endpoint ligero que puede usar un mesero desde
   * Órdenes/Para llevar, aquí expuesto también para el ADMIN por conveniencia.
   */
  async function handleModeChange(c, mode) {
    try {
      const updated = (await updateCategoryAvailabilityMode(c.id, mode)).data.data
      setCategories((prev) => prev.map((x) => (x.id === c.id ? updated : x)))
      notify('Disponibilidad actualizada', 'success')
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo actualizar la disponibilidad', 'error')
    }
  }

  /**
   * Valida el formulario de categoría del lado del cliente, replicando el límite que ya
   * exige `CategoryRequest` en el backend (mismo texto de mensaje) — para detectar el error
   * ANTES de pedir confirmación de guardado (ver `handleSave`), en vez de hasta después del
   * viaje redondo al servidor. Sin `required` nativo en Nombre (ver el JSX del modal) — ese
   * globo del navegador se disparaba antes de que este formulario alcanzara a correr.
   *
   * @returns {{[field: string]: string}} vacío si el formulario es válido
   */
  function validateCategoryForm() {
    const errors = {}
    if (!form.name.trim()) errors.name = 'El nombre es obligatorio'
    else if (form.name.length > 100) errors.name = 'El nombre no puede tener más de 100 caracteres'
    if (form.description.length > 200) errors.description = 'La descripción no puede tener más de 200 caracteres'
    if (!!form.scheduleStart !== !!form.scheduleEnd) {
      errors.scheduleStart = 'El horario necesita hora de inicio y de fin, o ninguna de las dos'
    }
    return errors
  }

  // Crea o actualiza la categoría según haya o no un `editCategory` en edición (previa
  // confirmación explícita), y recarga el listado. La validación local corre ANTES de
  // pedir esa confirmación: no tiene sentido preguntar "¿deseas crear/guardar?" si el
  // backend lo va a rechazar de todas formas.
  async function handleSave(e) {
    e.preventDefault()
    const validationErrors = validateCategoryForm()
    if (Object.keys(validationErrors).length > 0) {
      // Advertencia de validación local, NO el mismo mensaje que un fallo real del
      // backend (ver el catch de abajo) — aquí todavía no se intentó guardar nada.
      setFieldErrors(validationErrors)
      setError('')
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    const confirmMsg = editCategory
      ? `¿Deseas guardar los cambios de "${form.name}"?`
      : `¿Deseas crear la categoría "${form.name}"?`
    if (!(await confirmDialog(confirmMsg, { confirmText: editCategory ? 'Guardar cambios' : 'Crear', danger: false }))) return
    setLoading(true)
    setError('')
    setFieldErrors({})
    try {
      const payload = { ...form, scheduleStart: form.scheduleStart || null, scheduleEnd: form.scheduleEnd || null }
      if (editCategory) await updateCategory(editCategory.id, payload)
      else await createCategory(payload)
      setShowModal(false)
      load()
      notify(editCategory ? 'Categoría editada correctamente' : 'Categoría agregada correctamente', 'success')
    } catch (err) {
      // Errores de validación (@Valid, ver GlobalExceptionHandler en el backend) traen
      // { campo: mensaje } en `data` — se reparten a `fieldErrors` para mostrarse justo
      // debajo de cada input. Cualquier otro tipo de error va al mensaje general.
      const data = err.response?.data?.data
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        setFieldErrors(data)
        setError('')
      } else {
        setFieldErrors({})
        setError(err.response?.data?.message ?? 'Error al guardar')
      }
      notify(editCategory ? 'Error al guardar la categoría' : 'Error al registrar la categoría', 'error')
    } finally { setLoading(false) }
  }

  /**
   * Elimina una categoría tras confirmación explícita. Cualquier error del backend (ej.
   * la categoría sigue teniendo productos asignados) se muestra como notificación en vez
   * de bloquear la UI.
   */
  async function handleDelete(c) {
    if (!(await confirmDialog(`¿Eliminar la categoría "${c.name}"?`, { confirmText: 'Eliminar' }))) return
    try {
      await deleteCategory(c.id)
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo eliminar')
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900">Categorías</h1>
        <button className="btn-primary" onClick={openNew}>+ Nueva categoría</button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Nombre', 'Descripción', 'Horario', 'Disponibilidad', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {categories.map((c) => (
                <tr key={c.id} {...filaClick(() => openEdit(c))} className={`${FILA_CLICK} hover:bg-gray-50`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-500">{c.description || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.scheduleStart && c.scheduleEnd ? `${toInputTime(c.scheduleStart)}–${toInputTime(c.scheduleEnd)}` : 'Todo el día'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.availableNow ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                        {c.availableNow ? 'Disponible ahora' : 'Oculta ahora'}
                      </span>
                      <select
                        className="input !w-auto py-1 text-xs"
                        value={c.availabilityMode}
                        onChange={(e) => handleModeChange(c, e.target.value)}
                      >
                        {Object.entries(MODE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button className="text-blue-600 hover:underline text-xs" onClick={() => openEdit(c)}>Editar</button>
                      <button className="text-red-500 hover:underline text-xs" onClick={() => handleDelete(c)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin categorías</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{editCategory ? 'Editar categoría' : 'Nueva categoría'}</h3>
            {/* Sin `required` nativo a propósito (ver validateCategoryForm): el globo del
                navegador se disparaba antes de que este formulario alcanzara a correr. */}
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre <span className={fieldErrors.name ? 'text-red-600' : ''}>*</span></label>
                <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                {fieldErrors.name && <p className="text-red-600 text-xs mt-1">{fieldErrors.name}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                {fieldErrors.description && <p className="text-red-600 text-xs mt-1">{fieldErrors.description}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Horario de disponibilidad <span className="font-normal text-gray-400">(opcional)</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" type="time" value={form.scheduleStart}
                    onChange={(e) => setForm({ ...form, scheduleStart: e.target.value })} />
                  <input className="input" type="time" value={form.scheduleEnd}
                    onChange={(e) => setForm({ ...form, scheduleEnd: e.target.value })} />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Ej. "Desayuno" 10:00–12:00. Déjalo en blanco para que esté disponible todo el día. Se puede
                  forzar visible/oculta en cualquier momento desde la tabla, sin importar el horario.
                </p>
                {fieldErrors.scheduleStart && <p className="text-red-600 text-xs mt-1">{fieldErrors.scheduleStart}</p>}
              </div>
              {error && <p className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</p>}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
