import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { getReportCatalog, getReportItem, exportReportItem } from '../api/reports'
import { useNotify } from '../context/NotifyContext'
import { openOrDownloadBlob, downloadBlob } from '../utils/downloadBlob'
import { fmtValue } from '../utils/reportFormat'
import Icon from '../components/Icon'

/**
 * Pantalla de "Reportes": un catálogo de reportes agrupados en un menú lateral (Ventas,
 * Personal, Operación, Finanzas), cada uno con su periodo, filtros propios, indicadores,
 * gráficas y tabla de detalle — y exportación a CSV, Excel o PDF, exactamente lo que se ve
 * en pantalla. Mismo patrón que los reportes de DemoPV: el backend describe el catálogo
 * (`/api/reports/catalog`) y esta pantalla sabe dibujar cualquiera de ellos.
 *
 * El tipo de reporte activo y el rango de fechas viven en la URL (`?r=cuentas&from=...`),
 * así que un enlace a un reporte específico se puede compartir o recargar sin perderlo.
 */

const ICONS = {
  cuentas: 'ventas', 'top-platillos': 'menu', 'ventas-categoria': 'menu', 'ventas-servicio': 'llevar',
  'horas-pico': 'reloj', meseros: 'usuarios', cancelaciones: 'borrar', reservaciones: 'reservas',
  'movimientos-inventario': 'inventario', 'stock-bajo': 'alerta', ingresos: 'reportes',
  'pagos-metodo': 'corte', rentabilidad: 'reportes', 'comparativo-anual': 'cambiar', 'cortes-caja': 'corte',
}

const FILTER_KEYS = ['status', 'method', 'movementType', 'servicio']

const STATUS_OPTIONS = {
  reservaciones: [['', 'Todos los estados'], ['PENDIENTE', 'Por confirmar'], ['CONFIRMADA', 'Confirmada'],
    ['LLEGO', 'Llegó'], ['NO_LLEGO', 'No llegó'], ['CANCELADA', 'Cancelada'], ['RECHAZADA', 'Rechazada']],
  'cortes-caja': [['', 'Todos los estados'], ['OPEN', 'Abierto'], ['CLOSED', 'Cerrado']],
}
const METHOD_OPTIONS = [['', 'Todos los métodos'], ['CASH', 'Efectivo'], ['CARD', 'Tarjeta'], ['TRANSFER', 'Transferencia']]
const MOVEMENT_OPTIONS = [['', 'Todos los tipos'], ['IN', 'Entrada'], ['OUT', 'Salida'], ['ADJUSTMENT', 'Ajuste'], ['SALE', 'Venta (salida)']]
const SERVICIO_OPTIONS = [['', 'Todos los servicios'], ['MESA', 'Mesa'], ['PARA_LLEVAR', 'Para llevar'],
  ['COMER_AQUI', 'Comer aquí'], ['RECOGER', 'Para recoger'], ['DOMICILIO', 'A domicilio']]

const FILTER_LABELS = { status: 'Estado', method: 'Método de pago', movementType: 'Tipo de movimiento', servicio: 'Servicio' }

/** 'YYYY-MM-DD' de una fecha en hora local (no UTC: de noche, toISOString ya sería mañana). */
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const todayLocalDateStr = () => toLocalDateStr(new Date())

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return toLocalDateStr(d)
}

/** Periodos rápidos — mismos rangos que el resto de la app usa para filtrar por fecha. */
function presets(today) {
  const monthStart = `${today.slice(0, 7)}-01`
  const [y, m] = today.split('-').map(Number)
  const prevStart = toLocalDateStr(new Date(y, m - 2, 1))
  const prevEnd = addDays(monthStart, -1)
  return [
    ['Hoy', today, today],
    ['7 días', addDays(today, -6), today],
    ['Este mes', monthStart, today],
    ['Mes anterior', prevStart, prevEnd],
    ['30 días', addDays(today, -29), today],
    ['90 días', addDays(today, -89), today],
    ['Este año', `${y}-01-01`, today],
  ]
}

