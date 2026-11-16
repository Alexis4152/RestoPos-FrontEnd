import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toPng } from 'html-to-image'
import api from '../api/axios'
import { getCategories } from '../api/categories'
import { getProducts } from '../api/products'
import { getMenus } from '../api/menus'
import { getTiendaInfo } from '../api/tiendas'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { resolveMediaUrl } from '../utils/media'
import MenuHoja, { PLANTILLAS, FORMATOS, colores, plantillaGuardada, guardarPlantilla } from '../components/MenuHoja'

/**
 * "Menú imprimible" (Menú → Menú imprimible): arma un menú con diseño a partir de las
 * categorías y platillos del sistema (plantilla, colores, fotos, columnas), con el QR de la
 * página web para ordenar o reservar. Se descarga como imagen (PNG) o se imprime / guarda en PDF.
 */
export default function MenuImprimible() {
  const { user, isAdmin } = useAuth()
  const { notify } = useNotify()
  const tienda = user?.tienda
  const [categorias, setCategorias] = useState([])
  const [productos, setProductos] = useState([])
  const [info, setInfo] = useState(null)
  const [qr, setQr] = useState(null)
  const [qrError, setQrError] = useState('')
  const [menuHoy, setMenuHoy] = useState(null)
  const [exportando, setExportando] = useState(false)
  const [op, setOp] = useState({
    plantilla: plantillaGuardada(), formato: 'carta', color: tienda?.primaryColor || '#1E4585',
    titulo: tienda?.name ?? 'Nuestro menú', subtitulo: 'Menú', pie: '',
    fotos: true, descripciones: true, columnas: 2, qr: true, ocultas: [],
  })
  const set = (c) => { if (c.plantilla) guardarPlantilla(c.plantilla); setOp((o) => ({ ...o, ...c })) }
  const hoja = useRef(null)
  const contenedor = useRef(null)
  const [escalaVista, setEscalaVista] = useState(0.6)
  const [altoHoja, setAltoHoja] = useState(1056)
  // El alto real de la hoja (crece con los platillos) para reservar el espacio de la vista previa.
  useEffect(() => {
    if (!hoja.current) return undefined
    const ro = new ResizeObserver(() => setAltoHoja(hoja.current?.offsetHeight ?? 1056))
    ro.observe(hoja.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    getCategories().then((r) => setCategorias(r.data.data ?? [])).catch(() => {})
    // Con menú de hoy, solo sus platillos (lo mismo que se puede ordenar); sin él, todo el catálogo.
    Promise.all([getProducts(), getMenus().catch(() => null)]).then(([r, m]) => {
      const hoy = (m?.data?.data ?? []).find((x) => x.hoy)
      setMenuHoy(hoy ?? null)
      const ids = hoy ? new Set(hoy.productoIds) : null
      setProductos((r.data.data ?? []).filter((p) => p.isActive !== false && (!ids || ids.has(p.id))))
    }).catch(() => {})
    if (tienda?.id) {
      getTiendaInfo(tienda.id).then((r) => {
        const i = r.data.data
        setInfo(i)
        const dir = [i?.calle, i?.colonia, i?.localidad].filter(Boolean).join(', ')
        set({ pie: [dir, i?.telefono ? `Tel. ${i.telefono}` : null].filter(Boolean).join(' · ') })
      }).catch(() => {})
    }
    api.get('/menu/qr').then((r) => setQr(r.data.data)).catch((err) => setQrError(err.response?.data?.message ?? 'No se pudo generar el QR'))
  }, [tienda?.id])

  const f = FORMATOS[op.formato]
  const { p, colorLegible } = colores(op.plantilla, op.color)

  // Categorías con sus platillos, en el orden de Categorías (sin las ocultas ni las vacías).
  const secciones = useMemo(() => categorias
    .filter((c) => !op.ocultas.includes(c.id))
    .map((c) => ({ ...c, items: productos.filter((pr) => pr.category?.id === c.id).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((c) => c.items.length > 0), [categorias, productos, op.ocultas])

  // Vista previa escalada al ancho disponible (la hoja real conserva su tamaño para exportar).
  useEffect(() => {
    const calc = () => { if (contenedor.current) setEscalaVista(Math.min(1, (contenedor.current.clientWidth - 8) / f.ancho)) }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [f.ancho])

  async function descargarImagen() {
    setExportando(true)
    try {
      const url = await toPng(hoja.current, { pixelRatio: op.formato === 'carta' ? 2.5 : 1, cacheBust: true, backgroundColor: p.fondo })
      const a = document.createElement('a')
      a.href = url
      a.download = `menu-${(op.titulo || 'restaurante').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
      a.click()
    } catch {
      notify('No se pudo generar la imagen (revisa que las fotos de los platillos carguen)', 'error')
    } finally { setExportando(false) }
  }

  const logo = resolveMediaUrl(tienda?.logoPath)

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          @page { size: ${op.formato === 'carta' ? 'letter' : `${f.ancho}px ${f.alto}px`}; margin: 0; }
          body * { visibility: hidden !important; }
          #menu-hoja, #menu-hoja * { visibility: visible !important; }
          #menu-hoja { position: absolute !important; left: 0; top: 0; transform: none !important; box-shadow: none !important; }
          #menu-escala { transform: none !important; }
          #menu-hoja { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <p className="text-[13px] text-gray-600"><Link to="/menu" className="text-purple-700 hover:underline font-semibold">Menú</Link> › Menú imprimible</p>
          <h1 className="text-[28px] font-extrabold tracking-tight">Menú imprimible</h1>
          <p className="text-sm text-gray-600">
            {menuHoy
              ? <>Se arma solo con el menú de hoy, <b>{menuHoy.nombre}</b>. </>
              : 'Se arma solo con tus categorías y platillos. '}
            Elige el diseño y descárgalo o imprímelo.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => window.print()}>🖨️ Imprimir / PDF</button>
        <button type="button" className="btn-primary" disabled={exportando} onClick={descargarImagen}>{exportando ? 'Generando…' : '⬇️ Descargar imagen'}</button>
      </header>

      <div className="flex flex-wrap gap-5 items-start">
        <aside aria-label="Opciones del menú" className="flex-[1_1_300px] max-w-md bg-white border border-[#E4E1DA] rounded-2xl p-4 space-y-4">
          <div>
            <p className="text-sm font-extrabold mb-1.5">Diseño</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(PLANTILLAS).map(([key, t]) => (
                <button key={key} type="button" aria-pressed={op.plantilla === key} onClick={() => set({ plantilla: key })}
                  className={`rounded-xl border-2 p-2 text-left ${op.plantilla === key ? 'border-purple-600' : 'border-[#E4E1DA]'}`}>
                  <span className="block h-10 rounded-lg mb-1.5 border border-black/10" style={{ background: t.fondo }}>
                    <span className="block h-2 w-1/2 rounded mt-2 ml-2" style={{ background: t.acento ?? op.color }} />
                    <span className="block h-1.5 w-3/4 rounded mt-1.5 ml-2" style={{ background: t.suave, opacity: 0.6 }} />
                  </span>
                  <span className="text-sm font-bold">{t.nombre}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm font-semibold">Formato
            <select className="input mt-1" value={op.formato} onChange={(e) => set({ formato: e.target.value })}>
              {Object.entries(FORMATOS).map(([key, x]) => <option key={key} value={key}>{x.nombre}</option>)}
            </select>
          </label>
          {!p.acento && (
            <label className="flex items-center gap-3 text-sm font-semibold">Color
              <input type="color" value={op.color} onChange={(e) => set({ color: e.target.value })} className="w-12 h-9 rounded border border-[#D9D5CC]" />
            </label>
          )}
          {!p.acento && !colorLegible && (
            <p className="text-xs text-gray-600 -mt-2">Ese color casi no se ve sobre este fondo; usamos uno que contraste.</p>
          )}
          <label className="block text-sm font-semibold">Título
            <input className="input mt-1" maxLength={60} value={op.titulo} onChange={(e) => set({ titulo: e.target.value })} />
          </label>
          <label className="block text-sm font-semibold">Subtítulo
            <input className="input mt-1" maxLength={80} value={op.subtitulo} onChange={(e) => set({ subtitulo: e.target.value })} placeholder="Ej. Cocina del mar" />
          </label>
          <label className="block text-sm font-semibold">Pie de página
            <input className="input mt-1" maxLength={140} value={op.pie} onChange={(e) => set({ pie: e.target.value })} placeholder="Dirección, teléfono, horario…" />
          </label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={op.fotos} onChange={(e) => set({ fotos: e.target.checked })} /> Fotos</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={op.descripciones} onChange={(e) => set({ descripciones: e.target.checked })} /> Descripciones</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={op.qr} disabled={!qr} onChange={(e) => set({ qr: e.target.checked })} /> QR de la página</label>
            <label className="flex items-center gap-2">Columnas
              <select className="input !w-auto !py-1" value={op.columnas} onChange={(e) => set({ columnas: Number(e.target.value) })}>
                <option value={1}>1</option><option value={2}>2</option>
              </select>
            </label>
          </div>
          {qrError && (/página web/i.test(qrError)
            // Falta activar la página web: llevar directo a donde se activa (solo admin entra ahí).
            ? isAdmin
              ? (
                <Link to="/web-config" className="block text-xs text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-lg px-2.5 py-1.5">
                  Para poner el QR en el menú, activa la página web de la tienda.{' '}
                  <span className="font-bold underline whitespace-nowrap">Ir a Página web →</span>
                </Link>
              )
              : <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1.5">Para poner el QR en el menú, pídele al administrador que active la página web de la tienda.</p>
            : <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1.5">{qrError}</p>)}
          <div>
            <p className="text-sm font-extrabold mb-1.5">Categorías</p>
            <div className="flex flex-wrap gap-1.5">
              {categorias.map((c) => {
                const on = !op.ocultas.includes(c.id)
                return (
                  <button key={c.id} type="button" aria-pressed={on}
                    onClick={() => set({ ocultas: on ? [...op.ocultas, c.id] : op.ocultas.filter((x) => x !== c.id) })}
                    className={`px-2.5 py-1 rounded-full text-[13px] font-semibold border ${on ? 'border-purple-600 bg-purple-50 text-purple-800' : 'border-[#D9D5CC] text-gray-500 line-through'}`}>
                    {c.name}
                  </button>
                )
              })}
            </div>
          </div>
        </aside>

        <section aria-label="Vista previa" ref={contenedor} className="flex-[999_1_480px] min-w-0">
          <div style={{ width: f.ancho * escalaVista, height: altoHoja * escalaVista, overflow: 'hidden' }}>
          <div id="menu-escala" style={{ transform: `scale(${escalaVista})`, transformOrigin: 'top left', width: f.ancho }}>
            <MenuHoja id="menu-hoja" ref={hoja} op={op} secciones={secciones} qr={qr} logo={logo} />
          </div>
          </div>
        </section>
      </div>
      {info === null && <span className="sr-only">Cargando datos de la tienda</span>}
    </div>
  )
}
