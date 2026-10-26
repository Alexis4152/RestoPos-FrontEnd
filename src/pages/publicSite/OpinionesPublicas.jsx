import { useEffect, useState } from 'react'
import { getOpinionesPublicas } from '../../api/publicSite'

const fecha = (d) => (d ? new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const Estrellas = ({ n, cls = 'text-base' }) => (
  <span className={`${cls} tracking-tight`} aria-label={`${n} de 5 estrellas`}>
    <span className="text-amber-500">{'★'.repeat(n)}</span><span className="text-gray-300">{'★'.repeat(5 - n)}</span>
  </span>
)

/**
 * Pestaña "Opiniones" de la página web (también se abre con el QR que descarga el restaurante,
 * ?ver=opiniones): promedio, cuántas hay de cada estrella y la lista con las mejores primero.
 */
export default function OpinionesPublicas({ slug, tienda }) {
  const [data, setData] = useState(null)
  const [pagina, setPagina] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    getOpinionesPublicas(slug, pagina).then((r) => setData(r.data.data))
      .catch((err) => setError(err.response?.data?.message ?? 'No se pudieron cargar las opiniones'))
  }, [slug, pagina])

  if (error) return <p className="text-center text-gray-500 py-16">{error}</p>
  if (!data) return <p className="text-center text-gray-400 py-16">Cargando...</p>

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <h2 className="text-2xl font-bold">Lo que opinan de {tienda.nombre}</h2>
      {data.total === 0 ? (
        <p className="text-center text-gray-400 py-12">Todavía no hay opiniones.</p>
      ) : (
        <>
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-wrap gap-6 items-center">
            <div className="text-center min-w-[120px]">
              <p className="text-5xl font-extrabold">{data.promedio.toFixed(1)}</p>
              <Estrellas n={Math.round(data.promedio)} cls="text-xl" />
              <p className="text-sm text-gray-500 mt-1">{data.total} opinion{data.total === 1 ? '' : 'es'}</p>
            </div>
            <div className="flex-1 min-w-[220px] space-y-1.5">
              {data.porEstrellas.map((n, i) => {
                const est = 5 - i
                const pct = data.total ? Math.round((n * 100) / data.total) : 0
                return (
                  <div key={est} className="flex items-center gap-2 text-sm">
                    <span className="w-8 text-right font-semibold">{est} ★</span>
                    <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                      <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-10 text-gray-500">{n}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <ul className="space-y-3">
            {data.opiniones.map((o, i) => (
              <li key={`${pagina}-${i}`} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Estrellas n={o.estrellas} cls="text-lg" />
                  <span className="text-xs text-gray-500">{o.nombre} · {o.origen} · {fecha(o.fecha)}</span>
                </div>
                {o.comentario && <p className="text-gray-800 mt-1.5">"{o.comentario}"</p>}
                {o.leGusto.length > 0 && <p className="text-sm text-gray-600 mt-1.5">👍 Le gustó: {o.leGusto.join(', ')}</p>}
              </li>
            ))}
          </ul>

          {data.paginas > 1 && (
            <nav aria-label="Páginas de opiniones" className="flex items-center justify-between gap-2 text-sm">
              <button type="button" disabled={data.pagina === 0} onClick={() => setPagina(data.pagina - 1)}
                className="px-3 py-1.5 rounded-full border border-gray-300 bg-white font-semibold disabled:opacity-40">← Anterior</button>
              <span className="text-gray-600">Página {data.pagina + 1} de {data.paginas}</span>
              <button type="button" disabled={data.pagina >= data.paginas - 1} onClick={() => setPagina(data.pagina + 1)}
                className="px-3 py-1.5 rounded-full border border-gray-300 bg-white font-semibold disabled:opacity-40">Siguiente →</button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
