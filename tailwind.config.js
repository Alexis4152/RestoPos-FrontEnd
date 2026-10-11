// Convierte una variable CSS que guarda "R G B" (ej. "21 93 234") en un color
// Tailwind que sí soporta modificadores de opacidad como bg-purple-600/20.
function withOpacity(variableName) {
  return ({ opacityValue }) => {
    if (opacityValue !== undefined) {
      return `rgb(var(${variableName}) / ${opacityValue})`
    }
    return `rgb(var(${variableName}))`
  }
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta de marca — se sobreescribe "purple" porque toda la app ya usa
        // clases purple-* como color de acento. Apunta a variables CSS (ver
        // src/utils/theme.js e index.css) para que cada tienda pueda tener su
        // propio color sin tocar ningún componente.
        purple: {
          50: withOpacity('--brand-50'),
          100: withOpacity('--brand-100'),
          200: withOpacity('--brand-200'),
          300: withOpacity('--brand-300'),
          400: withOpacity('--brand-400'),
          500: withOpacity('--brand-500'),
          600: withOpacity('--brand-600'),
          700: withOpacity('--brand-700'),
          800: withOpacity('--brand-800'),
          900: withOpacity('--brand-900'),
        },
        primary: {
          50: withOpacity('--brand-50'),
          100: withOpacity('--brand-100'),
          500: withOpacity('--brand-500'),
          600: withOpacity('--brand-600'),
          700: withOpacity('--brand-700'),
        },
      },
    },
  },
  plugins: [],
}
