import { forwardRef, useEffect, useRef, useState } from 'react'
import { resolveMediaUrl } from '../utils/media'

/**
 * La hoja del menú con diseño (plantilla, colores, fotos, columnas, QR). La usan el "Menú
 * imprimible" (para imprimir / descargar) y la vista previa de "Menú" (para ver cómo va
 * quedando mientras se arma), así las dos se ven idénticas.
 */

export const precio = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n ?? 0))

/**
 * Plantillas de diseño. `acento: null` = usa el color elegido (por defecto el de la tienda).
 * Los colores van en estilos en línea (no clases): así el menú se ve igual en modo oscuro, al
 * imprimir y al exportar a imagen.
 */
export const PLANTILLAS = {
  elegante: { nombre: 'Elegante', fondo: '#FBF7EF', texto: '#2B2520', suave: '#7A6E62', acento: '#A8844B', titulo: 'Georgia, "Times New Roman", serif', cuerpo: 'Georgia, "Times New Roman", serif', guia: 'dotted', mayus: true },
  moderno: { nombre: 'Moderno', fondo: '#FFFFFF', texto: '#111827', suave: '#6B7280', acento: null, titulo: '"Segoe UI", Arial, sans-serif', cuerpo: '"Segoe UI", Arial, sans-serif', guia: 'none', bloque: true },
  rustico: { nombre: 'Rústico', fondo: '#EADBC2', texto: '#3B2A1A', suave: '#6B5236', acento: '#8B4A1C', titulo: 'Georgia, serif', cuerpo: '"Trebuchet MS", Arial, sans-serif', guia: 'dashed', mayus: true },
  noche: { nombre: 'Noche', fondo: '#141414', texto: '#F5F5F4', suave: '#A8A29E', acento: null, titulo: '"Arial Black", Arial, sans-serif', cuerpo: 'Arial, sans-serif', guia: 'dotted' },
}

export const FORMATOS = {
  carta: { nombre: 'Hoja carta (imprimir)', ancho: 816, alto: 1056, escala: 1 },
  pantalla: { nombre: 'Pantalla vertical (TV / redes)', ancho: 1080, alto: 1920, escala: 1.35 },
}

// La última plantilla elegida se recuerda en este navegador (la vista previa y el imprimible usan la misma).
const CLAVE_PLANTILLA = 'restopos.menu.plantilla'
export function plantillaGuardada() {
  try { const v = localStorage.getItem(CLAVE_PLANTILLA); return PLANTILLAS[v] ? v : 'elegante' } catch { return 'elegante' }
}
export function guardarPlantilla(v) {
  try { localStorage.setItem(CLAVE_PLANTILLA, v) } catch { /* sin almacenamiento: no pasa nada */ }
}

// Contraste (WCAG) entre dos colores hex, para que el color elegido siempre se lea sobre el fondo.
export function luminancia(hex) {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')?.[1]
  if (!h) return null
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)]
  if (x == null || y == null) return 0
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Colores finales de una plantilla con el color elegido (si casi no se ve, uno que contraste). */
export function colores(plantilla, color) {
  const p = PLANTILLAS[plantilla] ?? PLANTILLAS.elegante
  const colorLegible = contraste(color, p.fondo) >= 3
  const acento = p.acento ?? (colorLegible ? color : (luminancia(p.fondo) < 0.2 ? '#E9B949' : '#1F2937'))
  const textoSobreAcento = (luminancia(acento) ?? 0) > 0.45 ? '#111111' : '#FFFFFF'
  return { p, acento, textoSobreAcento, colorLegible }
}

/**
 * La hoja en su tamaño real (816 px de ancho en carta). `secciones` = [{ id, name, items }].
 * `op`: plantilla, formato, color, titulo, subtitulo, pie, fotos, descripciones, columnas, qr.
 */
const MenuHoja = forwardRef(function MenuHoja({ op, secciones, qr, logo, id, vacio = 'Elige al menos una categoría con platillos.' }, ref) {
  const { p, acento, textoSobreAcento } = colores(op.plantilla, op.color)
  const f = FORMATOS[op.formato] ?? FORMATOS.carta
  const k = f.escala // tamaño de letra según el formato
  const linea = (estilo) => (estilo === 'none' ? {} : { flex: 1, borderBottom: `2px ${estilo} ${p.suave}`, opacity: 0.5, margin: '0 8px', transform: 'translateY(-5px)' })
  return (
    <div id={id} ref={ref} style={{
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
        {secciones.length === 0 && <p style={{ textAlign: 'center', color: p.suave, fontSize: 18 * k }}>{vacio}</p>}
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
  )
})
export default MenuHoja

/** Muestra la hoja reducida al ancho disponible (la hoja conserva su tamaño real por dentro). */
export function HojaEscalada({ ancho = FORMATOS.carta.ancho, children }) {
  const caja = useRef(null)
  const hoja = useRef(null)
  const [w, setW] = useState(0)
  const [h, setH] = useState(0)
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      setW(caja.current?.clientWidth ?? 0)
      setH(hoja.current?.offsetHeight ?? 0)
    })
    if (caja.current) ro.observe(caja.current)
    if (hoja.current) ro.observe(hoja.current)
    return () => ro.disconnect()
  }, [])
  const s = w ? w / ancho : 0
  return (
    <div ref={caja} className="w-full">
      <div style={{ height: h * s, overflow: 'hidden' }}>
        <div style={{ width: ancho, transform: `scale(${s})`, transformOrigin: 'top left' }}>
          <div ref={hoja}>{children}</div>
        </div>
      </div>
    </div>
  )
}
