// Genera src/styles/dark.css: el modo oscuro de la app SIN tocar cada componente.
//
// Recorre src/ buscando las clases de color que realmente se usan (bg-white, text-gray-700,
// border-[#E4E1DA], hover:bg-red-50, lg:bg-[#F4F3EF]...) y escribe, para cada una, una regla
// `html.dark .clase { ... }` con su equivalente oscuro:
//   - fondos claros  → superficies oscuras (mismo matiz, poco saturadas);
//   - textos oscuros → textos claros;
//   - bordes claros  → bordes oscuros;
//   - fondos sólidos (botones bg-red-600, bg-[#24519E]...) se quedan igual.
// El color de marca (purple-*/primary-*) NO pasa por aquí: sus variables --brand-* se
// recalculan para oscuro en src/utils/theme.js.
//
// Uso: `npm run gen:dark` (volver a correrlo al agregar colores nuevos; el build también lo corre).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import colors from 'tailwindcss/colors.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const OUT = path.join(SRC, 'styles', 'dark.css')

// Páginas públicas (sitio de la tienda, opiniones): siempre en claro, no se escanean.
const EXCLUIR = [/PublicSite\.jsx$/, /[\\/]publicSite[\\/]/, /OpinionPage\.jsx$/]

// ── Colores ────────────────────────────────────────────────────────────────────────────
const hexToRgb = (hex) => {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  return [h * 360, s * 100, l * 100]
}
function hsl(h, s, l) {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
  return [f(0), f(8), f(4)]
}
const css = ([r, g, b], alpha) => (alpha == null ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`)

// Neutros oscuros cálidos (combinan con el #F4F3EF del modo claro).
const N = {
  canvas: '#141412', surface: '#1C1C1A', raised: '#22221F', muted: '#2A2926', soft: '#33322E', strong: '#3D3C38',
}
// Escalas grises de Tailwind (gray, stone, slate...): mapeo explícito por propiedad.
const GRIS = {
  bg: { 50: '#20201D', 100: '#262623', 200: '#302F2B', 300: '#3C3B36', 400: '#55534D', 500: '#6E6C66', 600: '#5E5C56', 700: '#4E4D48', 800: '#44433E', 900: '#3A3935', 950: '#302F2C' },
  text: { 50: '#2A2A27', 100: '#3A3935', 200: '#4E4C47', 300: '#6A6862', 400: '#8A877F', 500: '#A29F98', 600: '#BAB7B0', 700: '#D3D1CB', 800: '#E6E4DF', 900: '#F2F1EE', 950: '#F7F6F3' },
  border: { 50: '#262623', 100: '#2C2B28', 200: '#363531', 300: '#45433E', 400: '#57554F', 500: '#6E6C66', 600: '#7E7C75', 700: '#8E8B84', 800: '#9E9B94', 900: '#AEABA4', 950: '#BEBBB4' },
}
const GRISES = ['gray', 'stone', 'slate', 'zinc', 'neutral']

/** Equivalente oscuro de un color según dónde se usa ('bg' | 'text' | 'border'); null = igual. */
function oscuro(rgb, prop) {
  const [h, s, l] = rgbToHsl(rgb)
  // Neutro por croma (no por saturación HSL, que se dispara cerca del blanco: #F4F3EF sale 19%).
  const neutro = Math.max(...rgb) - Math.min(...rgb) < 14
  if (prop === 'bg') {
    if (l < 80) return null // fondo sólido (botón, badge fuerte): se queda
    // El fondo general de la app (#F4F3EF) es lo más oscuro; tarjetas y paneles van encima.
    if (rgb.join() === '244,243,239') return hexToRgb(N.canvas)
    if (neutro) return hexToRgb(l >= 99 ? N.surface : l >= 97.5 ? '#191917' : l >= 96 ? N.raised : l >= 93 ? N.muted : l >= 90 ? N.soft : N.strong)
    return hsl(h, Math.min(s, 70) * 0.45, l >= 96 ? 15 : l >= 92 ? 18 : l >= 86 ? 22 : 28)
  }
  if (prop === 'text') {
    if (l > 62) return null // texto ya claro (sobre fondos sólidos): se queda
    if (neutro) return hsl(h, s, l < 25 ? 93 : l < 40 ? 84 : 72)
    return hsl(h, Math.min(s, 75) * 0.85, l < 30 ? 80 : l < 45 ? 74 : 68)
  }
  // border / divide / ring
  if (l < 60) return null
  if (neutro) return hexToRgb(l >= 93 ? '#2E2D2A' : l >= 85 ? '#3A3935' : '#4A4843')
  return hsl(h, Math.min(s, 70) * 0.4, l >= 88 ? 26 : l >= 78 ? 32 : 40)
}

function valorPaleta(nombre, tono, prop) {
  if (nombre === 'white') {
    if (prop === 'text') return null
    return hexToRgb(N.surface)
  }
  if (GRISES.includes(nombre)) {
    const tabla = GRIS[prop === 'text' ? 'text' : prop === 'bg' ? 'bg' : 'border']
    return tabla[tono] ? hexToRgb(tabla[tono]) : null
  }
  const pal = colors[nombre]
  if (!pal || typeof pal !== 'object' || !pal[tono]) return null
  const base = hexToRgb(pal[tono])
  if (prop === 'bg' && Number(tono) >= 300) return null
  if (prop === 'text' && Number(tono) <= 300) return null
  if (prop === 'border' && Number(tono) >= 400) return null
  return oscuro(base, prop) ?? (prop === 'bg'
    ? hsl(rgbToHsl(base)[0], rgbToHsl(base)[1] * 0.45, 18)
    : null)
}

// ── Escaneo ────────────────────────────────────────────────────────────────────────────
function archivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return archivos(p)
    return /\.(jsx?|css)$/.test(e.name) && !EXCLUIR.some((r) => r.test(p)) && !p.endsWith(`styles${path.sep}dark.css`) ? [p] : []
  })
}
const OBSOLETAS = ['lightBlue', 'warmGray', 'trueGray', 'coolGray', 'blueGray']
const PALETAS = Object.keys(colors).filter((k) => !OBSOLETAS.includes(k) && typeof colors[k] === 'object' && !['purple', 'primary'].includes(k))
const RE = new RegExp(
  String.raw`(?<![\w-])((?:[a-z-]+:)*)(bg|text|border(?:-[trblxy])?|divide|ring|placeholder)-` +
  String.raw`(?:(white)|(${PALETAS.join('|')})-(\d{2,3})|\[(#[0-9A-Fa-f]{3,8})\])(?:\/(\d{1,3}))?(?![\w-])`, 'g')

const VARIANTES = {
  hover: (s) => `${s}:hover`, focus: (s) => `${s}:focus`, 'focus-visible': (s) => `${s}:focus-visible`,
  'focus-within': (s) => `${s}:focus-within`, active: (s) => `${s}:active`, disabled: (s) => `${s}:disabled`,
  'group-hover': (s) => `.group:hover ${s}`, odd: (s) => `${s}:nth-child(odd)`, even: (s) => `${s}:nth-child(even)`,
}
const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 }
const esc = (c) => c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)

const reglas = new Map() // "@media..|selector" -> declaración
for (const f of archivos(SRC)) {
  const texto = fs.readFileSync(f, 'utf8')
  for (const m of texto.matchAll(RE)) {
    const [clase, prefijos, propRaw, white, pal, tono, hex, op] = m
    const vars = prefijos ? prefijos.slice(0, -1).split(':') : []
    let media = null
    let soportado = true
    let sel = `.${esc(clase)}`
    for (const v of vars.reverse()) {
      if (BREAKPOINTS[v]) media = `@media (min-width: ${BREAKPOINTS[v]}px)`
      else if (VARIANTES[v]) sel = VARIANTES[v](sel)
      else soportado = false
    }
    if (!soportado) continue
    const prop = propRaw.startsWith('border') || propRaw === 'divide' || propRaw === 'ring' ? 'border'
      : propRaw === 'placeholder' ? 'text' : propRaw
    const rgb = hex ? oscuro(hexToRgb(hex), prop) : valorPaleta(white ? 'white' : pal, tono, prop)
    if (!rgb) continue
    const alpha = op ? Number(op) / 100 : null
    const color = css(rgb, alpha)
    let decl
    if (propRaw === 'bg') decl = `background-color: ${color}`
    else if (propRaw === 'text') decl = `color: ${color}`
    else if (propRaw === 'placeholder') { sel = `${sel}::placeholder`; decl = `color: ${color}` }
    else if (propRaw === 'divide') { sel = `${sel} > :not([hidden]) ~ :not([hidden])`; decl = `border-color: ${color}` }
    else if (propRaw === 'ring') decl = `--tw-ring-color: ${color}`
    else decl = `border-color: ${color}`
    reglas.set(`${media ?? ''}|html.dark ${sel}`, decl)
  }
}

// ── Salida ─────────────────────────────────────────────────────────────────────────────
const planas = []
const porMedia = new Map()
for (const [k, decl] of [...reglas].sort(([a], [b]) => a.localeCompare(b))) {
  const [media, sel] = k.split('|')
  const linea = `${sel} { ${decl} }`
  if (!media) planas.push(linea)
  else porMedia.set(media, [...(porMedia.get(media) ?? []), `  ${linea}`])
}
const medias = Object.values(BREAKPOINTS).map((px) => `@media (min-width: ${px}px)`).filter((m) => porMedia.has(m))
const salida = [
  '/* GENERADO por scripts/gen-dark-css.mjs — no editar a mano (npm run gen:dark). */',
  `/* ${reglas.size} reglas para el modo oscuro (html.dark). */`,
  ...planas,
  ...medias.flatMap((m) => [`${m} {`, ...porMedia.get(m), '}']),
  '',
].join('\n')
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, salida)
console.log(`dark.css: ${reglas.size} reglas`)
