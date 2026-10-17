import { useEffect, useState } from 'react'
import { uploadCashReceipt } from '../../api/cashCuts'
import { getCashRegisters } from '../../api/cashRegisters'
import { useNotify } from '../../context/NotifyContext'
import { resolveMediaUrl } from '../../utils/media'

// Utilidades y piezas compartidas por las pestañas de Cortes de Caja (Mi caja, Cajas,
// Historial, Reembolsos).

export const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
export const fmtDate = (d) => d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'
export const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'

// Mismo límite que las columnas NUMERIC(12,2) del backend — mismo mensaje que Inventario/POS.
export const MAX_AMOUNT = 9999999999.99
export const EXCESS_MSG = 'El número es excesivamente grande — el máximo permitido es 9,999,999,999.99'

// Deja escribir solo dígitos y un único punto decimal — en vez de type="number", que deja
// teclear "e" (notación científica) y mete sus propios globos de validación.
export const sanitizeDecimalInput = (raw) => {
  let v = raw.replace(/[^0-9.]/g, '')
  const firstDot = v.indexOf('.')
  if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '')
  return v
}

/** Número de un input de monto, o null si está vacío. */
export const toAmount = (v) => (v === '' || v == null ? null : Number(v))

// Reglas contra errores de dedo al contar efectivo — mismos valores que CashCountRules en
// el backend, que es quien las hace cumplir; aquí solo sirven para avisar en vivo.
// Diferencia grande: más de $200 o del 10% de lo esperado (lo mayor) → pide volver a escribir el monto.
export const isLargeDifference = (expected, counted) =>
  Math.abs(counted - expected) > Math.max(200, Math.max(expected, 0) * 0.10)
// No razonable: más de 10 veces lo esperado + $10,000 → se rechaza (sobran dígitos).
export const isUnreasonableCount = (expected, counted) => counted > Math.max(expected, 0) * 10 + 10000

/**
 * Confirmación reforzada de un monto con diferencia grande: aviso + volver a escribirlo.
 * `confirmValue` es lo que se volvió a escribir; coincide si es igual a `amount`.
 */
export function LargeDifferenceConfirm({ id, message, amount, confirmValue, onChange, error }) {
  const matches = toAmount(confirmValue) === amount
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-2">
      <p className="text-sm font-semibold text-amber-900">{message}</p>
      <label htmlFor={id} className="text-xs font-medium text-amber-900 block">Vuelve a escribir el monto para confirmarlo</label>
      <input
        id={id} className="input" type="text" inputMode="decimal" autoComplete="off"
        value={confirmValue} onChange={(e) => onChange(sanitizeDecimalInput(e.target.value))}
        onPaste={(e) => e.preventDefault()}
      />
      {confirmValue !== '' && !matches && <p className="text-red-600 text-xs">No coincide con el monto capturado.</p>}
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  )
}

export const MOVEMENT_LABELS = {
  EXPENSE: 'Gasto',
  WITHDRAWAL: 'Retiro',
  REIMBURSEMENT: 'Pago de reembolso',
  CONTRIBUTION: 'Aporte',
  FLOAT: 'Entrada de cambio',
  SHORTAGE_PAYMENT: 'Pago de faltante',
  LOAN_OUT: 'Préstamo a otra caja',
  LOAN_IN: 'Préstamo de otra caja',
}
export const isOutflow = (type) => type === 'EXPENSE' || type === 'WITHDRAWAL' || type === 'REIMBURSEMENT' || type === 'LOAN_OUT'

/** Las demás cajas activas de la tienda (para préstamos entre cajas); se cargan solo si `enabled`. */
export function useOtherRegisters(cut, enabled) {
  const [list, setList] = useState(null)
  useEffect(() => {
    if (!enabled || list) return
    getCashRegisters()
      .then((r) => setList((r.data.data ?? []).filter((x) => x.isActive && x.id !== cut?.cashRegister?.id)))
      .catch(() => setList([]))
  }, [enabled, list, cut?.cashRegister?.id])
  return list
}