export default function Reports() {
  const { notify } = useNotify()
  const today = todayLocalDateStr()
  const [params, setParams] = useSearchParams()
  const [catalog, setCatalog] = useState(null)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(null)

  const type = params.get('r') || catalog?.[0]?.type
  const info = catalog?.find((c) => c.type === type)
  const from = params.get('from') || `${today.slice(0, 7)}-01`
  const to = params.get('to') || today
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']))
  const query = useMemo(() => {
    const q = info?.snapshot ? {} : { from, to }
    info?.filters.forEach((k) => { if (filters[k]) q[k] = filters[k] })
    return q
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, from, to, params])

  useEffect(() => {
    getReportCatalog().then((r) => setCatalog(r.data.data)).catch(() => notify('No se pudo cargar el catálogo de reportes', 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!info) return undefined
    let alive = true
    setLoading(true)
    setError(null)
    getReportItem(info.type, query)
      .then((r) => { if (alive) setReport(r.data.data) })
      .catch((e) => { if (alive) { setError(e?.response?.data?.message || 'No se pudo generar el reporte'); setReport(null) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, JSON.stringify(query)])

  function update(changes) {
    const next = new URLSearchParams(params)
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    setParams(next, { replace: true })
  }

  function choose(t) {
    const next = new URLSearchParams()
    next.set('r', t)
    if (params.get('from')) next.set('from', from)
    if (params.get('to')) next.set('to', to)
    setParams(next, { replace: true })
  }

  /**
   * Exporta el reporte activo. Para PDF usa `openOrDownloadBlob` (igual que el PDF
   * combinado original) por el mismo motivo: en Safari de iOS la descarga directa de un
   * PDF no funciona, pero abrirlo en una pestaña nueva sí — desde ahí se guarda con el
   * botón nativo de Compartir. CSV/Excel no tienen ese problema (el navegador no sabe
   * mostrarlos, así que cualquier descarga directa funciona igual en todos lados).
   */
  async function download(format) {
    setExporting(format)
    try {
      if (format === 'pdf') {
        await openOrDownloadBlob(() => exportReportItem(info.type, format, query), `reporte-${info.type}.pdf`, 'application/pdf')
      } else {
        const res = await exportReportItem(info.type, format, query)
        const match = res.headers['content-disposition']?.match(/filename="?([^";]+)"?/)
        downloadBlob(res.data, match?.[1] || `reporte-${info.type}.${format}`)
      }
    } catch (e) {
      notify('No se pudo exportar el reporte', 'error')
    } finally {
      setExporting(null)
    }
  }

  if (catalog && catalog.length === 0) {
    return <p className="text-gray-500">Tu rol no incluye la consulta de reportes.</p>
  }

  const groups = (catalog || []).reduce((acc, c) => ({ ...acc, [c.group]: [...(acc[c.group] || []), c] }), {})

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Reportes</h2>
          {info?.description && <p className="text-sm text-gray-500 mt-1 max-w-xl">{info.description}</p>}
        </div>
        {info && (
          <div className="flex gap-1 rounded-xl bg-white p-1 ring-1 ring-gray-200">
            {[['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'PDF']].map(([f, label]) => (
              <button key={f} onClick={() => download(f)} disabled={!!exporting || loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-100 disabled:opacity-50">
                {exporting === f ? '…' : label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <label className="lg:hidden block mb-4">
            <span className="sr-only">Reporte</span>
            <select className="input" value={type || ''} onChange={(e) => choose(e.target.value)}>
              {Object.entries(groups).map(([g, items]) => (
                <optgroup key={g} label={g}>{items.map((c) => <option key={c.type} value={c.type}>{c.title}</option>)}</optgroup>
              ))}
            </select>
          </label>
          <nav className="hidden lg:block bg-white rounded-xl shadow-sm border border-gray-100 p-2" aria-label="Reportes">
            {!catalog ? <p className="px-3 py-2 text-sm text-gray-400">Cargando…</p>
              : Object.entries(groups).map(([g, items]) => (
                <div key={g} className="mb-2 last:mb-0">
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g}</p>
                  {items.map((c) => {
                    const active = c.type === type
                    return (
                      <button key={c.type} onClick={() => choose(c.type)} aria-current={active ? 'page' : undefined}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${active ? 'bg-purple-50 font-semibold text-purple-700' : 'text-gray-600 hover:bg-gray-100'}`}>
                        <Icon name={ICONS[c.type] || 'reportes'} className="h-4 w-4 shrink-0" /> <span className="truncate">{c.title}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          {info && (
            <div className="card">
              {info.snapshot ? (
                <p className="flex items-center gap-2 text-sm text-gray-500">
                  <Icon name="reloj" className="h-4 w-4 text-purple-500" /> Muestra la situación en este momento; no depende de un periodo.
                </p>
              ) : (
                <>
                  <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
                    {presets(today).map(([label, f, t]) => {
                      const active = f === from && t === to
                      return (
                        <button key={label} onClick={() => update({ from: f, to: t })}
                          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  {/* El rango de fechas vive en esta misma grilla que ESTADO/MÉTODO DE PAGO
                      (no junto a los botones de arriba): así siempre queda al mismo nivel que
                      el resto de los filtros, en vez de competir por espacio con los presets. */}
                  <div className="mt-3 grid gap-2 border-t border-gray-100 pt-3 sm:grid-cols-2 xl:grid-cols-4">
                    {/* Trae dos inputs de fecha (no uno solo, como ESTADO/MÉTODO DE PAGO) —
                        necesita el doble de ancho o se encima con la celda de al lado. */}
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">Periodo</span>
                      <div className="flex items-center gap-2">
                        <input type="date" aria-label="Desde" className="input h-9 min-w-0 flex-1 py-1 text-sm" value={from} max={to}
                          onChange={(e) => e.target.value && update({ from: e.target.value })} />
                        <span className="shrink-0 text-gray-400">–</span>
                        <input type="date" aria-label="Hasta" className="input h-9 min-w-0 flex-1 py-1 text-sm" value={to} min={from}
                          onChange={(e) => e.target.value && update({ to: e.target.value })} />
                      </div>
                    </label>
                    {info.filters?.map((k) => (
                      <FilterSelect key={k} name={k} type={info.type} value={filters[k]} onChange={(v) => update({ [k]: v })} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {error ? (
            <div className="card text-center py-10">
              <p className="text-gray-700 font-medium">No se pudo generar el reporte</p>
              <p className="text-sm text-gray-500 mt-1">{error}</p>
            </div>
          ) : !report || (loading && report.type !== info?.type) ? (
            <div className="card text-center py-10 text-gray-400 text-sm">Cargando…</div>
          ) : (
            <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              <Metrics metrics={report.metrics} currency={report.currency} />
              {report.charts.length > 0 && <Charts charts={report.charts} />}
              <DataTable report={report} />
              {report.notes.length > 0 && (
                <ul className="space-y-1.5 rounded-xl bg-gray-100/70 p-4 text-xs text-gray-500">
                  {report.notes.map((n) => <li key={n}>· {n}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FilterSelect({ name, type, value, onChange }) {
  const options = name === 'status' ? STATUS_OPTIONS[type]
    : name === 'method' ? METHOD_OPTIONS : name === 'servicio' ? SERVICIO_OPTIONS : MOVEMENT_OPTIONS
  if (!options) return null
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">{FILTER_LABELS[name]}</span>
      <select className="input h-9 py-1 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function Metrics({ metrics, currency }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {metrics.map((m) => (
        <div key={m.key} className="card !p-5">
          <p className="text-sm text-gray-500">{m.label}</p>
          <p className={`mt-1 text-2xl font-bold tracking-tight ${m.format === 'money' && Number(m.value) < 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {fmtValue(m.value, m.format, currency)}
          </p>
          {m.hint && <p className="mt-1.5 text-xs leading-snug text-gray-500">{m.hint}</p>}
        </div>
      ))}
    </div>
  )
}

function Charts({ charts }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {charts.map((c) => {
        const data = c.points.map((p) => {
          const row = { label: p.label }
          c.series.forEach((s, i) => { row[s] = Number(p.values[i] ?? 0) })
          return row
        })
        const barVertical = c.kind === 'bar' && data.length <= 8 && c.series.length === 1
        const wide = c.points.length > 10 || charts.length === 1
        return (
          <div key={c.key} className={`card ${wide ? 'xl:col-span-2' : ''}`}>
            <h3 className="font-semibold text-gray-800 mb-4">{c.title}</h3>
            <ResponsiveContainer width="100%" height={240}>
              {c.kind === 'line' ? (
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(128 128 128 / 0.2)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmtValue(v, c.format)} />
                  {c.series.map((s) => (
                    <Line key={s} type="monotone" dataKey={s} stroke="rgb(var(--brand-600))" strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              ) : (
                <BarChart data={data} layout={barVertical ? 'vertical' : 'horizontal'}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(128 128 128 / 0.2)" />
                  {barVertical ? (
                    <>
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={110} />
                    </>
                  ) : (
                    <>
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                    </>
                  )}
                  <Tooltip formatter={(v) => fmtValue(v, c.format)} />
                  {c.series.map((s) => (
                    <Bar key={s} dataKey={s} fill="rgb(var(--brand-600))" radius={barVertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )
      })}
    </div>
  )
}

function DataTable({ report }) {
  const [sort, setSort] = useState(null)
  useEffect(() => setSort(null), [report.type])
  const rows = useMemo(() => {
    if (!sort) return report.rows
    const col = report.columns.find((c) => c.key === sort.key)
    const numeric = col && ['money', 'count', 'number', 'percent', 'rate'].includes(col.format)
    return [...report.rows].sort((a, b) => {
      const x = a[sort.key]
      const y = b[sort.key]
      if (x == null) return 1
      if (y == null) return -1
      const r = numeric ? Number(x) - Number(y) : String(x).localeCompare(String(y), 'es')
      return sort.dir === 'asc' ? r : -r
    })
  }, [report, sort])
  const totals = report.columns.map((c) => (c.format === 'money' ? report.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0) : null))
  const showTotals = report.rows.length > 1 && totals.some((t) => t !== null) && !report.truncated
  const right = (c) => ['money', 'count', 'number', 'percent', 'rate'].includes(c.format)

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-4">
        <h3 className="font-semibold text-gray-800">Detalle</h3>
        <p className="text-xs text-gray-500">
          {report.truncated ? `Se muestran ${report.rows.length} de ${report.totalRows}: exporta para ver todos` : `${report.totalRows} registro(s)`}
        </p>
      </div>
      {report.rows.length === 0 ? (
        <p className="p-10 text-center text-sm text-gray-500">Sin registros con estos filtros.</p>
      ) : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full min-w-max text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50/95 text-left text-[11px] uppercase tracking-wider text-gray-500 backdrop-blur">
              <tr>
                {report.columns.map((c) => (
                  <th key={c.key} className={`px-4 py-3 font-semibold ${right(c) ? 'text-right' : ''}`}>
                    <button className="inline-flex items-center gap-1 hover:text-gray-800"
                      onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
                      {c.label}
                      {sort?.key === c.key && <span>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50/70">
                  {report.columns.map((c) => (
                    <td key={c.key} className={`whitespace-nowrap px-4 py-2.5 text-gray-700 ${right(c) ? 'text-right tabular-nums' : ''} ${c.format === 'money' && Number(r[c.key]) < 0 ? 'text-red-600' : ''}`}>
                      <span className={c.format === 'text' ? 'block max-w-[260px] truncate' : ''} title={c.format === 'text' ? r[c.key] || '' : undefined}>
                        {fmtValue(r[c.key], c.format, report.currency)}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {showTotals && (
              <tfoot className="sticky bottom-0 bg-gray-50/95 font-semibold backdrop-blur">
                <tr>
                  {report.columns.map((c, i) => (
                    <td key={c.key} className={`whitespace-nowrap px-4 py-3 text-gray-800 ${right(c) ? 'text-right tabular-nums' : ''}`}>
                      {i === 0 ? 'Total' : totals[i] !== null ? fmtValue(Math.round(totals[i] * 100) / 100, 'money', report.currency) : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
