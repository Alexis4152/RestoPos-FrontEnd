/**
 * Formatea el valor de una celda o indicador de un reporte del catálogo (ver
 * `api/reports.js#getReportItem`), según el `format` que trae cada columna/métrica desde
 * el backend: `money`, `count`, `number`, `percent` (variación, con signo), `rate` (porcentaje
 * sin signo), `date`, `datetime` o `text` (sin
 * formatear). Mismo criterio en toda la pantalla de Reportes para que una cifra se vea
 * igual en la tabla, en las tarjetas de indicadores y en las gráficas.
 *
 * @param {*} value Valor crudo tal como llega del backend (número, string ISO, texto o null).
 * @param {string} format Uno de los formatos de arriba.
 * @param {string} [currency] Moneda ISO (ej. `'MXN'`) — solo se usa cuando `format === 'money'`.
 * @returns {string} Texto listo para mostrar; `'—'` si `value` es `null`/`undefined`.
 */
export function fmtValue(value, format, currency = 'MXN') {
  if (value === null || value === undefined || value === '') return '—'
  switch (format) {
    case 'money':
      return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(Number(value))
    case 'percent':
      return `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`
    case 'rate':
      return `${Number(value).toFixed(1)}%`
    case 'count':
    case 'number':
      return new Intl.NumberFormat('es-MX').format(Number(value))
    case 'date':
      return new Date(`${value}T00:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    case 'datetime':
      return new Date(value).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    default:
      return String(value)
  }
}