/** Selector de la otra caja en un préstamo entre cajas. */
export function RegisterSelect({ id, label, registers, value, onChange, error }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-gray-600 block mb-1">{label} <span className="text-red-500">*</span></label>
      <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} disabled={registers == null}>
        <option value="">{registers == null ? 'Cargando cajas…' : registers.length === 0 ? 'No hay otras cajas' : 'Elige la caja'}</option>
        {(registers ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  )
}

export const DESTINATION_LABELS = { OWNER: 'Entregado al dueño', BANK: 'Depósito bancario', SAFE: 'Caja fuerte' }

/** Etiqueta de cómo se verificó un efectivo ("Contado por Luis", "No contado"...). */
export function countLabel(method, name) {
  switch (method) {
    case 'CASHIER': return `Contado por ${name ?? 'el cajero'}`
    case 'ADMIN_IN_PERSON': return `Contado por ${name ?? 'un administrador'} (en persona)`
    case 'REMOTE_REPORTED': return `Reportado por ${name ?? 'el cajero'} a distancia`
    case 'NOT_COUNTED': return 'No contado · usa el esperado'
    default: return null
  }
}

export function countBadgeClass(method) {
  if (method === 'NOT_COUNTED') return 'bg-amber-100 text-amber-800'
  if (method === 'REMOTE_REPORTED') return 'bg-blue-100 text-blue-800'
  return 'bg-green-100 text-green-800'
}

