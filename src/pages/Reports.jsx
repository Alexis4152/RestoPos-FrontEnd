import { useEffect, useState } from 'react'
import { getSalesSummary, getSalesByDay, getTopProducts, getInventoryStatus } from '../api/reports'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)

// Convierte un objeto Date a 'YYYY-MM-DD' para los inputs de tipo date y los query params.
function toYYYYMMDD(d) { return d.toISOString().slice(0, 10) }

/**
 * Pantalla de "Reportes": muestra estadísticas de ventas e inventario de la tienda del
 * usuario (o de todas si es `SUPER_ADMIN`, según lo que filtre el backend) dentro de un
 * rango de fechas seleccionable. Sirve a todos los roles con la sección `REPORTS` habilitada.
 *
 * Incluye: totales del rango (ventas, transacciones, ticket promedio), una gráfica de
 * ventas por día, una gráfica de los productos más vendidos, y una tabla de productos con
 * stock bajo (esta última no depende del rango de fechas, es el estado actual del inventario).
 *
 * Nota: las filas de `getSalesByDay`/`getTopProducts`/`getInventoryStatus` llegan como
 * arreglos posicionales (ej. `row[1]`, `row[2]`) en vez de objetos con nombres de campo —
 * es el formato en el que el backend devuelve estos reportes agregados.
 */
export default function Reports() {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const [from, setFrom] = useState(toYYYYMMDD(firstOfMonth))
  const [to, setTo] = useState(toYYYYMMDD(today))
  const [summary, setSummary] = useState(null)
  const [byDay, setByDay] = useState([])
  const [topProducts, setTopProducts] = useState([])
  const [inventory, setInventory] = useState(null)
  const [loading, setLoading] = useState(false)

  /**
   * Carga en paralelo los cuatro reportes de la pantalla para el rango [from, to] actual
   * y normaliza las filas posicionales que devuelve el backend a objetos con nombres de
   * campo, listos para alimentar las gráficas de Recharts (`byDay`, `topProducts`).
   * Se invoca al montar el componente y cada vez que el usuario pulsa "Aplicar".
   */
  function load() {
    setLoading(true)
    Promise.all([
      getSalesSummary(from, to),
      getSalesByDay(from, to),
      getTopProducts(from, to, 8),
      getInventoryStatus(),
    ]).then(([s, d, t, inv]) => {
      setSummary(s.data.data)
      setByDay((d.data.data ?? []).map((row) => ({ date: String(row[0]).slice(5), total: Number(row[1]) })))
      setTopProducts((t.data.data ?? []).map((row) => ({ name: String(row[0]).slice(0, 20), qty: Number(row[1]), revenue: Number(row[2]) })))
      setInventory(inv.data.data)
    }).finally(() => setLoading(false))
  }

  // Carga inicial con el rango por defecto (mes en curso a hoy).
  useEffect(() => { load() }, [])

  return (
    <div>
      <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900 mb-6">Reportes</h1>

      {/* Date filter */}
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Desde</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Hasta</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={load} disabled={loading}>{loading ? '...' : 'Aplicar'}</button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total ventas', value: fmt(summary.totalSales), color: 'text-purple-700' },
            { label: 'Transacciones', value: summary.totalTransactions, color: 'text-blue-600' },
            { label: 'Ticket promedio', value: fmt(summary.averageTicket), color: 'text-green-600' },
          ].map((s) => (
            <div key={s.label} className="card">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Sales by day */}
        <div className="card">
          <h3 className="font-semibold text-gray-800 mb-4">Ventas por día</h3>
          {byDay.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => fmt(v)} />
                <Bar dataKey="total" fill="rgb(var(--brand-600))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-400 text-sm text-center py-8">Sin datos</p>}
        </div>

        {/* Top products */}
        <div className="card">
          <h3 className="font-semibold text-gray-800 mb-4">Productos más vendidos</h3>
          {topProducts.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Bar dataKey="qty" fill="rgb(var(--brand-700))" radius={[0, 4, 4, 0]} name="Unidades" />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-400 text-sm text-center py-8">Sin datos</p>}
        </div>
      </div>

      {/* Low stock */}
      {inventory?.lowStockProducts?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-800 mb-4">⚠️ Productos con stock bajo</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead className="border-b border-gray-100">
                <tr>
                  {['Producto', 'Stock actual', 'Stock mínimo'].map((h) => (
                    <th key={h} className="text-left py-2 font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {inventory.lowStockProducts.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 text-gray-800">{p.name}</td>
                    <td className="py-2 font-semibold text-red-600">{p.stock}</td>
                    <td className="py-2 text-gray-500">{p.minStock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
