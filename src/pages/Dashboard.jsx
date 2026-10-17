import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSalesSummary } from '../api/reports'
import { getOpenCashCut } from '../api/cashCuts'
import { searchProducts } from '../api/products'

/**
 * Tarjeta de indicador (KPI) reutilizada por el Dashboard para mostrar un valor
 * destacado (ej. ventas del mes) con una etiqueta y, opcionalmente, un subtítulo.
 */
function StatCard({ label, value, sub, color }) {
  return (
    <div className="card">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// Formatea un número como moneda MXN para mostrarlo en las tarjetas de indicadores.
function fmt(n) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
}

/**
 * Pantalla de inicio ("Dashboard") con un resumen general del estado de la tienda del
 * usuario en sesión (o de todas las tiendas si es `SUPER_ADMIN`, según lo que el backend
 * decida filtrar). Sirve a todos los roles con la sección `DASHBOARD` habilitada.
 *
 * Muestra cuatro indicadores: ventas totales del mes en curso, ticket promedio, si hay
 * un corte de caja abierto en este momento, y cantidad de productos con stock bajo; además
 * de accesos rápidos a Punto de Venta, Inventario y Reportes.
 *
 * Cada indicador se obtiene de un endpoint distinto y se cargan en paralelo (no bloqueante
 * entre sí); si alguno falla, simplemente no se muestra su valor (los `.catch(() => {})`
 * evitan que un error en un indicador tumbe a los demás).
 */
export default function Dashboard() {
  const [summary, setSummary] = useState(null)
  const [cashCut, setCashCut] = useState(null)
  const [lowStock, setLowStock] = useState(0)

  useEffect(() => {
    // Rango de fechas fijo: del día 1 del mes actual a hoy, para el resumen de ventas del mes.
    const today = new Date().toISOString().slice(0, 10)
    const firstOfMonth = today.slice(0, 8) + '01'

    getSalesSummary(firstOfMonth, today)
      .then((r) => setSummary(r.data.data))
      .catch(() => {})

    // Corte de caja abierto (si existe) en este momento, para el indicador "Corte de caja".
    getOpenCashCut()
      .then((r) => setCashCut(r.data.data))
      .catch(() => {})

    // Solo se usa el conteo de resultados (no la lista completa) para el indicador de
    // stock bajo; el size:200 es un límite práctico para no traer más de lo necesario.
    searchProducts({ lowStock: true, size: 200 })
      .then((r) => setLowStock(r.data.data?.length ?? 0))
      .catch(() => {})
  }, [])

  return (
    <div>
      <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900 mb-6">Inicio</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Ingresos del mes"
          value={fmt(summary?.totalSales)}
          sub={`${summary?.totalTransactions ?? 0} transacciones`}
          color="text-purple-700"
        />
        <StatCard
          label="Ticket promedio"
          value={fmt(summary?.averageTicket)}
          color="text-blue-600"
        />
        <StatCard
          label="Corte de caja"
          value={cashCut ? 'Abierto' : 'Cerrado'}
          sub={cashCut ? `Desde ${new Date(cashCut.openedAt).toLocaleString('es-MX')}` : ''}
          color={cashCut ? 'text-green-600' : 'text-gray-400'}
        />
        <StatCard
          label="Stock bajo"
          value={lowStock}
          sub="productos con bajo inventario"
          color={lowStock > 0 ? 'text-red-600' : 'text-green-600'}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/tables" className="card hover:shadow-md transition-shadow flex items-center gap-4 cursor-pointer">
          <span className="text-3xl">🍽️</span>
          <div>
            <p className="font-semibold text-gray-900">Mesas</p>
            <p className="text-sm text-gray-500">Ver el salón y tomar órdenes</p>
          </div>
        </Link>
        <Link to="/menu" className="card hover:shadow-md transition-shadow flex items-center gap-4 cursor-pointer">
          <span className="text-3xl">📖</span>
          <div>
            <p className="font-semibold text-gray-900">Menú</p>
            <p className="text-sm text-gray-500">Gestionar platillos</p>
          </div>
        </Link>
        <Link to="/reports" className="card hover:shadow-md transition-shadow flex items-center gap-4 cursor-pointer">
          <span className="text-3xl">📈</span>
          <div>
            <p className="font-semibold text-gray-900">Reportes</p>
            <p className="text-sm text-gray-500">Ver estadísticas</p>
          </div>
        </Link>
      </div>
    </div>
  )
}
