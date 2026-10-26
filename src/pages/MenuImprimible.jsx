import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toPng } from 'html-to-image'
import api from '../api/axios'
import { getCategories } from '../api/categories'
import { getProducts } from '../api/products'
import { getTiendaInfo } from '../api/tiendas'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { resolveMediaUrl } from '../utils/media'

const precio = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n ?? 0))

/**
 * Plantillas de diseño. `acento: null` = usa el color elegido (por defecto el de la tienda).
 * Los colores van en estilos en línea (no clases): así el menú se ve igual en modo oscuro, al
 * imprimir y al exportar a imagen.
 */
const PLANTILLAS = {
  elegante: { nombre: 'Elegante', fondo: '#FBF7EF', texto: '#2B2520', suave: '#7A6E62', acento: '#A8844B', titulo: 'Georgia, "Times New Roman", serif', cuerpo: 'Georgia, "Times New Roman", serif', guia: 'dotted', mayus: true },
  moderno: { nombre: 'Moderno', fondo: '#FFFFFF', texto: '#111827', suave: '#6B7280', acento: null, titulo: '"Segoe UI", Arial, sans-serif', cuerpo: '"Segoe UI", Arial, sans-serif', guia: 'none', bloque: true },
  rustico: { nombre: 'Rústico', fondo: '#EADBC2', texto: '#3B2A1A', suave: '#6B5236', acento: '#8B4A1C', titulo: 'Georgia, serif', cuerpo: '"Trebuchet MS", Arial, sans-serif', guia: 'dashed', mayus: true },
  noche: { nombre: 'Noche', fondo: '#141414', texto: '#F5F5F4', suave: '#A8A29E', acento: null, titulo: '"Arial Black", Arial, sans-serif', cuerpo: 'Arial, sans-serif', guia: 'dotted' },
}
// Contraste (WCAG) entre dos colores hex, para que el color elegido siempre se lea sobre el fondo.
function luminancia(hex) {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')?.[1]
  if (!h) return null
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)]
  if (x == null || y == null) return 0
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const FORMATOS = {
  carta: { nombre: 'Hoja carta (imprimir)', ancho: 816, alto: 1056, escala: 1 },
  pantalla: { nombre: 'Pantalla vertical (TV / redes)', ancho: 1080, alto: 1920, escala: 1.35 },
}

/**
 * "Menú imprimible" (Menú → Menú imprimible): arma un menú con diseño a partir de las
 * categorías y platillos del sistema (plantilla, colores, fotos, columnas), con el QR de la
 * página web para ordenar o reservar. Se descarga como imagen (PNG) o se imprime / guarda en PDF.
 */
