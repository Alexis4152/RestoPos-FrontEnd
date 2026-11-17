import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { getTiendas, createTienda, updateTienda, deactivateTienda, getTiendasResumen, getTiendaPlan, uploadTiendaLogo, removeTiendaLogo } from '../api/tiendas'
import { getUsers } from '../api/users'
import defaultLogo from '../assets/logo.png'
import { resolveMediaUrl } from '../utils/media'
import { useEscapeKey } from '../hooks/useEscapeKey'
import Icon from '../components/Icon'

import ModalCloseButton from '../components/ModalCloseButton'
const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))
const iniciales = (nombre = '') => nombre.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?'

const emptyForm = { name: '', supervisorId: '' }

// Mismo límite que el backend (TiendaLogoService) — evita el viaje redondo al servidor solo
// para enterarse de que la imagen pesa de más.
const MAX_IMAGE_MB = 5

/**
 * Pantalla de tiendas para actores de plataforma (`SUPER_ADMIN`/`SUPERVISOR`, usuarios sin
 * tienda propia): cumple dos funciones a la vez.
 *
 * 1. Selector obligatorio: mientras el actor no haya elegido una tienda (`user.tienda ===
 *    null`), `PrivateRoute` lo trae aquí de forma forzosa antes de dejarlo usar el resto de
 *    la app — a partir de elegir una, el resto del sistema lo trata como el ADMIN de esa
 *    tienda (ver `AuthContext.selectTienda` y el header `X-Acting-Tienda-Id` en `api/axios.js`).
 * 2. CRUD de tiendas: alta de tiendas nuevas con nombre y logo opcional (un `SUPER_ADMIN`
 *    puede asignarles un `SUPERVISOR`; un `SUPERVISOR` que crea una queda automáticamente a
 *    cargo de ella, hasta el máximo de tiendas de su plan contratado — ver `getTiendaPlan`),
 *    edición del nombre/logo/supervisor, y baja lógica.
 *
 * También es la pantalla de "Cambiar tienda" (botón en el sidebar) para volver a elegir
 * sobre cuál tienda actuar en cualquier momento.
 */
