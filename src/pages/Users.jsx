import { useEffect, useState } from 'react'
import { getUsersPage, createUser, updateUser, deleteUser } from '../api/users'
import { getRoles } from '../api/roles'
import { getTiendas, getTiendasBySupervisor } from '../api/tiendas'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import PasswordInput from '../components/PasswordInput'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { filaClick, FILA_CLICK } from '../utils/filaClick'
import IconButton from '../components/IconButton'
import Pagination from '../components/Pagination'

import ModalCloseButton from '../components/ModalCloseButton'
const fmtDate = (d) => d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'

const emptyForm = { name: '', email: '', password: '', roleId: '', tiendaId: '', supervisedTiendaIds: [], maxTiendas: '' }
const EMPTY_FILTERS = { from: '', to: '', name: '', email: '', roleId: '', isActive: '' }

// Mismo mapa de jerarquía que UserService#ROLE_RANK en el backend — se usa SOLO para
// ocultar del selector de alta/edición los roles que el backend igual rechazaría (menor
// rango numérico = más poder; cualquier rol sin entrada aquí, como MESERO o uno
// personalizado, cae por debajo de ADMIN). Es una ayuda de UX, no el control de acceso
// real: aunque este filtro se saltara, el backend igual lo rechaza (ver assertCanAssignRole).
const ROLE_RANK = { SUPER_ADMIN: 0, SUPERVISOR: 1, ADMIN: 2 }
const rankOf = (roleName) => ROLE_RANK[roleName] ?? 3

// Mismo patrón simple que el resto de la app para validar formato de correo del lado del
// cliente (ver validateUserForm) — no reemplaza al @Email real del backend, solo adelanta
// el error más común sin esperar el viaje redondo al servidor.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Pantalla "Usuarios": CRUD de los usuarios de la tienda del usuario en sesión (o de todas
 * las tiendas si es `SUPER_ADMIN`, según lo que filtre el backend). Sirve a los roles con
 * la sección `USERS` habilitada (típicamente `ADMIN`/`SUPER_ADMIN`/`SUPERVISOR`).
 *
 * Incluye filtros de búsqueda por rango de fecha de registro, nombre, email, rol y estado
 * (activo/inactivo), y una tabla con columna de fecha de registro. "Desactivar" un usuario
 * es un borrado suave (el backend marca `isActive=false`, no elimina el registro), por eso
 * la tabla muestra una columna de Estado en vez de que el usuario desaparezca de la lista;
 * los usuarios inactivos siguen apareciendo salvo que el filtro de Estado los excluya.
 *
 * La contraseña nunca la captura quien da de alta: el backend genera una temporal y se la
 * manda por correo, marcando `mustChangePassword=true` — al iniciar sesión por primera vez,
 * `PrivateRoute` lo manda directo a `/change-password` antes de dejarlo usar el resto de la
 * app (ver `ChangePasswordRequired.jsx`). Editar sí permite resetear la contraseña de un
 * usuario existente (deja vacío para no tocarla) — igual queda marcado `mustChangePassword`.
 *
 * Registrar un SUPERVISOR (solo `SUPER_ADMIN`): al elegir ese rol de plataforma el usuario
 * queda sin tienda propia y aparecen dos campos más — qué tiendas va a administrar
 * (`supervisedTiendaIds`) y el máximo de tiendas de su plan contratado (`maxTiendas`, vacío
 * = sin límite), que el backend valida cuando el supervisor da de alta tiendas nuevas.
 */
