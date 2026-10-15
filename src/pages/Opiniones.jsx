import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getOpiniones } from '../api/opiniones'

const fmtFecha = (d) => (d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '')
const hoy = () => new Date().toISOString().slice(0, 10)
const haceDias = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const estrellasTxt = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—')
const REPORTE = { BIEN: '✅ Llegó bien', MAL: '⚠️ Llegó mal', FALTANTE: '❌ Le faltó algo' }

/**
 * "Opiniones" (sección Reportes): lo que opinan los clientes — visitas al restaurante (por el
 * QR del ticket o desde su cuenta) y reseñas de pedidos web. Promedio general, atención por
 * mesero, platillos con más 👍/👎 y la lista con filtros por fecha y estrellas.
 */
export default function Opiniones() {
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(hoy())
  const [estrellas, setEstrellas] = useState('')
  const [tipo, setTipo] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  function cargar() {
    setError('')
    getOpiniones({ desde, hasta, estrellas: estrellas || undefined })
      .then((r) => setData(r.data.data))
      .catch((err) => setError(err.response?.data?.message ?? 'No se pudieron cargar las opiniones'))
  }
  useEffect(() => { cargar() }, [])

  const filas = (data?.opiniones ?? []).filter((o) => !tipo || o.tipo === tipo)

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-4">⭐ Opiniones</h2>

      <form onSubmit={(e) => { e.preventDefault(); cargar() }} className="card flex flex-wrap items-end gap-3 mb-6">
        <label className="text-xs text-gray-600">Desde<input type="date" className="input mt-1" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="text-xs text-gray-600">Hasta<input type="date" className="input mt-1" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="text-xs text-gray-600">Estrellas
          <select className="input mt-1" value={estrellas} onChange={(e) => setEstrellas(e.target.value)}>
            <option value="">Todas</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">Origen
          <select className="input mt-1" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            <option value="MESA">🍽️ Restaurante</option>
            <option value="WEB">🌐 Pedidos web</option>
          </select>
        </label>
        <button className="btn-primary">Buscar</button>
      </form>

      {error && <p className="text-red-600 mb-4">{error}</p>}
      {!data ? <p className="text-gray-400">Cargando...</p> : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="card text-center">
              <p className="text-xs font-semibold text-gray-500 uppercase">Promedio general</p>
              <p className="text-4xl font-extrabold text-yellow-500 mt-1">{data.total ? data.promedio.toFixed(1) : '—'} <span className="text-2xl">★</span></p>
              <p className="text-sm text-gray-500">{data.total} opinion{data.total === 1 ? '' : 'es'}</p>
            </div>
            <div className="card">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Atención por mesero</p>
              {data.meseros.length === 0 ? <p className="text-sm text-gray-400">Sin calificaciones de atención</p> : (
                <ul className="space-y-1 text-sm">
                  {data.meseros.map((m) => (
                    <li key={m.mesero} className="flex justify-between gap-2">
                      <span className="truncate">{m.mesero}</span>
                      <span className="shrink-0"><span className="text-yellow-500">★</span> {m.promedio.toFixed(1)} <span className="text-gray-400">({m.opiniones})</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Platillos (más 👎 primero)</p>
              {data.platillos.length === 0 ? <p className="text-sm text-gray-400">Sin votos de platillos</p> : (
                <ul className="space-y-1 text-sm max-h-40 overflow-y-auto">
                  {data.platillos.map((p) => (
                    <li key={p.nombre} className="flex justify-between gap-2">
                      <span className="truncate">{p.nombre}</span>
                      <span className="shrink-0">👍 {p.meGusta} · 👎 <span className={p.noMeGusta > 0 ? 'text-red-600 font-semibold' : ''}>{p.noMeGusta}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {filas.length === 0 ? <p className="text-center text-gray-400 py-10">No hay opiniones con esos filtros.</p> : (
            <div className="space-y-3">
              {filas.map((o, i) => (
                <div key={i} className={`card border-l-4 ${o.estrellas <= 2 ? 'border-red-400' : o.estrellas === 3 ? 'border-yellow-400' : 'border-green-400'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{o.tipo === 'MESA' ? '🍽️' : '🌐'} {o.lugar} · <Link to={`/orders/${o.ordenId}`} className="text-purple-700 hover:underline">Orden #{o.ordenId}</Link></p>
                      <p className="text-xs text-gray-500">{fmtFecha(o.fecha)}{o.cliente ? ` · ${o.cliente}` : ''}{o.mesero ? ` · Mesero: ${o.mesero}` : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-yellow-500 text-lg leading-none">{estrellasTxt(o.estrellas)}</p>
                      {o.meseroEstrellas && <p className="text-xs text-gray-500 mt-1">Atención {estrellasTxt(o.meseroEstrellas)}</p>}
                    </div>
                  </div>
                  {o.comentario && <p className="text-sm text-gray-700 italic mt-2">"{o.comentario}"</p>}
                  {o.platillos.length > 0 && <p className="text-sm text-gray-600 mt-1">{o.platillos.map((p) => `${p.meGusta ? '👍' : '👎'} ${p.nombre}`).join(' · ')}</p>}
                  {o.reporte && <p className="text-sm mt-1">{REPORTE[o.reporte] ?? o.reporte}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
