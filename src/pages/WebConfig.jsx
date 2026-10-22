import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { getTiendaInfo, updateWebConfig } from '../api/tiendas'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))

// Sugerencia de link a partir del nombre de la tienda: "Tacos Don Pepe" → "tacos-don-pepe".
const slugify = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

/**
 * "Configuración → Página web" (solo admin): activa la página pública de la tienda
 * (`/sitio/{slug}`, ver PublicSite.jsx), define su link, si muestra las mesas, si recibe
 * pedidos para recoger y/o a domicilio, qué formas de pago acepta y los datos bancarios para
 * transferencia. El costo de envío se sigue editando en "Datos de la tienda".
 */
export default function WebConfig() {
  const { user } = useAuth()
  const { notify } = useNotify()
  const tiendaId = user?.tienda?.id
  const [form, setForm] = useState(null)
  const [costoEnvio, setCostoEnvio] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!tiendaId) return
    getTiendaInfo(tiendaId).then((r) => {
      const i = r.data.data
      setCostoEnvio(i.costoEnvioDomicilio)
      setForm({
        webEnabled: !!i.webEnabled,
        publicSlug: i.publicSlug || slugify(user?.tienda?.name),
        webMostrarMesas: i.webMostrarMesas ?? true,
        webRecogerEnabled: i.webRecogerEnabled ?? true,
        webDomicilioEnabled: !!i.webDomicilioEnabled,
        webPagoEfectivo: i.webPagoEfectivo ?? true,
        webPagoTarjeta: !!i.webPagoTarjeta,
        webPagoTransferencia: !!i.webPagoTransferencia,
        transferenciaBanco: i.transferenciaBanco || '',
        transferenciaTitular: i.transferenciaTitular || '',
        transferenciaClabe: i.transferenciaClabe || '',
        webMensaje: i.webMensaje || '',
        webReservasEnabled: !!i.webReservasEnabled,
        reservaMaxPersonas: i.reservaMaxPersonas ?? 12,
        reservaAnticipacionHoras: i.reservaAnticipacionHoras ?? 2,
        reservaDiasMax: i.reservaDiasMax ?? 30,
        // El backend manda "13:00:00"; el input de hora usa "13:00".
        reservaHoraInicio: i.reservaHoraInicio ? i.reservaHoraInicio.slice(0, 5) : '',
        reservaHoraFin: i.reservaHoraFin ? i.reservaHoraFin.slice(0, 5) : '',
        reservaTodasMesas: i.reservaTodasMesas !== false,
        reservaCambiosHoras: i.reservaCambiosHoras ?? 2,
        reservaRetrasoEnabled: i.reservaRetrasoEnabled !== false,
        reservaRetrasoHoras: i.reservaRetrasoHoras ?? 3,
      })
    })
  }, [tiendaId])

  if (!form) return <p className="text-gray-400 text-sm">Cargando...</p>

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const link = `${window.location.origin}/sitio/${form.publicSlug}`

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateWebConfig(tiendaId, {
        ...form,
        publicSlug: form.publicSlug.trim().toLowerCase(),
        reservaMaxPersonas: Number(form.reservaMaxPersonas) || 12,
        reservaAnticipacionHoras: Number(form.reservaAnticipacionHoras) || 0,
        reservaDiasMax: Number(form.reservaDiasMax) || 30,
        reservaHoraInicio: form.reservaHoraInicio || null,
        reservaHoraFin: form.reservaHoraFin || null,
        reservaTodasMesas: form.reservaTodasMesas,
        reservaCambiosHoras: Number(form.reservaCambiosHoras) || 0,
        reservaRetrasoEnabled: form.reservaRetrasoEnabled,
        reservaRetrasoHoras: Number(form.reservaRetrasoHoras) || 0,
      })
      notify('Página web guardada', 'success')
    } catch (err) {
      const data = err.response?.data?.data
      notify(data && typeof data === 'object' ? Object.values(data).join(' · ') : (err.response?.data?.message ?? 'No se pudo guardar'), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(link); notify('Link copiado', 'success') } catch { notify('No se pudo copiar el link', 'error') }
  }

  const Toggle = ({ k, label, hint }) => (
    <label className="flex items-start gap-3 py-2 cursor-pointer">
      <input type="checkbox" className="mt-1 w-4 h-4" checked={!!form[k]} onChange={(e) => set(k, e.target.checked)} />
      <span>
        <span className="block text-sm font-medium text-gray-800">{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
    </label>
  )

  return (
    <form onSubmit={handleSave} className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900">Página web</h1>
        <p className="text-gray-500 text-sm mt-1">
          Una página para tus clientes, sin el diseño del punto de venta: ven tu menú, las mesas libres u ocupadas y
          pueden hacer pedidos para recoger o a domicilio. Los pedidos te llegan a "Para llevar" para que los aceptes.
        </p>
      </div>

      <div className="card space-y-4">
        <Toggle k="webEnabled" label="Página web activa" hint="Si está apagada, el link muestra 'página no disponible'." />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Link de tu página</label>
          <div className="flex items-center rounded-lg border border-gray-300 overflow-hidden focus-within:ring-2 focus-within:ring-purple-300">
            <span className="px-3 py-2 bg-gray-50 text-gray-500 text-sm border-r border-gray-300 whitespace-nowrap">{window.location.origin}/sitio/</span>
            <input className="flex-1 px-3 py-2 text-sm outline-none min-w-0" value={form.publicSlug} maxLength={80}
              onChange={(e) => set('publicSlug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="mi-restaurante" />
          </div>
          <p className="text-xs text-gray-400 mt-1">Solo minúsculas, números y guiones.</p>
          {form.webEnabled && form.publicSlug && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" className="btn-secondary text-sm" onClick={copyLink}>📋 Copiar link</button>
              <a className="btn-secondary text-sm" href={link} target="_blank" rel="noreferrer">↗ Abrir página</a>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-2">Guarda los cambios antes de abrir o compartir el link.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Mensaje de bienvenida (opcional)</label>
          <textarea className="input" rows={3} maxLength={1000} placeholder="Ej. Abrimos de lunes a sábado de 1 a 10 pm."
            value={form.webMensaje} onChange={(e) => set('webMensaje', e.target.value)} />
        </div>
      </div>

      <div className="card">
        <p className="font-semibold text-gray-800 mb-1">Qué se muestra</p>
        <Toggle k="webMostrarMesas" label="Mostrar mesas libres / ocupadas" hint="Tus clientes ven en vivo qué mesas están disponibles en cada zona." />
      </div>

      <div className="card">
        <p className="font-semibold text-gray-800 mb-1">Pedidos en línea</p>
        <Toggle k="webRecogerEnabled" label="🛍️ Para recoger en tienda" />
        <Toggle k="webDomicilioEnabled" label="🛵 Envío a domicilio"
          hint={`Costo de envío: ${costoEnvio && Number(costoEnvio) > 0 ? fmt(costoEnvio) : 'gratis'} — se cambia en "Datos de la tienda".`} />
        <p className="text-xs text-gray-400 mt-1">
          Apaga ambas para que la página solo muestre el menú (y las mesas), sin recibir pedidos. <Link to="/store-info" className="text-purple-600 hover:underline">Ir a Datos de la tienda</Link>
        </p>
      </div>

      <div className="card">
        <p className="font-semibold text-gray-800 mb-1">Reservaciones de mesa</p>
        <Toggle k="webReservasEnabled" label="📅 Recibir reservaciones en línea"
          hint="Tus clientes eligen día, hora, personas y sus necesidades especiales (periqueras, mesa accesible, carriola). Te llegan a Mesas → Reservaciones para confirmarlas." />
        {form.webReservasEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 pl-7">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Primera hora para reservar</label>
              <input type="time" step={1800} className="input" value={form.reservaHoraInicio} onChange={(e) => set('reservaHoraInicio', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Última hora para reservar</label>
              <input type="time" step={1800} className="input" value={form.reservaHoraFin} onChange={(e) => set('reservaHoraFin', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Máximo de personas por reservación</label>
              <input type="number" min={1} max={100} className="input" value={form.reservaMaxPersonas} onChange={(e) => set('reservaMaxPersonas', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Anticipación mínima (horas)</label>
              <input type="number" min={0} max={168} className="input" value={form.reservaAnticipacionHoras} onChange={(e) => set('reservaAnticipacionHoras', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Se puede reservar hasta (días adelante)</label>
              <input type="number" min={1} max={365} className="input" value={form.reservaDiasMax} onChange={(e) => set('reservaDiasMax', e.target.value)} />
            </div>
            <p className="text-xs text-gray-400 sm:col-span-2">Sin horario, se ofrecen de 8:00 a 22:00 cada media hora.</p>
            <fieldset className="sm:col-span-2">
              <legend className="block text-xs font-medium text-gray-600 mb-1">Mesas que se pueden reservar</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" checked={form.reservaTodasMesas} onChange={() => set('reservaTodasMesas', true)} /> Todas</label>
                <label className="flex items-center gap-2"><input type="radio" checked={!form.reservaTodasMesas} onChange={() => set('reservaTodasMesas', false)} /> Solo las que marque en Mesas</label>
              </div>
              {!form.reservaTodasMesas && (
                <p className="text-xs text-gray-500 mt-1">En <Link to="/tables" className="text-purple-600 hover:underline">Mesas</Link>, edita cada mesa y marca "Disponible para reservaciones".</p>
              )}
            </fieldset>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">El cliente puede cambiar personas o necesidades hasta (horas antes)</label>
              <input type="number" min={0} max={168} className="input" value={form.reservaCambiosHoras} onChange={(e) => set('reservaCambiosHoras', e.target.value)} />
            </div>
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-gray-600 mb-1">
                <input type="checkbox" checked={form.reservaRetrasoEnabled} onChange={(e) => set('reservaRetrasoEnabled', e.target.checked)} />
                "Llegaré un poco más tarde" hasta (horas antes)
              </label>
              <input type="number" min={0} max={72} className="input" disabled={!form.reservaRetrasoEnabled} value={form.reservaRetrasoHoras} onChange={(e) => set('reservaRetrasoHoras', e.target.value)} />
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <p className="font-semibold text-gray-800 mb-1">Formas de pago</p>
        <p className="text-xs text-gray-500 mb-2">El cliente elige cómo pagará; se cobra al entregar o recoger (no hay cobro en línea).</p>
        <Toggle k="webPagoEfectivo" label="💵 Efectivo" />
        <Toggle k="webPagoTarjeta" label="💳 Tarjeta (terminal al entregar / recoger)" />
        <Toggle k="webPagoTransferencia" label="🏦 Transferencia" />
        {form.webPagoTransferencia && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pl-7">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Banco *</label>
              <input className="input" maxLength={100} value={form.transferenciaBanco} onChange={(e) => set('transferenciaBanco', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Titular *</label>
              <input className="input" maxLength={150} value={form.transferenciaTitular} onChange={(e) => set('transferenciaTitular', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">CLABE / número de cuenta *</label>
              <input className="input font-mono" maxLength={30} value={form.transferenciaClabe} onChange={(e) => set('transferenciaClabe', e.target.value)} />
            </div>
          </div>
        )}
      </div>

      <button className="btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar página web'}</button>
    </form>
  )
}
