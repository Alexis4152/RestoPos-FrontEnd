import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTables } from '../../api/mesas'
import { openOrder, getPickups, updateOrderItemStatus } from '../../api/ordenes'
import { useAuth } from '../../context/AuthContext'
import { useNotify } from '../../context/NotifyContext'
import { useLiveRefresh } from '../../utils/liveEvents'
import SelectorModoToma from '../../components/SelectorModoToma'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const PERSONAS = [1, 2, 3, 4]

function minutos(desde) {
  if (!desde) return ''
  const m = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
// "Mesa 4", sin repetir la palabra si el número ya la trae ("Mesa 6").
export const nombreMesa = (numero) => (/^mesa\b/i.test(String(numero)) ? String(numero) : `Mesa ${numero}`)
const porNumero = (a, b) => String(a.numero).localeCompare(String(b.numero), 'es', { numeric: true })

/**
 * Modo rápido · "Mis mesas": las mesas que atiende el mesero, cada una con sus dos acciones
 * a la mano (+ Pedir / Cuenta). Una mesa libre se abre tocándola y luego cuántas personas
 * son — sin modal — y entra directo a ordenar. Arriba, los platillos que cocina ya terminó
 * con "Ya los llevé" (los marca entregados de un toque). "Mías" = órdenes que abrió este
 * usuario (Orden.mesero). El modo detallado (plano por zonas) sigue en el interruptor.
 */
export default function MisMesas() {
  const { user, hasSection } = useAuth()
  const puedeCobrar = hasSection('CASH_CUTS')
  const { notify } = useNotify()
  const navigate = useNavigate()
  const [mesas, setMesas] = useState([])
  const [pickups, setPickups] = useState([])
  const [filtro, setFiltro] = useState(null) // null = aún sin decidir (Mías si tiene, si no Todas)
  const [abriendo, setAbriendo] = useState(null) // mesa libre elegida: muestra "¿cuántas personas?"
  const [otras, setOtras] = useState(5)
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)

  function load() {
    getTables().then((r) => setMesas(r.data.data ?? [])).catch(() => setMesas([]))
    getPickups().then((r) => setPickups(r.data.data ?? [])).catch(() => setPickups([]))
  }
  useEffect(() => { load() }, [])
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t) }, [])
  useLiveRefresh(load)

  const activas = mesas.filter((m) => m.estado !== 'FUERA_DE_SERVICIO')
  const principales = activas.filter((m) => !m.unidaA)
  const esMia = (m) => m.ordenActiva && m.ordenActiva.mesero?.id === user?.id
  const mias = principales.filter(esMia)
  const libres = principales.filter((m) => !m.ordenActiva)
  const ocupadas = principales.filter((m) => m.ordenActiva)
  const vista = filtro ?? (mias.length > 0 ? 'mias' : 'todas')
  const lista = (vista === 'mias' ? mias : vista === 'libres' ? libres : [...ocupadas, ...libres])

  // Platillos listos de mesa (de las mías, o de todas si estoy viendo todas).
  const listos = pickups.filter((o) => o.mesa && (vista !== 'mias' || o.mesero?.id === user?.id))
  const listosPorOrden = Object.fromEntries(pickups.map((o) => [o.ordenId ?? o.id, (o.items ?? []).reduce((s, i) => s + Number(i.cantidad), 0)]))
  const piezasListas = listos.reduce((s, o) => s + (o.items ?? []).reduce((x, i) => x + Number(i.cantidad), 0), 0)

  // Orden: primero lo que pide atención (cuenta, platillos listos), luego por número.
  const prioridad = (m) => (m.estado === 'PENDIENTE_PAGO' ? 0 : listosPorOrden[m.ordenActiva?.id] ? 1 : m.ordenActiva ? 2 : 3)
  const ordenadas = [...lista].sort((a, b) => prioridad(a) - prioridad(b) || porNumero(a, b))
  const unidasA = (m) => activas.filter((t) => t.unidaA && t.ordenActiva?.id === m.ordenActiva?.id).map((t) => t.numero)

  async function abrir(mesa, personas) {
    setBusy(true)
    try {
      const r = await openOrder({ mesaId: mesa.id, numeroComensales: personas })
      navigate(`/orders/${r.data.data.id}`)
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo abrir la mesa', 'error')
      load()
    } finally { setBusy(false) }
  }

  async function yaLosLleve() {
    setBusy(true)
    try {
      for (const o of listos) {
        for (const i of o.items ?? []) await updateOrderItemStatus(o.id, i.id, 'ENTREGADO')
      }
      notify('Marcados como entregados', 'success')
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudieron marcar', 'error')
    } finally { setBusy(false); load() }
  }

  const FILTROS = [
    { key: 'mias', label: 'Mías', n: mias.length },
    { key: 'todas', label: 'Todas', n: principales.length },
    { key: 'libres', label: 'Libres', n: libres.length },
  ]

  return (
    <div className="space-y-4 max-w-5xl">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-[28px] font-extrabold tracking-tight">Mis mesas</h1>
          <p className="text-sm text-gray-600">{user?.name} · {mias.length} mesa{mias.length === 1 ? '' : 's'} a tu cargo</p>
        </div>
        <SelectorModoToma />
      </header>

      <div className="flex flex-wrap gap-2" aria-label="Filtrar mesas">
        {FILTROS.map((f) => (
          <button key={f.key} type="button" aria-pressed={vista === f.key} onClick={() => setFiltro(f.key)}
            className={`chip ${vista === f.key ? 'chip-on' : ''}`}>
            {f.label} <span className="opacity-70">{f.n}</span>
          </button>
        ))}
      </div>

      {piezasListas > 0 && (
        <div className="rounded-2xl bg-[#FBF0DC] px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[180px]">
            <p className="text-sm font-extrabold text-[#6B4100]">{piezasListas} platillo{piezasListas === 1 ? '' : 's'} listo{piezasListas === 1 ? '' : 's'} para llevar</p>
            <p className="text-xs text-[#6B4100]">
              {listos.map((o) => `${nombreMesa(o.mesa.numero)}: ${(o.items ?? []).map((i) => `${Number(i.cantidad) > 1 ? `${Number(i.cantidad)} ` : ''}${i.productoNombre}`).join(', ')}`).join(' · ')}
            </p>
          </div>
          <button type="button" disabled={busy} onClick={yaLosLleve}
            className="min-h-[44px] px-4 rounded-xl bg-[#6B4100] text-white text-sm font-extrabold disabled:opacity-50">
            Ya los llevé
          </button>
        </div>
      )}

      {ordenadas.length === 0 && (
        <p className="text-center text-gray-600 py-12">
          {vista === 'mias' ? 'No tienes mesas abiertas. Ve a "Libres" para abrir una.' : 'No hay mesas para mostrar.'}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
        {ordenadas.map((m) => {
          const o = m.ordenActiva
          if (!o) {
            const elegida = abriendo === m.id
            return (
              <article key={m.id} className={`bg-white border rounded-2xl p-4 ${elegida ? 'border-purple-600 sm:col-span-2 lg:col-span-1' : 'border-[#E4E1DA]'}`}>
                <button type="button" onClick={() => { setAbriendo(elegida ? null : m.id); setOtras(5) }} aria-expanded={elegida}
                  className="w-full flex items-baseline justify-between gap-2 text-left min-h-[44px]">
                  <span className="text-lg font-extrabold">{nombreMesa(m.numero)}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">{m.zona?.nombre}{m.capacidad ? ` · ${m.capacidad} lugares` : ''}</span>
                    <span className={`text-xs font-extrabold px-2 py-0.5 rounded-md ${m.estado === 'RESERVADA' ? 'bg-[#EEEAF8] text-[#4B3391]' : 'bg-[#E7F3EC] text-[#22603C]'}`}>
                      {m.estado === 'RESERVADA' ? 'Reservada' : 'Libre'}
                    </span>
                  </span>
                </button>
                {elegida && (
                  <div className="mt-2 space-y-2">
                    <p className="text-sm text-gray-600">¿Cuántas personas? Toca y empieza a ordenar</p>
                    <div className={`grid gap-2 ${!m.capacidad || m.capacidad > 4 ? 'grid-cols-5' : 'grid-cols-4'}`}>
                      {PERSONAS.filter((n) => !m.capacidad || n <= m.capacidad).map((n) => (
                        <button key={n} type="button" disabled={busy} onClick={() => abrir(m, n)}
                          className="min-h-[48px] rounded-xl border border-[#D9D5CC] bg-white text-lg font-extrabold hover:border-purple-600 hover:bg-purple-50 disabled:opacity-50">
                          {n}
                        </button>
                      ))}
                      {(!m.capacidad || m.capacidad > 4) && (
                        <div className="flex items-center rounded-xl border border-[#D9D5CC]">
                          <label className="sr-only" htmlFor={`otras-${m.id}`}>Más personas</label>
                          <input id={`otras-${m.id}`} type="number" min={5} max={m.capacidad || 50} value={otras} onChange={(e) => setOtras(e.target.value)}
                            className="no-spinner w-full min-w-0 bg-transparent text-center text-lg font-extrabold outline-none" />
                        </div>
                      )}
                    </div>
                    {(!m.capacidad || m.capacidad > 4) && (
                      <button type="button" disabled={busy || !(Number(otras) >= 1) || (m.capacidad && Number(otras) > m.capacidad)}
                        onClick={() => abrir(m, Math.min(m.capacidad || 50, Number(otras)))}
                        className="w-full min-h-[40px] rounded-xl text-sm font-bold text-purple-700 hover:bg-purple-50 disabled:opacity-50">
                        {m.capacidad && Number(otras) > m.capacidad ? `Máximo ${m.capacidad} personas` : `Abrir con ${otras} personas`}
                      </button>
                    )}
                    {m.capacidad && <p className="text-xs text-gray-600 text-center">Para más de {m.capacidad}, abre la mesa y une otra.</p>}
                  </div>
                )}
              </article>
            )
          }
          const listosMesa = listosPorOrden[o.id] ?? 0
          const cuenta = m.estado === 'PENDIENTE_PAGO'
          const extra = unidasA(m)
          return (
            <article key={m.id} className={`bg-white rounded-2xl p-4 flex flex-col gap-1.5 ${cuenta ? 'border-2 border-[#C77700]' : 'border border-[#E4E1DA]'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-extrabold">{nombreMesa([m.numero, ...extra].join(' + '))}</span>
                {cuenta ? <span className="text-xs font-extrabold px-2 py-0.5 rounded-md bg-[#FBF0DC] text-[#6B4100]">Pidió cuenta</span>
                  : listosMesa > 0 ? <span className="text-xs font-extrabold px-2 py-0.5 rounded-md bg-[#FBF0DC] text-[#6B4100]">{listosMesa} listo{listosMesa === 1 ? '' : 's'}</span>
                    : <span className="text-xs font-extrabold px-2 py-0.5 rounded-md bg-[#E6EDF8] text-[#1E4585]">Ocupada</span>}
              </div>
              <p className="text-sm text-gray-600">
                {o.numeroComensales} persona{o.numeroComensales === 1 ? '' : 's'} · {minutos(o.openedAt)}
                {!esMia(m) && o.mesero?.name ? ` · ${o.mesero.name}` : ''}
              </p>
              <p className="text-lg font-extrabold">{fmt(o.total)}</p>
              <div className="flex gap-2 mt-1">
                <button type="button" onClick={() => navigate(`/orders/${o.id}?ver=pedir`)}
                  className="flex-1 min-h-[44px] rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-extrabold">+ Pedir</button>
                <button type="button" onClick={() => navigate(`/orders/${o.id}?ver=cuenta`)}
                  className={`flex-1 min-h-[44px] rounded-xl text-sm font-extrabold ${cuenta ? 'bg-gray-900 text-white' : 'border border-[#D9D5CC] bg-white text-gray-900 hover:bg-[#F1EFEA]'}`}>
                  {cuenta ? (puedeCobrar ? 'Cobrar' : 'Ver cuenta') : 'Cuenta'}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
