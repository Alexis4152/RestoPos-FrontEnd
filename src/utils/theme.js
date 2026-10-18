// A partir de UN solo color elegido por el admin de la tienda, genera una rampa de
// tonos (claro→oscuro) y la aplica como variables CSS — así el resto de la app
// (que ya usa clases purple-50..900 de Tailwind) cambia de color sin tocar cada archivo.

const NEXORA_BLUE = '#155dea'

const RAMP_KEYS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]

// Cuánto se aleja cada tono de la lightness del color base (que se usa como el 600,
// el tono "principal" — botones, nav activo). Positivo = más claro, negativo = más oscuro.
const LIGHTNESS_OFFSET = {
  50: 45,
  100: 38,
  200: 28,
  300: 18,
  400: 9,
  500: 4,
  600: 0,
  700: -10,
  800: -18,
  900: -26,
}

/**
 * Convierte un color hex (`#rrggbb`) a su representación HSL.
 * @param {string} hex Color en formato hex de 6 dígitos (ej. '#155dea').
 * @returns {{h: number, s: number, l: number}} Matiz (0-360), saturación y luminosidad (0-100).
 */
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h /= 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

/**
 * Convierte un color HSL a su representación hex (`#rrggbb`).
 * @param {number} h Matiz (0-360).
 * @param {number} s Saturación (0-100).
 * @param {number} l Luminosidad (0-100).
 * @returns {string} Color en formato hex de 6 dígitos.
 */