export default function Users() {
  const { isSuperAdmin, user } = useAuth()
  const { notify, confirmDialog } = useNotify()
  const [users, setUsers] = useState([])
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(20)
  const [pageInfo, setPageInfo] = useState({ totalElements: 0, totalPages: 0 })
  const [roles, setRoles] = useState([])
  const [tiendas, setTiendas] = useState([])
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [form, setForm] = useState(emptyForm)
  // Error general del modal de usuario (reglas de negocio sin campo asociado, o cualquier
  // fallo que no venga de @Valid).
  const [error, setError] = useState('')
  // Errores de validación por campo, { nombreDelCampo: mensaje } — mismo formato que
  // GlobalExceptionHandler ya manda para @Valid (ver UserRequest en el backend). Se
  // muestran justo debajo de su input y ponen en rojo el asterisco de "obligatorio".
  const [fieldErrors, setFieldErrors] = useState({})
  const [loading, setLoading] = useState(false)

  /**
   * Recarga el listado de usuarios aplicando los filtros ya confirmados (`appliedFilters`,
   * no los que el usuario esté todavía editando en `filters`) y el catálogo de roles para
   * el selector del filtro y del formulario. El rango de fecha se expande a inicio/fin de
   * día (`T00:00:00` / `T23:59:59`) para que el filtro "Desde/Hasta" incluya el día completo
   * y no solo el instante exacto de medianoche.
   */
  function load() {
    const params = {
      name: appliedFilters.name || undefined,
      email: appliedFilters.email || undefined,
      roleId: appliedFilters.roleId || undefined,
      isActive: appliedFilters.isActive || undefined,
      from: appliedFilters.from ? `${appliedFilters.from}T00:00:00` : undefined,
      to: appliedFilters.to ? `${appliedFilters.to}T23:59:59` : undefined,
    }
    getUsersPage({ ...params, page, size }).then((r) => {
      const d = r.data.data ?? { content: [], totalElements: 0, totalPages: 0 }
      if ((d.content ?? []).length === 0 && page > 0) { setPage(page - 1); return }
      setUsers(d.content ?? [])
      setPageInfo({ totalElements: d.totalElements ?? 0, totalPages: d.totalPages ?? 0 })
    })
    getRoles().then((r) => setRoles(r.data.data ?? []))
    // El selector de tienda al dar de alta/editar un usuario solo aplica para SUPER_ADMIN
    // (cualquier otro actor siempre da de alta dentro de su propia tienda/la que eligió actuar).
    if (isSuperAdmin) getTiendas().then((r) => setTiendas(r.data.data ?? []))
  }

  // Recarga cada vez que cambian los filtros aplicados (al confirmar o limpiar el formulario
  // de filtros), no en cada tecleo — por eso existe la distinción filters vs appliedFilters.
  useEffect(() => { load() }, [appliedFilters, page, size]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cierra con ESC el modal de usuario (mismo efecto que "Cancelar"), descartando lo capturado.
  useEscapeKey(() => {
    setShowModal(false)
  }, !!showModal)

  // Confirma los filtros en edición como los filtros activos, disparando la recarga.
  function handleApplyFilters(e) {
    e.preventDefault()
    setPage(0)
    setAppliedFilters(filters)
  }

  // Limpia tanto el formulario de filtros como los filtros aplicados (vuelve a listar todo).
  function handleClearFilters() {
    setFilters(EMPTY_FILTERS)
    setAppliedFilters(EMPTY_FILTERS)
    setPage(0)
  }

  // Abre el modal en blanco para crear un usuario nuevo. `roleId` arranca vacío a
  // propósito (no se preselecciona el primer rol de la lista): así el select siempre
  // muestra "Selecciona un rol" por default y de verdad obliga a elegir uno conscientemente.
  function openNew() {
    setEditUser(null)
    setForm(emptyForm)
    setError('')
    setFieldErrors({})
    setShowModal(true)
  }

  // Abre el modal precargado con los datos del usuario a editar. La contraseña se deja
  // vacía a propósito: en edición, un campo vacío significa "no cambiar la contraseña".
  // Si es un SUPERVISOR, precarga además qué tiendas administra hoy (esa info no viaja en
  // el propio usuario — vive en Tienda.supervisor) para que el selector arranque marcado.
  function openEdit(u) {
    setEditUser(u)
    setForm({
      name: u.name, email: u.email, password: '', roleId: u.role?.id ?? '', tiendaId: u.tienda?.id ?? '',
      supervisedTiendaIds: [], maxTiendas: u.maxTiendas ?? '',
    })
    setError('')
    setFieldErrors({})
    setShowModal(true)
    if (isSuperAdmin && u.role?.name === 'SUPERVISOR' && !u.tienda) {
      getTiendasBySupervisor(u.id).then((r) => {
        setForm((f) => ({ ...f, supervisedTiendaIds: (r.data.data ?? []).map((t) => t.id) }))
      })
    }
  }

  /**
   * Valida el formulario de usuario del lado del cliente, replicando los límites que ya
   * exige `UserRequest`/`UserService` en el backend (mismos mensajes) — para adelantar el
   * error más común antes de pedir confirmación de guardado (ver `handleSave`), en vez de
   * hacerlo hasta después del viaje redondo al servidor. El backend sigue siendo quien de
   * verdad decide (esto no lo reemplaza).
   *
   * @returns {{[field: string]: string}} vacío si el formulario es válido
   */
  function validateUserForm() {
    const errors = {}
    if (!form.name.trim()) errors.name = 'El nombre es obligatorio'
    else if (form.name.length > 100) errors.name = 'El nombre no puede tener más de 100 caracteres'
    if (!form.email.trim()) errors.email = 'El correo es obligatorio'
    else if (!EMAIL_RE.test(form.email)) errors.email = 'El correo no tiene un formato válido'
    else if (form.email.length > 150) errors.email = 'El correo no puede tener más de 150 caracteres'
    // Al crear no se captura contraseña (el backend genera una temporal y la manda por
    // correo); al editar, un campo vacío significa "no cambiarla".
    if (editUser && form.password && (form.password.length < 6 || form.password.length > 72)) {
      errors.password = 'La contraseña debe tener entre 6 y 72 caracteres'
    }
    if (!form.roleId) errors.roleId = 'Selecciona un rol'
    if (showTiendaPicker && !form.tiendaId && !user?.tienda) errors.tiendaId = 'Selecciona una tienda'
    if (showSupervisorTiendaPicker && form.maxTiendas !== '' && Number(form.maxTiendas) > 1000) {
      errors.maxTiendas = 'El máximo de tiendas no puede ser mayor a 1000'
    }
    return errors
  }

  // Crea o actualiza el usuario según haya o no un `editUser` en edición (previa
  // confirmación explícita, para evitar altas/ediciones accidentales), y recarga el
  // listado (respetando los filtros aplicados). La confirmación solo se pide si el
  // formulario ya pasó `validateUserForm` — no tiene sentido preguntar "¿deseas crear/
  // guardar?" si el backend lo va a rechazar de todas formas.
  async function handleSave(e) {
    e.preventDefault()
    const validationErrors = validateUserForm()
    if (Object.keys(validationErrors).length > 0) {
      // Advertencia de validación local, NO el mismo mensaje que un fallo real del
      // backend (ver el catch de abajo) — aquí todavía no se intentó guardar nada.
      setFieldErrors(validationErrors)
      setError('')
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    const confirmMsg = editUser
      ? `¿Deseas guardar los cambios de "${form.name}"?`
      : `¿Deseas crear el usuario "${form.name}"? Se le enviará una contraseña temporal a ${form.email}.`
    if (!(await confirmDialog(confirmMsg, { confirmText: editUser ? 'Guardar cambios' : 'Crear', danger: false }))) return
    setLoading(true)
    setError('')
    setFieldErrors({})
    const payload = {
      ...form,
      tiendaId: showTiendaPicker && form.tiendaId ? Number(form.tiendaId) : undefined,
      // Solo viajan para un SUPERVISOR registrado/editado por SUPER_ADMIN (el backend los
      // ignora en cualquier otro caso). maxTiendas vacío = sin límite.
      supervisedTiendaIds: showSupervisorTiendaPicker ? form.supervisedTiendaIds : undefined,
      maxTiendas: showSupervisorTiendaPicker ? (form.maxTiendas === '' ? null : Number(form.maxTiendas)) : undefined,
    }
    try {
      if (editUser) await updateUser(editUser.id, payload)
      else await createUser(payload)
      setShowModal(false)
      load()
      notify(editUser ? 'Usuario editado correctamente' : 'Usuario agregado correctamente', 'success')
    } catch (err) {
      // Errores de validación (@Valid) y de conflicto por campo (ej. correo duplicado, ver
      // UserService#create/#update) traen { campo: mensaje } en `data` — se reparten a
      // `fieldErrors` para mostrarse justo debajo de cada input. Cualquier otro tipo de
      // error (regla de negocio sin campo asociado, 500, etc.) va al mensaje general.
      const data = err.response?.data?.data
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        setFieldErrors(data)
        setError('')
      } else {
        setFieldErrors({})
        setError(err.response?.data?.message ?? 'Error al guardar')
      }
      notify(editUser ? 'Error al guardar el usuario' : 'Error al registrar el usuario', 'error')
    } finally { setLoading(false) }
  }

  /**
   * "Elimina" (desactiva) un usuario tras confirmación explícita. Es un borrado suave:
   * el backend marca `isActive=false` en vez de borrar el registro, por lo que el usuario
   * sigue apareciendo en la tabla (con estado "Inactivo") salvo que el filtro de Estado lo
   * oculte. Por eso el botón de acción en la tabla solo se muestra para usuarios activos
   * (`u.isActive`) — ya no tiene sentido "desactivar" a alguien ya inactivo.
   */
  async function handleDelete(u) {
    if (!(await confirmDialog(`¿Desactivar a "${u.name}"?`, { confirmText: 'Desactivar' }))) return
    try {
      await deleteUser(u.id)
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'Error al eliminar')
    }
  }

  // Colores de la etiqueta de rol en la tabla; los roles sin color definido (roles
  // personalizados creados por el admin) caen en el gris por default.
  const ROLE_COLORS = {
    SUPER_ADMIN: 'bg-red-100 text-red-700',
    SUPERVISOR: 'bg-orange-100 text-orange-700',
    ADMIN: 'bg-purple-100 text-purple-700',
    MESERO: 'bg-blue-100 text-blue-700',
  }
  const roleColor = (name) => ROLE_COLORS[name] ?? 'bg-gray-100 text-gray-600'

  // Roles que el actor puede asignar al alta/editar (ver ROLE_RANK arriba): estrictamente
  // por debajo del suyo. El filtro de búsqueda de la tabla sigue usando `roles` completo —
  // ahí sí tiene sentido poder filtrar por "ADMIN" aunque no puedas crear uno.
  const assignableRoles = roles.filter((r) => rankOf(r.name) > rankOf(user?.role))

  // El rol SUPERVISOR de plataforma es el único sin `tienda` (una tienda podría tener un rol
  // personalizado con el mismo nombre), así que se distingue por eso, no solo por el nombre.
  const formRole = roles.find((r) => String(r.id) === String(form.roleId))
  const isPlatformFormRole = !!formRole && !formRole.tienda
  const showSupervisorTiendaPicker = isSuperAdmin && isPlatformFormRole && formRole.name === 'SUPERVISOR'
  // Selector de tienda: solo SUPER_ADMIN, y solo para roles que sí pertenecen a una tienda.
  const showTiendaPicker = isSuperAdmin && !!formRole && !isPlatformFormRole

  /** Marca/desmarca una tienda en el selector de "tiendas que administra". */
  function toggleSupervisedTienda(tiendaId) {
    setForm((f) => {
      const has = f.supervisedTiendaIds.includes(tiendaId)
      return { ...f, supervisedTiendaIds: has ? f.supervisedTiendaIds.filter((id) => id !== tiendaId) : [...f.supervisedTiendaIds, tiendaId] }
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900">Usuarios</h1>
        <button className="btn-primary" onClick={openNew}>+ Nuevo usuario</button>
      </div>

      <form onSubmit={handleApplyFilters} className="card mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Desde</label>
          <input type="date" className="input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Hasta</label>
          <input type="date" className="input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Nombre</label>
          <input type="text" className="input" placeholder="Nombre" value={filters.name} onChange={(e) => setFilters({ ...filters, name: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Email</label>
          <input type="text" className="input" placeholder="Email" value={filters.email} onChange={(e) => setFilters({ ...filters, email: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Rol</label>
          <select className="input" value={filters.roleId} onChange={(e) => setFilters({ ...filters, roleId: e.target.value })}>
            <option value="">Todos</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Estado</label>
          <select className="input" value={filters.isActive} onChange={(e) => setFilters({ ...filters, isActive: e.target.value })}>
            <option value="">Todos</option>
            <option value="true">Activo</option>
            <option value="false">Inactivo</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1">Filtrar</button>
          <button type="button" className="btn-secondary" onClick={handleClearFilters}>Limpiar</button>
        </div>
      </form>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Nombre', 'Email', 'Rol', 'Fecha de registro', 'Estado', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.map((u) => (
              <tr key={u.id} {...filaClick(() => openEdit(u))} className={`${FILA_CLICK} hover:bg-gray-50`}>
                <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                <td className="px-4 py-3 text-gray-500">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${roleColor(u.role?.name)}`}>{u.role?.name}</span>
                  {u.role?.name === 'SUPERVISOR' && !u.tienda && (
                    <span className="block text-xs text-gray-500 mt-1">
                      Plataforma · {u.maxTiendas != null ? `plan de ${u.maxTiendas} tienda${u.maxTiendas === 1 ? '' : 's'}` : 'sin límite de tiendas'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{fmtDate(u.createdAt)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {u.isActive ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5">
                    <IconButton icon="lapiz" label="Editar" variant="primary" onClick={() => openEdit(u)} />
                    {u.isActive && <IconButton icon="archivar" label="Desactivar" variant="danger" onClick={() => handleDelete(u)} />}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin usuarios</td></tr>
            )}
          </tbody>
        </table>
        </div>
        <Pagination page={page} size={size} totalElements={pageInfo.totalElements} totalPages={pageInfo.totalPages}
          count={users.length} onPageChange={setPage} onSizeChange={(n) => { setSize(n); setPage(0) }} />
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <ModalCloseButton onClick={() => setShowModal(false)} />
            <h3 className="text-lg font-bold mb-4 pr-10">{editUser ? 'Editar usuario' : 'Nuevo usuario'}</h3>
            {/* Sin `required`/`type="email"` a propósito: esos disparan la validación nativa
                del navegador (globo/tooltip fuera del estilo de la app, y que además no
                sabe que la contraseña solo es obligatoria al crear) — en su lugar,
                validateUserForm + fieldErrors dan el mismo feedback con el estilo propio. */}
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre <span className={fieldErrors.name ? 'text-red-600' : ''}>*</span></label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                {fieldErrors.name && <p className="text-red-600 text-xs mt-1">{fieldErrors.name}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Email <span className={fieldErrors.email ? 'text-red-600' : ''}>*</span></label>
                <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                {fieldErrors.email && <p className="text-red-600 text-xs mt-1">{fieldErrors.email}</p>}
              </div>
              {editUser ? (
                <div>
                  <label className="text-xs font-medium text-gray-600">Contraseña <span className={fieldErrors.password ? 'text-red-600' : ''}>(dejar vacío para no cambiar)</span></label>
                  <PasswordInput className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                  {fieldErrors.password && <p className="text-red-600 text-xs mt-1">{fieldErrors.password}</p>}
                  <p className="text-xs text-gray-400 mt-1">Si la cambias aquí, se le pedirá elegir una nueva la próxima vez que inicie sesión.</p>
                </div>
              ) : (
                <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                  📧 Se le va a enviar una contraseña temporal por correo, y se le pedirá cambiarla al iniciar sesión por primera vez.
                </p>
              )}
              <div>
                <label className="text-xs font-medium text-gray-600">Rol <span className={fieldErrors.roleId ? 'text-red-600' : ''}>*</span></label>
                <select className="input" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                  <option value="">Selecciona un rol</option>
                  {assignableRoles.map((r) => <option key={r.id} value={r.id}>{r.name}{!r.tienda ? ' (plataforma)' : ''}</option>)}
                </select>
                {fieldErrors.roleId && <p className="text-red-600 text-xs mt-1">{fieldErrors.roleId}</p>}
                {(() => {
                  const r = assignableRoles.find((x) => String(x.id) === String(form.roleId))
                  const secs = r?.sections ?? []
                  return secs.includes('DELIVERY') && secs.every((s) => s === 'DELIVERY' || s === 'CASH_CUTS') && (
                    <p className="text-xs text-blue-700 bg-blue-50 rounded-lg px-2 py-1.5 mt-1.5">
                      🛵 Este usuario trabaja desde la <b>página web</b> del restaurante (Configuración → Página web): entra ahí con este correo y contraseña. No usa el punto de venta.
                    </p>
                  )
                })()}
              </div>
              {showSupervisorTiendaPicker && (
                <div>
                  <label className="text-xs font-medium text-gray-600">¿Qué tiendas va a administrar?</label>
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto mt-1">
                    {tiendas.length === 0 ? (
                      <p className="text-xs text-gray-400 px-3 py-2">Todavía no hay tiendas registradas.</p>
                    ) : tiendas.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                        <input type="checkbox" checked={form.supervisedTiendaIds.includes(t.id)} onChange={() => toggleSupervisedTienda(t.id)} />
                        <span className="flex-1">{t.name}</span>
                        {t.supervisor && t.supervisor.id !== editUser?.id && (
                          <span className="text-xs text-amber-600">a cargo de {t.supervisor.name}</span>
                        )}
                        {!t.isActive && <span className="text-xs text-gray-400">inactiva</span>}
                      </label>
                    ))}
                  </div>
                  {form.supervisedTiendaIds.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">Sin ninguna marcada, este supervisor no podrá ver ni administrar ninguna tienda hasta que cree la suya.</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">Cada tienda tiene un solo supervisor: si marcas una que ya está a cargo de otro, pasa a este.</p>
                </div>
              )}
              {showSupervisorTiendaPicker && (
                <div>
                  <label htmlFor="user-max-tiendas" className="text-xs font-medium text-gray-600">Máximo de tiendas (plan contratado)</label>
                  <div className="flex items-center gap-2 mt-1">
                    <button type="button" aria-label="Una tienda menos" className="w-9 h-9 rounded-lg border text-gray-600 hover:bg-gray-100 text-lg leading-none"
                      onClick={() => setForm((f) => ({ ...f, maxTiendas: f.maxTiendas === '' ? '' : String(Math.max(0, Number(f.maxTiendas) - 1)) }))}>−</button>
                    <input
                      id="user-max-tiendas" className="input text-center !w-28" type="text" inputMode="numeric" placeholder="Sin límite"
                      value={form.maxTiendas}
                      onChange={(e) => setForm({ ...form, maxTiendas: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                    />
                    <button type="button" aria-label="Una tienda más" className="w-9 h-9 rounded-lg border text-gray-600 hover:bg-gray-100 text-lg leading-none"
                      onClick={() => setForm((f) => ({ ...f, maxTiendas: String(Math.min(1000, (Number(f.maxTiendas) || 0) + 1)) }))}>+</button>
                    {form.maxTiendas !== '' && (
                      <button type="button" className="text-xs text-gray-500 hover:text-gray-700 underline" onClick={() => setForm({ ...form, maxTiendas: '' })}>Sin límite</button>
                    )}
                  </div>
                  {fieldErrors.maxTiendas && <p className="text-red-600 text-xs mt-1">{fieldErrors.maxTiendas}</p>}
                  <p className="text-xs text-gray-400 mt-1">
                    {form.maxTiendas === ''
                      ? 'Vacío = sin límite. El supervisor puede crear todas las tiendas que quiera.'
                      : `El supervisor podrá tener hasta ${form.maxTiendas} tienda${Number(form.maxTiendas) === 1 ? '' : 's'} activa${Number(form.maxTiendas) === 1 ? '' : 's'}; al llegar al límite ya no podrá crear más.`}
                  </p>
                  {form.maxTiendas !== '' && form.supervisedTiendaIds.length > Number(form.maxTiendas) && (
                    <p className="text-xs text-amber-600 mt-1">Ya tiene {form.supervisedTiendaIds.length} tiendas asignadas: las conserva, pero no podrá crear más.</p>
                  )}
                </div>
              )}
              {showTiendaPicker && (
                <div><label className="text-xs font-medium text-gray-600">Tienda <span className={fieldErrors.tiendaId ? 'text-red-600' : ''}>*</span></label>
                  <select className="input" value={form.tiendaId} onChange={(e) => setForm({ ...form, tiendaId: e.target.value })}>
                    <option value="">{user?.tienda ? `Tienda actual (${user.tienda.name})` : 'Selecciona una tienda'}</option>
                    {tiendas.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  {fieldErrors.tiendaId && <p className="text-red-600 text-xs mt-1">{fieldErrors.tiendaId}</p>}
                  {editUser && <p className="text-xs text-gray-400 mt-1">Si tiene un corte de caja abierto, primero debe cerrarlo antes de poder moverlo a otra tienda.</p>}
                </div>
              )}
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