export default function MenuImprimible() {
  const { user } = useAuth()
  const { notify } = useNotify()
  const tienda = user?.tienda
  const [categorias, setCategorias] = useState([])
  const [productos, setProductos] = useState([])
  const [info, setInfo] = useState(null)
  const [qr, setQr] = useState(null)
  const [qrError, setQrError] = useState('')
  const [exportando, setExportando] = useState(false)
  const [op, setOp] = useState({
    plantilla: 'elegante', formato: 'carta', color: tienda?.primaryColor || '#1E4585',
    titulo: tienda?.name ?? 'Nuestro menú', subtitulo: 'Menú', pie: '',
    fotos: true, descripciones: true, columnas: 2, qr: true, ocultas: [],
  })
  const set = (c) => setOp((o) => ({ ...o, ...c }))
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
    getProducts().then((r) => setProductos((r.data.data ?? []).filter((p) => p.isActive !== false))).catch(() => {})
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

  const p = PLANTILLAS[op.plantilla]
  const f = FORMATOS[op.formato]
  // Si el color elegido casi no se ve sobre el fondo de la plantilla, se usa uno que sí contraste.
  const colorLegible = contraste(op.color, p.fondo) >= 3
  const acento = p.acento ?? (colorLegible ? op.color : (luminancia(p.fondo) < 0.2 ? '#E9B949' : '#1F2937'))
  const textoSobreAcento = (luminancia(acento) ?? 0) > 0.45 ? '#111111' : '#FFFFFF'
  const k = f.escala // tamaño de letra según el formato

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
  const linea = (estilo) => (estilo === 'none' ? {} : { flex: 1, borderBottom: `2px ${estilo} ${p.suave}`, opacity: 0.5, margin: '0 8px', transform: 'translateY(-5px)' })

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
          <p className="text-sm text-gray-600">Se arma solo con tus categorías y platillos. Elige el diseño y descárgalo o imprímelo.</p>
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
          {qrError && <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1.5">{qrError}</p>}
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
            <div id="menu-hoja" ref={hoja} style={{
              width: f.ancho, minHeight: f.alto, background: p.fondo, color: p.texto, fontFamily: p.cuerpo,
              padding: `${48 * k}px ${44 * k}px`, boxSizing: 'border-box', boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
              display: 'flex', flexDirection: 'column',
            }}>
              {/* Encabezado */}
              <div style={{ textAlign: 'center', marginBottom: 28 * k }}>
                {logo && <img src={logo} crossOrigin="anonymous" alt="" style={{ width: 84 * k, height: 84 * k, objectFit: 'cover', borderRadius: '50%', margin: '0 auto 10px', display: 'block' }} />}
                <div style={{ fontFamily: p.titulo, fontSize: 40 * k, fontWeight: 800, letterSpacing: p.mayus ? 3 : 0, textTransform: p.mayus ? 'uppercase' : 'none', lineHeight: 1.1 }}>{op.titulo}</div>
                {op.subtitulo && <div style={{ color: acento, fontSize: 17 * k, marginTop: 6, letterSpacing: 4, textTransform: 'uppercase' }}>{op.subtitulo}</div>}
                <div style={{ width: 90 * k, height: 3, background: acento, margin: `${14 * k}px auto 0`, borderRadius: 2 }} />
              </div>

              {/* Secciones */}
              <div style={{ columnCount: op.columnas, columnGap: 40 * k, flex: 1 }}>
                {secciones.map((c) => (
                  <div key={c.id} data-categoria style={{ marginBottom: 26 * k }}>
                    <div style={p.bloque
                      ? { background: acento, color: textoSobreAcento, fontFamily: p.titulo, fontWeight: 800, fontSize: 19 * k, padding: `${6 * k}px ${12 * k}px`, borderRadius: 8, marginBottom: 12 * k, breakAfter: 'avoid', breakInside: 'avoid' }
                      : { color: acento, fontFamily: p.titulo, fontWeight: 800, fontSize: 21 * k, letterSpacing: p.mayus ? 2 : 0, textTransform: p.mayus ? 'uppercase' : 'none', borderBottom: `2px solid ${acento}`, paddingBottom: 4, marginBottom: 12 * k, breakAfter: 'avoid', breakInside: 'avoid' }}>
                      {c.name}
                    </div>
                    {c.items.map((pr) => (
                      <div key={pr.id} style={{ display: 'flex', gap: 10 * k, alignItems: 'flex-start', marginBottom: 11 * k, breakInside: 'avoid' }}>
                        {op.fotos && pr.imageUrl && (
                          <img src={resolveMediaUrl(pr.imageUrl)} crossOrigin="anonymous" alt=""
                            style={{ width: 56 * k, height: 56 * k, objectFit: 'cover', borderRadius: p.bloque ? 10 : 6, flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline' }}>
                            <span style={{ fontWeight: 700, fontSize: 15.5 * k }}>{pr.name}</span>
                            <span style={linea(p.guia)} />
                            {p.guia === 'none' && <span style={{ flex: 1 }} />}
                            <span style={{ fontWeight: 800, fontSize: 15.5 * k, color: p.bloque ? acento : p.texto, whiteSpace: 'nowrap' }}>{precio(pr.price)}</span>
                          </div>
                          {op.descripciones && pr.description && (
                            <div style={{ color: p.suave, fontSize: 12.5 * k, marginTop: 2, lineHeight: 1.35 }}>{pr.description}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                {secciones.length === 0 && <p style={{ textAlign: 'center', color: p.suave }}>Elige al menos una categoría con platillos.</p>}
              </div>

              {/* Pie: QR + datos */}
              {(op.qr && qr) || op.pie ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 * k, borderTop: `1px solid ${p.suave}55`, paddingTop: 16 * k, marginTop: 10 * k }}>
                  {op.qr && qr && (
                    <div style={{ background: '#fff', padding: 6, borderRadius: 8, flexShrink: 0 }}>
                      <img src={qr.qrDataUrl} alt="" style={{ width: 96 * k, height: 96 * k, display: 'block' }} />
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    {op.qr && qr && <div style={{ fontWeight: 800, fontSize: 15 * k, color: acento }}>Escanea para ordenar, reservar o ver el menú</div>}
                    {op.pie && <div style={{ color: p.suave, fontSize: 12.5 * k, marginTop: 4 }}>{op.pie}</div>}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          </div>
        </section>
      </div>
      {info === null && <span className="sr-only">Cargando datos de la tienda</span>}
    </div>
  )
}