function hslToHex(h, s, l) {
  s /= 100
  l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (n) => Math.round(f(n) * 255).toString(16).padStart(2, '0')
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`
}

/**
 * Restringe un número a un rango `[min, max]`.
 * @param {number} n Valor a acotar.
 * @param {number} min Límite inferior.
 * @param {number} max Límite superior.
 * @returns {number} `n` acotado al rango dado.
 */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

/**
 * Valida que un string sea un color hex de 6 dígitos (ej. '#155dea').
 * Se usa para descartar colores mal formados antes de generar una rampa
 * (ej. datos corruptos de una tienda), cayendo en ese caso al azul Nexora por defecto.
 * @param {string} hex Valor a validar.
 * @returns {boolean} `true` si `hex` tiene el formato `#rrggbb` válido.
 */
export function isValidHex(hex) {
  return /^#[0-9A-Fa-f]{6}$/.test(hex)
}

// "21 93 234" (espacio, no coma) — formato que necesita Tailwind para poder
// aplicar opacidad con rgb(var(--x) / <alpha>), ej. bg-purple-600/20.
/**
 * Convierte un color hex a su terna RGB en formato "R G B" (espacios, sin comas).
 * @param {string} hex Color en formato hex de 6 dígitos.
 * @returns {string} Terna RGB como string, ej. '21 93 234'.
 */
function hexToRgbTriplet(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r} ${g} ${b}`
}

// Devuelve { 50: '21 93 234', 100: '...', ..., 900: '...' } listo para variables CSS
/**
 * Genera, a partir de un único color base, una rampa completa de 10 tonos (50 a 900,
 * estilo Tailwind) variando la luminosidad del mismo matiz/saturación. El tono 600
 * corresponde exactamente al color base (es el color "principal": botones, nav activo).
 * @param {string} baseHex Color primario elegido por la tienda, en formato hex.
 * @returns {Object<number, string>} Mapa `{ 50: 'R G B', 100: 'R G B', ..., 900: 'R G B' }`
 * listo para asignarse a variables CSS.
 */
export function generateRamp(baseHex) {
  const { h, s, l } = hexToHsl(baseHex)
  const ramp = {}
  for (const key of RAMP_KEYS) {
    const targetL = clamp(l + LIGHTNESS_OFFSET[key], 4, 97)
    const hex = key === 600 ? baseHex : hslToHex(h, s, targetL)
    ramp[key] = hexToRgbTriplet(hex)
  }
  return ramp
}

// Modo oscuro: la rampa se invierte (los tonos 50-200, que en claro son fondos suaves como
// "seleccionado", pasan a ser fondos oscuros del mismo matiz; 700-900, que en claro son
// textos fuertes, pasan a ser claros). El 600 (botones, nav activo) es el color de la
// tienda, acotado a una luminosidad que se vea sobre fondo oscuro: una marca negra o muy
// oscura se aclara lo justo, una muy clara se oscurece para que el texto blanco se lea.
const DARK_LIGHTNESS = { 50: 15, 100: 19, 200: 26, 300: 34, 400: 44, 500: 50, 700: 66, 800: 76, 900: 84 }

/**
 * Rampa de la marca para modo oscuro (mismo formato que `generateRamp`).
 * @param {string} baseHex Color primario de la tienda.
 * @returns {Object<number, string>} `{ 50: 'R G B', ..., 900: 'R G B' }`.
 */
export function generateDarkRamp(baseHex) {
  const { h, s, l } = hexToHsl(baseHex)
  // Sin saturación (negro/gris): los fondos suaves quedan grises neutros, no de un matiz al azar.
  const sat = s < 8 ? 0 : s
  // Marca negra/gris: botón gris oscuro (se distingue del fondo y el texto blanco se lee);
  // con color, la luminosidad se acota para que destaque sin perder contraste.
  const base = sat === 0 ? 34 : clamp(l, 42, 56)
  const ramp = {}
  for (const key of RAMP_KEYS) {
    const targetL = key === 600 ? base : DARK_LIGHTNESS[key]
    const satKey = key <= 200 ? sat * 0.55 : sat
    ramp[key] = hexToRgbTriplet(hslToHex(h, satKey, targetL))
  }
  return ramp
}

// Color de marca vigente y si va en oscuro — para recalcular la rampa al cambiar de modo
// sin volver a pedir el color de la tienda (ver setBrandDark).
let marcaActual = { base: NEXORA_BLUE, sidebarBg: '#050b18', sidebarBorder: '#0d1b3d' }
let marcaOscura = false

function aplicarMarca() {
  const { base, sidebarBg, sidebarBorder } = marcaActual
  applyRampToRoot(marcaOscura ? generateDarkRamp(base) : generateRamp(base), sidebarBg, sidebarBorder)
}

/**
 * Cambia la rampa de marca entre la versión clara y la oscura (la llama el modo de pantalla,
 * ver utils/themeMode.js). No cambia el color elegido por la tienda.
 * @param {boolean} oscuro true = modo oscuro.
 */
export function setBrandDark(oscuro) {
  if (marcaOscura === oscuro) return
  marcaOscura = oscuro
  aplicarMarca()
}

/**
 * Inyecta una rampa de colores (y los tonos de la barra lateral) como variables CSS
 * en `document.documentElement`, para que el resto de la app (vía clases Tailwind
 * arbitrarias como `bg-[var(--brand-600)]`) tome el color de marca actual.
 * @param {Object<number, string>} ramp Rampa generada por `generateRamp` (`{50: 'R G B', ...}`).
 * @param {string} sidebarBg Color de fondo de la barra lateral, en formato hex.
 * @param {string} sidebarBorder Color de borde de la barra lateral, en formato hex.
 */
function applyRampToRoot(ramp, sidebarBg, sidebarBorder) {
  const root = document.documentElement
  for (const key of RAMP_KEYS) {
    root.style.setProperty(`--brand-${key}`, ramp[key])
  }
  root.style.setProperty('--brand-sidebar', sidebarBg)
  root.style.setProperty('--brand-sidebar-border', sidebarBorder)
}

// SUPER_ADMIN y el login siempre usan el azul Nexora fijo, sin importar
// el color que cualquier tienda haya elegido.
/**
 * Aplica el tema de marca por defecto (azul Nexora fijo) al documento. Se usa en la
 * pantalla de login (antes de saber a qué tienda pertenece el usuario) y para
 * SUPER_ADMIN, que no tiene tienda asociada y por lo tanto no tiene un color propio.
 */
export function applyDefaultBrand() {
  marcaActual = { base: NEXORA_BLUE, sidebarBg: '#050b18', sidebarBorder: '#0d1b3d' }
  aplicarMarca()
}

/**
 * Aplica el tema de marca de una tienda específica al documento, generando su rampa
 * de colores y un fondo/borde de barra lateral acordes al mismo matiz. Si `primaryColor`
 * no es un hex válido, cae de vuelta al azul Nexora por defecto.
 * @param {string} primaryColor Color primario de la tienda, en formato hex.
 */
export function applyTiendaBrand(primaryColor) {
  const base = isValidHex(primaryColor) ? primaryColor : NEXORA_BLUE
  const { h } = hexToHsl(base)
  // sidebar oscuro derivado del mismo tono, para que se sienta parte de la misma paleta
  marcaActual = { base, sidebarBg: hslToHex(h, 45, 6), sidebarBorder: hslToHex(h, 45, 14) }
  aplicarMarca()
}

export { NEXORA_BLUE }