export default function SelectTienda() {
  const { user, isSuperAdmin, selectTienda, logout, patchTienda } = useAuth()
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
  // Resumen en vivo por tienda ({ [tiendaId]: { mesasOcupadas, mesasTotal, porAceptar, ventasHoy, corteAbierto } }).
  const [resumen, setResumen] = useState({})
  const [busqueda, setBusqueda] = useState('')
  // Plan del SUPERVISOR ({ maxTiendas, usedTiendas }); null para SUPER_ADMIN (sin límite).
  const [plan, setPlan] = useState(null)
  // Logo: al crear, el archivo elegido se sube justo después de crear la tienda; al editar,
  // se sube/quita al instante y aquí solo se refleja la ruta actual.
  const [logoFile, setLogoFile] = useState(null)
  const [logoPath, setLogoPath] = useState(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)

  function loadPlan() {
    if (isSuperAdmin) return
    getTiendaPlan().then((r) => setPlan(r.data.data ?? null)).catch(() => setPlan(null))
  }

  function load() {
    loadPlan()
    setLoading(true)
    getTiendas()
      .then((r) => setTiendas(r.data.data ?? []))
      .catch(() => notify('No se pudo cargar la lista de tiendas', 'error'))
      .finally(() => setLoading(false))
    getTiendasResumen()
      .then((r) => setResumen(Object.fromEntries((r.data.data ?? []).map((x) => [x.tiendaId, x]))))
      .catch(() => setResumen({}))
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
    if (!uploadingLogo) closeModal()
  }, !!showModal)

  function handleSelect(tienda) {
    if (!tienda.isActive) return
    selectTienda(tienda)
    navigate('/')
  }

  function openNew() {
    if (planFull) return
    setEditTienda(null)
    setForm(emptyForm)
    setLogoFile(null)
    setLogoPath(null)
    setError('')
    setShowModal(true)
  }

  function openEdit(e, tienda) {
    e.stopPropagation()
    setEditTienda(tienda)
    setForm({ name: tienda.name, supervisorId: tienda.supervisor?.id ?? '' })
    setLogoFile(null)
    setLogoPath(tienda.logoPath ?? null)
    setError('')
    setShowModal(true)
  }

  /** `true` si el archivo es una imagen aceptable; si no, avisa y regresa `false`. */
  function checkImage(file) {
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      notify(`La imagen pesa demasiado — el máximo permitido es ${MAX_IMAGE_MB} MB`, 'error')
      return false
    }
    return true
  }

  // Edición: sube el logo al instante, sin esperar a "Guardar".
  async function handleLogoChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !checkImage(file)) return
    setUploadingLogo(true)
    setError('')
    try {
      const res = await uploadTiendaLogo(editTienda.id, file)
      setLogoPath(res.data.data.logoPath)
      if (user?.tienda?.id === editTienda.id) patchTienda({ logoPath: res.data.data.logoPath })
      notify('Logo actualizado', 'success')
    } catch (err) {
      setError(err.response?.data?.message ?? 'No se pudo subir el logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function handleRemoveLogo() {
    setUploadingLogo(true)
    setError('')
    try {
      await removeTiendaLogo(editTienda.id)
      setLogoPath(null)
      if (user?.tienda?.id === editTienda.id) patchTienda({ logoPath: null })
      notify('Logo eliminado, se usará el logo por default', 'success')
    } catch (err) {
      setError(err.response?.data?.message ?? 'No se pudo quitar el logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  // Cerrar el modal de edición después de cambiar el logo también refresca la lista.
  function closeModal() {
    setShowModal(false)
    if (editTienda && logoPath !== (editTienda.logoPath ?? null)) load()
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
      if (editTienda) {
        const res = await updateTienda(editTienda.id, payload)
        if (user?.tienda?.id === editTienda.id) patchTienda({ name: res.data.data.name })
      } else {
        const res = await createTienda(payload)
        // El logo es opcional y se sube después de crearla (necesita el id). Si falla, la
        // tienda ya quedó creada: se avisa y se puede subir después desde "Editar".
        if (logoFile) {
          try {
            await uploadTiendaLogo(res.data.data.id, logoFile)
          } catch (err) {
            notify(err.response?.data?.message ?? 'La tienda se creó, pero no se pudo subir el logo', 'error')
          }
        }
      }
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

  const q = busqueda.trim().toLowerCase()
  const visibles = tiendas.filter((t) => !q || t.name.toLowerCase().includes(q))
  const activas = tiendas.filter((t) => t.isActive).length
  const maxTiendas = plan?.maxTiendas ?? null
  const usedTiendas = plan?.usedTiendas ?? 0
  const planFull = maxTiendas != null && usedTiendas >= maxTiendas

  return (
    <div className="min-h-screen bg-[#F4F3EF]">
      <header className="flex flex-wrap items-center gap-3 px-4 sm:px-8 py-3 bg-[#FBFAF7] border-b border-[#E4E1DA]">
        <img src={defaultLogo} alt="" className="w-9 h-9 rounded-lg object-cover" />
        <span className="font-extrabold flex-1">RestoPOS</span>
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-full bg-purple-100 text-purple-800 flex items-center justify-center text-xs font-extrabold">{iniciales(user?.name)}</span>
          <div className="leading-tight">
            <p className="text-sm font-bold">{user?.name}</p>
            <p className="text-xs text-gray-600">{isSuperAdmin ? 'Super admin' : 'Supervisor'}</p>
          </div>
        </div>
        {isSuperAdmin && (
          <button type="button" onClick={() => navigate('/mail-config')}
            className="min-h-[40px] px-3 rounded-xl text-sm font-bold text-gray-700 hover:bg-[#F1EFEA] inline-flex items-center gap-1.5">
            <Icon name="config" className="w-4 h-4" /> Correo del sistema
          </button>
        )}
        <button type="button" onClick={() => { logout(); navigate('/login') }}
          className="ml-2 min-h-[40px] px-3 rounded-xl text-sm font-bold text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5">
          <Icon name="salir" className="w-4 h-4" /> Cerrar sesión
        </button>
      </header>

      <main className="max-w-[1180px] mx-auto px-4 sm:px-6 py-8 space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <h1 className="text-[28px] font-extrabold tracking-tight">¿En qué tienda vas a trabajar?</h1>
            <p className="text-[15px] text-gray-600 mt-1">
              {isSuperAdmin
                ? `Ves todas las tiendas de la plataforma (${activas} activa${activas === 1 ? '' : 's'}).`
                : `Tienes ${activas} tienda${activas === 1 ? '' : 's'} a tu cargo. Puedes cambiar de tienda desde el menú cuando quieras.`}
            </p>
          </div>
        </div>

        {maxTiendas != null && (
          <div className={`rounded-2xl px-4 py-3 text-[14px] border ${planFull ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-white border-[#E4E1DA] text-gray-700'}`}>
            De acuerdo con tu plan contratado puedes tener <strong>{maxTiendas} tienda{maxTiendas === 1 ? '' : 's'}</strong> activa{maxTiendas === 1 ? '' : 's'}.
            {' '}Tienes {usedTiendas} activa{usedTiendas === 1 ? '' : 's'}.
            {planFull && ' Ya llegaste al límite: para agregar más, pide que amplíen tu plan.'}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex items-center gap-2 min-h-[44px] px-3.5 rounded-xl border border-[#D9D5CC] bg-white flex-[1_1_260px] max-w-[420px]">
            <Icon name="buscar" className="w-[18px] h-[18px] text-gray-600" />
            <span className="sr-only">Buscar tienda</span>
            <input type="search" placeholder="Buscar tienda" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              className="flex-1 min-w-0 bg-transparent outline-none text-[15px]" />
          </label>
          <span className="flex-1" />
          <button type="button" className="btn-primary inline-flex items-center gap-2 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={openNew} disabled={planFull} title={planFull ? 'Llegaste al máximo de tiendas de tu plan' : undefined}>
            <Icon name="mas" className="w-4 h-4" strokeWidth={2} /> {planFull ? `Nueva tienda (límite de ${maxTiendas})` : 'Nueva tienda'}
          </button>
        </div>

        {loading ? (
          <p className="text-gray-600 text-sm">Cargando tiendas...</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {visibles.map((t) => {
              const isCurrent = user?.tienda?.id === t.id
              const r = resumen[t.id]
              return (
                <article key={t.id} className={`bg-white rounded-2xl ${isCurrent ? 'border-2 border-purple-600' : 'border border-[#E4E1DA] hover:border-purple-300'} ${!t.isActive ? 'opacity-60' : ''}`}>
                  <button type="button" disabled={!t.isActive} onClick={() => handleSelect(t)}
                    className="w-full text-left p-5 space-y-4 rounded-2xl disabled:cursor-not-allowed">
                    <div className="flex items-center gap-3.5">
                      <img src={resolveMediaUrl(t.logoPath) || defaultLogo} alt="" className="w-12 h-12 rounded-xl object-cover border border-[#E4E1DA] shrink-0"
                        style={t.primaryColor ? { borderColor: t.primaryColor } : undefined} />
                      <div className="flex-1 min-w-0">
                        <p className="text-lg font-extrabold truncate">{t.name}</p>
                        <p className="text-[13px] text-gray-600 truncate">
                          {isCurrent ? 'Estás trabajando aquí' : t.supervisor ? `Supervisor: ${t.supervisor.name}` : t.isActive ? 'Activa' : 'Inactiva'}
                        </p>
                      </div>
                      {t.isActive && r && (
                        <span className={`text-xs font-extrabold px-2.5 py-1 rounded-lg whitespace-nowrap ${r.corteAbierto ? 'bg-[#E7F3EC] text-[#22603C]' : 'bg-[#F1EFEA] text-gray-600'}`}>
                          {r.corteAbierto ? 'Corte abierto' : 'Sin corte'}
                        </span>
                      )}
                      {!t.isActive && <span className="text-xs font-extrabold px-2.5 py-1 rounded-lg bg-[#F1EFEA] text-gray-600">Inactiva</span>}
                    </div>
                    {t.isActive && (
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-xl bg-[#F7F6F2] px-3 py-2.5">
                          <p className="text-xs font-semibold text-gray-600">Mesas ocupadas</p>
                          <p className="text-xl font-extrabold">{r ? `${r.mesasOcupadas} / ${r.mesasTotal}` : '—'}</p>
                        </div>
                        <div className="rounded-xl bg-[#F7F6F2] px-3 py-2.5">
                          <p className="text-xs font-semibold text-gray-600">Por aceptar</p>
                          <p className={`text-xl font-extrabold ${r?.porAceptar > 0 ? 'text-red-700' : ''}`}>{r ? r.porAceptar : '—'}</p>
                        </div>
                        <div className="rounded-xl bg-[#F7F6F2] px-3 py-2.5">
                          <p className="text-xs font-semibold text-gray-600">Ventas de hoy</p>
                          <p className="text-xl font-extrabold">{r ? fmt(r.ventasHoy) : '—'}</p>
                        </div>
                      </div>
                    )}
                    {t.isActive && (
                      <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-purple-700">
                        {isCurrent ? 'Seguir en esta tienda' : 'Entrar a la tienda'} <Icon name="adelante" className="w-4 h-4" strokeWidth={2} />
                      </span>
                    )}
                  </button>
                  <div className="flex gap-1 px-3 pb-3 -mt-1">
                    <button type="button" className="min-h-[36px] px-3 rounded-lg text-[13px] font-semibold text-gray-700 hover:bg-[#F1EFEA] inline-flex items-center gap-1.5" onClick={(e) => openEdit(e, t)}>
                      <Icon name="editar" className="w-4 h-4" /> Editar
                    </button>
                    {t.isActive && (
                      <button type="button" className="min-h-[36px] px-3 rounded-lg text-[13px] font-semibold text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5" onClick={(e) => handleDeactivate(e, t)}>
                        <Icon name="borrar" className="w-4 h-4" /> Desactivar
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
            {visibles.length === 0 && (
              <p className="col-span-full text-center text-gray-600 py-10">
                {tiendas.length === 0 ? 'Todavía no hay tiendas registradas' : `Ninguna tienda coincide con "${busqueda}"`}
              </p>
            )}
          </div>
        )}
      </main>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <ModalCloseButton onClick={() => !uploadingLogo && closeModal()} />
            <h3 className="text-lg font-bold mb-4 pr-10">{editTienda ? 'Editar tienda' : 'Nueva tienda'}</h3>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input className="input" maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Logo (opcional)</label>
                {editTienda ? (
                  <div className="flex items-center gap-3 mt-1">
                    <img src={resolveMediaUrl(logoPath) || defaultLogo} alt="" className="w-14 h-14 rounded-xl object-cover border border-[#E4E1DA]" />
                    <div className="flex flex-col gap-1.5">
                      <label className="btn-secondary text-xs cursor-pointer inline-block text-center">
                        {uploadingLogo ? 'Subiendo...' : logoPath ? 'Cambiar logo' : 'Subir logo'}
                        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoChange} disabled={uploadingLogo} />
                      </label>
                      {logoPath && (
                        <button type="button" className="text-xs text-red-700 hover:underline text-left" onClick={handleRemoveLogo} disabled={uploadingLogo}>
                          Quitar logo
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="block text-sm mt-1"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file && !checkImage(file)) { e.target.value = ''; setLogoFile(null); return }
                      setLogoFile(file ?? null)
                    }} />
                )}
                <p className="text-xs text-gray-500 mt-1">Si no subes uno, se usa el logo por default. PNG, JPG o WEBP, máximo {MAX_IMAGE_MB} MB.</p>
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
                <button type="button" className="btn-secondary" onClick={closeModal} disabled={saving || uploadingLogo}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving || uploadingLogo}>{saving ? 'Guardando...' : editTienda ? 'Guardar' : 'Crear tienda'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
