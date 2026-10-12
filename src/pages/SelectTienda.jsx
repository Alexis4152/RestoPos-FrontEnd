import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { getTiendas, createTienda, updateTienda, deactivateTienda } from '../api/tiendas'
import { getUsers } from '../api/users'
import defaultLogo from '../assets/logo.png'
import { resolveMediaUrl } from '../utils/media'
import { useEscapeKey } from '../hooks/useEscapeKey'

const emptyForm = { name: '', supervisorId: '' }

/**
 * Pantalla de tiendas para actores de plataforma (`SUPER_ADMIN`/`SUPERVISOR`, usuarios sin
 * tienda propia): cumple dos funciones a la vez.
 *
 * 1. Selector obligatorio: mientras el actor no haya elegido una tienda (`user.tienda ===
 *    null`), `PrivateRoute` lo trae aquí de forma forzosa antes de dejarlo usar el resto de
 *    la app — a partir de elegir una, el resto del sistema lo trata como el ADMIN de esa
 *    tienda (ver `AuthContext.selectTienda` y el header `X-Acting-Tienda-Id` en `api/axios.js`).
 * 2. CRUD de tiendas: alta de tiendas nuevas (un `SUPER_ADMIN` puede asignarles un
 *    `SUPERVISOR`; un `SUPERVISOR` que crea una queda automáticamente a cargo de ella),
 *    edición del nombre/supervisor, y baja lógica.
 *
 * También es la pantalla de "Cambiar tienda" (botón en el sidebar) para volver a elegir
 * sobre cuál tienda actuar en cualquier momento.
 */
export default function SelectTienda() {
  const { user, isSuperAdmin, selectTienda } = useAuth()
  const { notify, confirmDialog } = useNotify()
  const navigate = useNavigate()

  const [tiendas, setTiendas] = useState([])
  const [supervisores, setSupervisores] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editTienda, setEditTienda] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function load() {
    setLoading(true)
    getTiendas()
      .then((r) => setTiendas(r.data.data ?? []))
      .finally(() => setLoading(false))
    // Solo un SUPER_ADMIN puede asignar un supervisor al crear/editar una tienda.
    if (isSuperAdmin) {
      getUsers().then((r) => {
        const users = r.data.data ?? []
        setSupervisores(users.filter((u) => u.role?.name === 'SUPERVISOR' && u.isActive))
      })
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cierra con ESC el modal de tienda, descartando lo capturado — mismo efecto que "Cancelar".
  useEscapeKey(() => {
    setShowModal(false)
  }, !!showModal)

  function handleSelect(tienda) {
    if (!tienda.isActive) return
    selectTienda(tienda)
    navigate('/')
  }

  function openNew() {
    setEditTienda(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  function openEdit(e, tienda) {
    e.stopPropagation()
    setEditTienda(tienda)
    setForm({ name: tienda.name, supervisorId: tienda.supervisor?.id ?? '' })
    setError('')
    setShowModal(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return }
    if (form.name.length > 150) { setError('El nombre no puede superar los 150 caracteres'); return }
    const confirmed = await confirmDialog(
      editTienda ? `¿Guardar los cambios de "${editTienda.name}"?` : `¿Crear la tienda "${form.name}"?`,
      { confirmText: editTienda ? 'Guardar' : 'Crear', danger: false }
    )
    if (!confirmed) return

    setSaving(true)
    setError('')
    const payload = { name: form.name.trim(), supervisorId: form.supervisorId || undefined }
    try {
      if (editTienda) await updateTienda(editTienda.id, payload)
      else await createTienda(payload)
      setShowModal(false)
      notify(editTienda ? 'Tienda actualizada' : 'Tienda creada', 'success')
      load()
    } catch (err) {
      setError(err.response?.data?.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(e, tienda) {
    e.stopPropagation()
    if (!(await confirmDialog(`¿Desactivar la tienda "${tienda.name}"?`, { confirmText: 'Desactivar' }))) return
    try {
      await deactivateTienda(tienda.id)
      notify('Tienda desactivada', 'success')
      load()
    } catch (err) {
      notify(err.response?.data?.message ?? 'Error al desactivar')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center py-10 px-4">
      <div className="w-full max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tiendas</h1>
            <p className="text-sm text-gray-500 mt-1">
              {user?.tienda ? 'Elige otra tienda para actuar sobre ella.' : 'Elige una tienda para continuar.'}
            </p>
          </div>
          <button className="btn-primary" onClick={openNew}>+ Nueva tienda</button>
        </div>

        {loading ? (
          <p className="text-gray-400 text-sm">Cargando tiendas...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tiendas.map((t) => {
              const isCurrent = user?.tienda?.id === t.id
              return (
                <div
                  key={t.id}
                  onClick={() => handleSelect(t)}
                  className={`card cursor-pointer hover:shadow-md transition-shadow relative ${!t.isActive ? 'opacity-50' : ''} ${isCurrent ? 'ring-2 ring-purple-500' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <img src={resolveMediaUrl(t.logoPath) || defaultLogo} alt={t.name} className="w-12 h-12 rounded-full object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900 truncate">{t.name}</p>
                      {t.supervisor && <p className="text-xs text-gray-500 truncate">Supervisor: {t.supervisor.name}</p>}
                      <span className={`inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                        isCurrent ? 'bg-purple-100 text-purple-700'
                          : t.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {isCurrent ? 'Actuando aquí ahora' : t.isActive ? 'Activa' : 'Inactiva'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-3 pt-3 border-t border-gray-100 text-xs">
                    <button className="text-blue-600 hover:underline" onClick={(e) => openEdit(e, t)}>Editar</button>
                    {t.isActive && (
                      <button className="text-red-500 hover:underline" onClick={(e) => handleDeactivate(e, t)}>Desactivar</button>
                    )}
                  </div>
                </div>
              )
            })}

            <button
              onClick={openNew}
              className="card border-dashed border-2 border-gray-300 bg-transparent shadow-none flex items-center justify-center text-gray-400 hover:text-purple-600 hover:border-purple-300 min-h-[104px]"
            >
              ➕ Nueva tienda
            </button>

            {tiendas.length === 0 && (
              <p className="col-span-full text-center text-gray-400 py-8">Todavía no hay tiendas registradas</p>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{editTienda ? 'Editar tienda' : 'Nueva tienda'}</h3>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input className="input" maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
              </div>
              {isSuperAdmin && (
                <div>
                  <label className="text-xs font-medium text-gray-600">Supervisor a cargo</label>
                  <select className="input" value={form.supervisorId} onChange={(e) => setForm({ ...form, supervisorId: e.target.value })}>
                    <option value="">Sin asignar</option>
                    {supervisores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