/** Insignia de cómo se verificó el efectivo; no pinta nada si no hay método. */
export function CountBadge({ method, name }) {
  const label = countLabel(method, name)
  if (!label) return null
  return <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${countBadgeClass(method)}`}>{label}</span>
}

/** Insignia del tipo de movimiento (verde = entrada, rojo = salida). */
export function MovementBadge({ type }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${isOutflow(type) ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
      {MOVEMENT_LABELS[type] ?? type}
    </span>
  )
}

/** Monto con signo y color según entra o sale. */
export function SignedAmount({ type, amount, className = '' }) {
  const out = isOutflow(type)
  return <span className={`font-semibold ${out ? 'text-red-700' : 'text-green-700'} ${className}`}>{out ? '−' : '+'}{fmt(amount)}</span>
}

/**
 * Modal estándar de la sección: fondo oscuro, clic fuera o ESC para cerrar, título y
 * subtítulo opcionales.
 */
export function Modal({ title, subtitle, onClose, children, wide = false }) {
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true"
        className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-lg' : 'max-w-md'} p-6 max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" aria-label="Cerrar" className="text-gray-400 hover:text-gray-600 text-xl leading-none" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Input de monto (solo dígitos y punto), con su etiqueta y error. */
export function AmountField({ id, label, value, onChange, error, autoFocus = false, readOnly = false }) {
  const num = toAmount(value)
  const message = num != null && num > MAX_AMOUNT ? EXCESS_MSG : error
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-gray-600 block mb-1">{label}</label>
      <input
        id={id} className={`input ${readOnly ? 'bg-gray-50 text-gray-600' : ''}`} type="text" inputMode="decimal"
        value={value} autoFocus={autoFocus} readOnly={readOnly}
        onChange={(e) => onChange(sanitizeDecimalInput(e.target.value))}
      />
      {message && <p className="text-red-600 text-xs mt-1">{message}</p>}
    </div>
  )
}

/** Select de persona (personal de la tienda). */
export function PersonSelect({ id, label, people, value, onChange }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-gray-600 block mb-1">{label}</label>
      <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Seleccionar...</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  )
}

/** Select de destino de un retiro. */
export function DestinationSelect({ id, value, onChange }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-gray-600 block mb-1">Destino del dinero</label>
      <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Seleccionar...</option>
        {Object.entries(DESTINATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </div>
  )
}

/** Subida opcional de una foto de comprobante; `value` es la ruta ya subida (o ''). */
export function ReceiptInput({ value, onChange, label = 'Comprobante (opcional)' }) {
  const { notify } = useNotify()
  const [uploading, setUploading] = useState(false)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      notify('La imagen pesa demasiado — el máximo permitido es 5 MB', 'error')
      return
    }
    setUploading(true)
    try {
      const r = await uploadCashReceipt(file)
      onChange(r.data.data)
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudo subir la imagen', 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <span className="text-xs font-medium text-gray-600 block mb-1">{label}</span>
      {value ? (
        <div className="flex items-center gap-3">
          <a href={resolveMediaUrl(value)} target="_blank" rel="noopener noreferrer">
            <img src={resolveMediaUrl(value)} alt="Comprobante" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
          </a>
          <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onChange('')}>Quitar</button>
        </div>
      ) : (
        <label className="flex items-center justify-center gap-2 min-h-[48px] border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 cursor-pointer hover:border-purple-400 hover:text-purple-600">
          {uploading ? 'Subiendo…' : '📷 Adjuntar foto'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} disabled={uploading} />
        </label>
      )}
    </div>
  )
}

export const PAGE_SIZES = [10, 20, 50, 100]

/**
 * Pie de tabla paginada, igual en todas las tablas de Cortes de Caja: "Mostrar N por
 * página · x–y de z" y Anterior/Siguiente. `count` = filas de la página actual. Quien lo
 * usa reinicia a la página 0 cuando cambia el tamaño.
 */
export function Pagination({ page, size, totalElements, totalPages, count, onPageChange, onSizeChange }) {
  const from = totalElements === 0 ? 0 : page * size + 1
  const to = Math.min(totalElements, page * size + count)
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 text-sm">
      <div className="flex items-center gap-2 text-gray-500">
        <span>Mostrar</span>
        <select className="input !w-auto py-1" aria-label="Registros por página" value={size} onChange={(e) => onSizeChange(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span>por página · {totalElements === 0 ? 'sin resultados' : `${from}–${to} de ${totalElements}`}</span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary py-1 px-3 text-xs disabled:opacity-40" disabled={page === 0} onClick={() => onPageChange(Math.max(0, page - 1))}>‹ Anterior</button>
        <span className="text-gray-500 text-xs">Página {totalPages === 0 ? 0 : page + 1} de {totalPages}</span>
        <button type="button" className="btn-secondary py-1 px-3 text-xs disabled:opacity-40" disabled={page + 1 >= totalPages} onClick={() => onPageChange(page + 1)}>Siguiente ›</button>
      </div>
    </div>
  )
}

/** Fila "etiqueta ........ valor" de los resúmenes. */
export function SummaryRow({ label, children, strong = false }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-bold text-gray-900 text-base' : ''}`}>
      <span className={strong ? '' : 'text-gray-500'}>{label}</span>
      <span className={strong ? '' : 'font-medium'}>{children}</span>
    </div>
  )
}

/**
 * Desglose de lo que recibe quien abre una caja cerrada: lo que dejó el último corte, los
 * movimientos con la caja cerrada (y quién contó lo que quedó, si alguien contó) y el monto final.
 */
export function PendingBreakdown({ pending, compact = false }) {
  if (!pending) return null
  const text = compact ? 'text-xs' : 'text-sm'
  return (
    <div className={`space-y-1 ${text}`}>
      {pending.lastCutId != null && (
        <div className="flex justify-between gap-3">
          <span className="text-gray-600">Dejó {pending.lastUserName ?? '—'} · {fmtTime(pending.lastClosedAt)}</span>
          <span className="font-medium">{fmt(pending.leftAmount)}</span>
        </div>
      )}
      {(pending.movements ?? []).map((m) => (
        <div key={m.id} className="flex justify-between gap-3">
          <span className="text-gray-600">
            {m.type === 'WITHDRAWAL' ? 'Retiro' : 'Entrada'} de {m.registeredBy?.name ?? 'admin'} · {fmtTime(m.occurredAt ?? m.createdAt)}
            {m.destination && ` · ${DESTINATION_LABELS[m.destination]}`}
          </span>
          <SignedAmount type={m.type} amount={m.amount} />
        </div>
      ))}
    </div>
  )
}
