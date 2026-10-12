import { useEffect, useState } from 'react'
import { getCashCuts, getOpenCashCut, getMyTodayCashCut, openCashCut, closeCashCut, getCashCutSummary, createCashMovement } from '../api/cashCuts'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import { useEscapeKey } from '../hooks/useEscapeKey'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const fmtDate = (d) => d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'
// Un corte cerrado sin `closedBy` significa que lo cerró el job automático del backend
// (por horario configurado), no una persona; se etiqueta como "Sistema". Mientras el
// corte sigue abierto no aplica (se muestra "—").
const closedByLabel = (c) => c.status !== 'CLOSED' ? '—' : (c.closedBy?.name ?? 'Sistema')

const PAGE_SIZES = [10, 20, 50, 100]
const EMPTY_FILTERS = { from: '', to: '', status: '' }
// Mismo límite que cash_cuts.opening_amount/expenses en el backend (NUMERIC(12,2), ver
// CashCutRequest) — mismo mensaje que ya se usa en el resto de la app para el mismo caso.
const MAX_AMOUNT = 9999999999.99
const EXCESS_MSG = 'El número es excesivamente grande — el máximo permitido es 9,999,999,999.99'

// Se usa en vez de `<input type="number">` a propósito: ese tipo dispara su propia
// validación/formato nativo del navegador (tooltip "introduce un valor válido", flechitas,
// notación científica al pegar "1e10", etc.), fuera del estilo de la app. En su lugar, un
// input de texto normal + este saneo manual (dígitos, un solo punto decimal y, si se
// permite, un signo "-" inicial para AJUSTE) da control total sobre lo que se puede escribir.
function sanitizeDecimalInput(raw, allowNegative = false) {
  let v = raw.replace(allowNegative ? /[^0-9.-]/g : /[^0-9.]/g, '')
  if (allowNegative) {
    const negative = v.startsWith('-')
    v = v.replace(/-/g, '')
    if (negative) v = '-' + v
  }
  const parts = v.split('.')
  if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('')
  return v
}

// Mismas reglas que valida el backend (CashCutRequest): fondo inicial obligatorio, y notas
// con tope de longitud. El caso "excede el límite" NO se valida aquí — se muestra en vivo
// mientras se teclea (ver openAmountExceedsLimit/expensesExceedsLimit), no hasta el submit.
function validateOpenForm(openAmount, notes) {
  const errors = {}
  if (openAmount === '') errors.openAmount = 'El fondo inicial es obligatorio'
  if (notes.length > 100) errors.notes = 'Las notas no pueden tener más de 100 caracteres'
  return errors
}

// Mismas reglas que CashCutRequest: notas con tope de longitud. Los gastos son opcionales
// (0 si se deja vacío) y su límite superior se valida en vivo (ver expensesExceedsLimit),
// no aquí.
function validateCloseForm(notes) {
  const errors = {}
  if (notes.length > 100) errors.notes = 'Las notas no pueden tener más de 100 caracteres'
  return errors
}

// Sin equivalente directo en el PV (no tiene movimientos manuales de caja) — mismas reglas
// que valida MovimientoCajaRequest/MovimientoCajaService en el backend, con el mismo
// EXCESS_MSG y estilo "no puede tener más de N caracteres" que el resto de la app. El caso
// "excede el límite" se valida en vivo (ver movAmountExceedsLimit), no aquí.
function validateMovementForm(movType, movAmount, movReason) {
  const errors = {}
  const n = Number(movAmount)
  if (movAmount === '' || movAmount === '-' || Number.isNaN(n)) {
    errors.movAmount = 'El monto es obligatorio'
  } else if (movType === 'AJUSTE') {
    if (n === 0) errors.movAmount = 'El ajuste no puede ser de cero'
  } else if (n <= 0) {
    errors.movAmount = 'El monto debe ser mayor a cero'
  }
  if (!movReason.trim()) errors.movReason = 'El motivo es obligatorio'
  else if (movReason.length > 255) errors.movReason = 'El motivo no puede tener más de 255 caracteres'
  return errors
}

/**
 * Página "Cortes de Caja": abre/cierra el corte de caja del cajero autenticado y, si es
 * administrador, muestra además el historial completo de cortes de la tienda (o de todas
 * las tiendas si es `SUPER_ADMIN`) con filtros y paginación.
 *
 * Un corte de caja pertenece a UN cajero, no a la tienda: en una misma tienda puede haber
 * varios cortes abiertos simultáneamente (uno por cajero). Por eso esta pantalla distingue
 * tres vistas de datos:
 * - `openCut`: el corte abierto del usuario actual (si tiene uno) — solo puede tener uno
 *   a la vez, es lo que habilita cobrar en el POS.
 * - `myToday`: el corte de HOY del usuario actual aunque ya esté cerrado, para que un
 *   cajero sin corte abierto todavía vea el resumen de su turno del día.
 * - `pageData` (la tabla paginada): el historial completo, solo se carga y se muestra para
 *   administradores — un cajero normal no ve los cortes de sus compañeros.
 *
 * Patrón de filtros + paginación: igual que en Sales — `filters` es lo que se captura en
 * el formulario, `appliedFilters` es lo que realmente se envía al backend y dispara la
 * recarga; ver el JSDoc de `Sales` para el detalle completo del patrón.
 */
export default function CashCuts() {
  const { isAdmin } = useAuth()
  const { notify, confirmDialog } = useNotify()
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(20)
  const [pageData, setPageData] = useState({ content: [], totalElements: 0, totalPages: 0 })
  const [openCut, setOpenCut] = useState(null)
  const [myToday, setMyToday] = useState(null)
  const [showOpen, setShowOpen] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [openAmount, setOpenAmount] = useState('')
  const [expenses, setExpenses] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)
  const [summary, setSummary] = useState(null)
  const [showMovement, setShowMovement] = useState(false)
  const [movType, setMovType] = useState('ENTRADA')
  const [movAmount, setMovAmount] = useState('')
  const [movReason, setMovReason] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  /**
   * Recarga los tres bloques de datos de la pantalla: el historial paginado (solo si
   * `isAdmin`, usando `page`/`size`/`appliedFilters` — ver el patrón de filtros descrito
   * en el JSDoc del componente), el corte abierto del usuario actual, y el corte de hoy
   * del usuario aunque ya esté cerrado. Cada bloque atrapa sus propios errores por
   * separado y cae a un valor vacío/null, para que un fallo en uno no tumbe a los otros.
   */
  function load() {
    // el historial completo (la tabla) solo lo puede ver el administrador
    if (isAdmin) {
      const params = {
        page,
        size,
        status: appliedFilters.status || undefined,
        from: appliedFilters.from ? `${appliedFilters.from}T00:00:00` : undefined,
        to: appliedFilters.to ? `${appliedFilters.to}T23:59:59` : undefined,
      }
      getCashCuts(params)
        .then((r) => setPageData(r.data.data ?? { content: [], totalElements: 0, totalPages: 0 }))
        .catch(() => setPageData({ content: [], totalElements: 0, totalPages: 0 }))
    }
    getOpenCashCut().then((r) => setOpenCut(r.data.data)).catch(() => setOpenCut(null))
    // el corte propio de hoy: sigue visible aunque ya se haya cerrado
    getMyTodayCashCut().then((r) => setMyToday(r.data.data)).catch(() => setMyToday(null))
  }

  useEffect(() => { load() }, [page, size, appliedFilters])

  /** Aplica los filtros del formulario (historial de admin) y reinicia a la primera página. */
  function handleApplyFilters(e) {
    e.preventDefault()
    setPage(0)
    setAppliedFilters(filters)
  }

  /** Limpia filtros capturados y aplicados, y vuelve a la primera página. */
  function handleClearFilters() {
    setFilters(EMPTY_FILTERS)
    setAppliedFilters(EMPTY_FILTERS)
    setPage(0)
  }

  // Cierra con ESC el modal que esté abierto (abrir, cerrar, movimiento o detalle),
  // descartando lo capturado — mismo efecto que "Cancelar"/la ✕ de cada uno.
  useEscapeKey(() => {
    if (showOpen) setShowOpen(false)
    else if (showClose) setShowClose(false)
    else if (showMovement) setShowMovement(false)
    else if (detail) setDetail(null)
  }, !!(showOpen || showClose || showMovement || detail))

  /**
   * Abre un nuevo corte de caja para el usuario actual con el fondo inicial (`openAmount`)
   * capturado en el modal. Se asume que el backend impide abrir un segundo corte si el
   * usuario ya tiene uno abierto (esta pantalla solo ofrece el botón "Abrir corte" cuando
   * `openCut` es null). Al terminar recarga los tres bloques de datos, lo que hace
   * reaparecer el aviso verde de "Corte abierto" y habilita el cobro en el POS.
   */
  async function handleOpen(e) {
    e.preventDefault()
    const errors = validateOpenForm(openAmount, notes)
    setFieldErrors(errors)
    // openAmountExceedsLimit NO se guarda en `errors`/`fieldErrors` a propósito: es un
    // derivado en vivo que ya se muestra solo con seguir tecleando (ver el JSX del input) —
    // si se copiara a `fieldErrors` aquí, el mensaje se quedaría "pegado" después de
    // corregir el monto, porque nada más lo limpiaría hasta el siguiente submit. Aun así
    // debe seguir bloqueando el envío mientras siga excedido.
    if (Object.keys(errors).length > 0 || openAmountExceedsLimit) {
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    const amount = Number(openAmount) || 0
    if (!(await confirmDialog(`¿Deseas abrir un corte de caja con fondo inicial de ${fmt(amount)}?`, { confirmText: 'Abrir corte', danger: false }))) return

    setLoading(true)
    try {
      await openCashCut({ amount, notes })
      setShowOpen(false)
      setOpenAmount('')
      setNotes('')
      load()
      notify('Corte de caja abierto correctamente', 'success')
    } catch (err) {
      setFieldErrors(err.response?.data?.data ?? {})
      notify(err.response?.data?.message ?? 'Error al abrir el corte', 'error')
    } finally { setLoading(false) }
  }

  /** Registra una entrada/salida/ajuste manual de efectivo sobre el corte abierto. */
  async function handleMovement(e) {
    e.preventDefault()
    const errors = validateMovementForm(movType, movAmount, movReason)
    setFieldErrors(errors)
    // movAmountExceedsLimit NO se guarda en `errors`/`fieldErrors` — mismo motivo que en
    // handleOpen/handleClose: es un derivado en vivo, y guardarlo dejaría el mensaje
    // pegado tras corregir el monto.
    if (Object.keys(errors).length > 0 || movAmountExceedsLimit) {
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    if (!(await confirmDialog(`¿Deseas registrar esta ${movType.toLowerCase()} de ${fmt(Math.abs(Number(movAmount)))}?`, { confirmText: 'Registrar', danger: false }))) return

    setLoading(true)
    try {
      await createCashMovement({ tipo: movType, monto: Number(movAmount), motivo: movReason })
      setShowMovement(false)
      setMovAmount('')
      setMovReason('')
      load()
      notify('Movimiento registrado correctamente', 'success')
    } catch (err) {
      setFieldErrors(err.response?.data?.data ?? {})
      notify(err.response?.data?.message ?? 'Error al registrar el movimiento', 'error')
    } finally { setLoading(false) }
  }

  /**
   * Abre el modal de cierre y, antes de mostrarlo listo, trae el resumen (`summary`) del
   * corte abierto — totales por forma de pago, cancelaciones, etc. — para poder calcular
   * en vivo el efectivo esperado en caja (`expectedCash`) mientras el cajero captura sus
   * gastos. Si la llamada falla, deja `summary` en null y el modal simplemente muestra los
   * totales en blanco en vez de bloquear el cierre.
   */
  async function openCloseModal() {
    setNotes('')
    setExpenses('')
    setSummary(null)
    setFieldErrors({})
    setShowClose(true)
    try {
      const r = await getCashCutSummary(openCut.id)
      setSummary(r.data.data)
    } catch {
      setSummary(null)
    }
  }

  /**
   * Abre el modal de detalle de un corte. Si el corte ya está cerrado, los totales que
   * trae `c` (de la lista) son definitivos y se muestran tal cual. Si sigue abierto, esos
   * totales pueden estar desactualizados (se siguen acumulando ventas), así que se vuelve
   * a pedir el resumen fresco (`getCashCutSummary`) y se combina con `c`; si esa llamada
   * falla, se deja el detalle con los valores ya cargados (potencialmente en cero) en vez
   * de bloquear la vista.
   */
  async function openDetail(c) {
    if (c.status !== 'OPEN') { setDetail(c); return }
    setDetail(c)
    try {
      const r = await getCashCutSummary(c.id)
      setDetail({ ...c, ...r.data.data })
    } catch {
      // keep the stale (zeroed) values if the summary fetch fails
    }
  }

  // Efectivo que debería haber físicamente en caja al momento de cerrar: fondo inicial +
  // ventas en efectivo, menos los gastos capturados en el modal de cierre, más/menos las
  // entradas/salidas manuales del turno. Las ventas con tarjeta/transferencia NO se suman
  // aquí porque no son dinero físico (ver aviso en el modal de cierre) — solo se reportan
  // aparte, en el resumen del corte.
  const expectedCash = summary
    ? Number(summary.openingAmount) + Number(summary.cashSales) - (Number(expenses) || 0)
      + Number(summary.totalEntradas || 0) - Number(summary.totalSalidas || 0)
    : null
  // Derivados EN VIVO (recalculados en cada render, no solo al enviar) — el mensaje de
  // "excede el límite" y, en el caso de Gastos, el ocultamiento de "Efectivo esperado en
  // caja" deben reaccionar mientras se teclea, no hasta que se le da clic a Abrir/Cerrar.
  const openAmountNum = openAmount === '' ? null : Number(openAmount)
  const openAmountExceedsLimit = openAmountNum != null && openAmountNum > MAX_AMOUNT
  const expensesNum = Number(expenses) || 0
  const expensesExceedsLimit = expensesNum > MAX_AMOUNT
  const movAmountNum = movAmount === '' ? null : Number(movAmount)
  const movAmountExceedsLimit = movAmountNum != null && Math.abs(movAmountNum) > MAX_AMOUNT

  /**
   * Cierra el corte de caja abierto del usuario actual, enviando los gastos capturados
   * (o 0 si no se capturó ninguno) y las notas. El monto final contado en caja no se pide
   * aquí como input separado — lo que se envía es `expenses`; el "fondo final" que se
   * muestra después en el detalle es un valor calculado por el backend. Al cerrar,
   * recarga los tres bloques de datos: desaparece el aviso de corte abierto y, si el
   * usuario no es admin, pasa a mostrarse como "tu corte de hoy (cerrado)".
   */
  async function handleClose(e) {
    e.preventDefault()
    const errors = validateCloseForm(notes)
    setFieldErrors(errors)
    // expensesExceedsLimit NO se guarda en `errors`/`fieldErrors` — mismo motivo que
    // openAmountExceedsLimit en handleOpen (ver ese comentario): es un derivado en vivo, y
    // guardarlo dejaría el mensaje pegado tras corregir el gasto.
    if (Object.keys(errors).length > 0 || expensesExceedsLimit) {
      notify('Revisa los campos marcados en rojo', 'error')
      return
    }
    if (!(await confirmDialog(`¿Deseas cerrar el corte de caja? Efectivo esperado en caja: ${fmt(expectedCash)}`, { confirmText: 'Cerrar corte' }))) return

    setLoading(true)
    try {
      await closeCashCut(openCut.id, { expenses: expensesNum, notes })
      setShowClose(false)
      setExpenses('')
      setNotes('')
      load()
      notify('Corte de caja cerrado correctamente', 'success')
    } catch (err) {
      setFieldErrors(err.response?.data?.data ?? {})
      notify(err.response?.data?.message ?? 'Error al cerrar el corte', 'error')
    } finally { setLoading(false) }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Cortes de Caja</h2>
        <div className="flex gap-2">
          {openCut && (
            <button className="btn-secondary" onClick={() => { setShowMovement(true); setMovType('ENTRADA'); setMovAmount(''); setMovReason(''); setFieldErrors({}) }}>
              + Movimiento
            </button>
          )}
          {openCut ? (
            <button className="btn-danger" onClick={openCloseModal}>Cerrar corte</button>
          ) : (
            <button className="btn-primary" onClick={() => { setShowOpen(true); setNotes(''); setOpenAmount(''); setFieldErrors({}) }}>Abrir corte</button>
          )}
        </div>
      </div>

      {openCut && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-green-800">Corte abierto #{openCut.id}</p>
            <p className="text-sm text-green-600">Desde {fmtDate(openCut.openedAt)} · Apertura: {fmt(openCut.openingAmount)}</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="text-green-700 hover:underline text-xs font-medium" onClick={() => openDetail(openCut)}>Ver detalle</button>
            <span className="text-2xl">🟢</span>
          </div>
        </div>
      )}

      {/* corte propio del día, ya cerrado: solo aplica a no-admins, admin lo ve todo en la tabla */}
      {!isAdmin && !openCut && myToday && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-gray-800">Tu corte de hoy — #{myToday.id} (cerrado)</p>
            <p className="text-sm text-gray-500">
              {fmtDate(myToday.openedAt)} – {fmtDate(myToday.closedAt)} · Total: {fmt(myToday.totalSales)}
            </p>
          </div>
          <button className="text-blue-600 hover:underline text-xs" onClick={() => openDetail(myToday)}>Ver detalle</button>
        </div>
      )}

      {!isAdmin && !openCut && !myToday && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6 text-sm text-gray-500">
          Aún no has abierto un corte de caja hoy.
        </div>
      )}

      {isAdmin && (() => {
        const cuts = pageData.content ?? []
        const totalPages = pageData.totalPages ?? 0
        const totalElements = pageData.totalElements ?? 0
        const from = totalElements === 0 ? 0 : page * size + 1
        const to = Math.min(totalElements, page * size + cuts.length)

        return (
      <>
      <form onSubmit={handleApplyFilters} className="card mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Desde</label>
          <input type="date" className="input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Hasta</label>
          <input type="date" className="input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Estado</label>
          <select className="input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Todos</option>
            <option value="OPEN">Abierto</option>
            <option value="CLOSED">Cerrado</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1">Filtrar</button>
          <button type="button" className="btn-secondary" onClick={handleClearFilters}>Limpiar</button>
        </div>
      </form>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['#', 'Apertura', 'Cierre', 'Cajero', 'Cerrado por', 'Ventas', 'Transac.', 'Estado', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {cuts.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-400 font-mono text-xs">#{c.id}</td>
                <td className="px-4 py-3 text-gray-600">{fmtDate(c.openedAt)}</td>
                <td className="px-4 py-3 text-gray-600">{fmtDate(c.closedAt)}</td>
                <td className="px-4 py-3 text-gray-700">{c.user?.name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-700">{closedByLabel(c)}</td>
                <td className="px-4 py-3 font-semibold text-gray-900">{fmt(c.totalSales)}</td>
                <td className="px-4 py-3 text-gray-600">{c.totalTransactions ?? 0}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                    c.status === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                  }`}>{c.status === 'OPEN' ? 'Abierto' : 'Cerrado'}</span>
                </td>
                <td className="px-4 py-3">
                  <button className="text-blue-600 hover:underline text-xs" onClick={() => openDetail(c)}>Ver</button>
                </td>
              </tr>
            ))}
            {cuts.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Sin cortes</td></tr>
            )}
          </tbody>
        </table>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 text-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <span>Mostrar</span>
            <select
              className="input !w-auto py-1"
              value={size}
              onChange={(e) => { setSize(Number(e.target.value)); setPage(0) }}
            >
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>por página · {totalElements === 0 ? 'sin resultados' : `${from}–${to} de ${totalElements}`}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn-secondary py-1 px-3 text-xs disabled:opacity-40"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ‹ Anterior
            </button>
            <span className="text-gray-500 text-xs">Página {totalPages === 0 ? 0 : page + 1} de {totalPages}</span>
            <button
              className="btn-secondary py-1 px-3 text-xs disabled:opacity-40"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente ›
            </button>
          </div>
        </div>
      </div>
      </>
        )
      })()}

      {/* Open modal */}
      {showOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Abrir corte de caja</h3>
            {/* Sin `required`/`type="number"` a propósito: disparan el globo/formato nativo
                del navegador — validate*Form + fieldErrors dan el mismo feedback con el
                estilo de la app, y sanitizeDecimalInput controla lo que se puede escribir. */}
            <form onSubmit={handleOpen} noValidate className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Fondo inicial ($)</label>
                <input className="input" inputMode="decimal" value={openAmount} onChange={(e) => setOpenAmount(sanitizeDecimalInput(e.target.value))} />
                {(openAmountExceedsLimit || fieldErrors.openAmount) && (
                  <p className="text-red-600 text-xs mt-1">{openAmountExceedsLimit ? EXCESS_MSG : fieldErrors.openAmount}</p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Notas</label>
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
                {fieldErrors.notes && <p className="text-red-600 text-xs mt-1">{fieldErrors.notes}</p>}
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowOpen(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={loading}>{loading ? '...' : 'Abrir'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Close modal */}
      {showClose && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowClose(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Cerrar corte de caja</h3>
            <form onSubmit={handleClose} noValidate className="space-y-3">
              <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Fondo inicial</span>
                  <span className="font-medium">{fmt(summary?.openingAmount)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Ventas en efectivo</span>
                  <span className="font-medium">{fmt(summary?.cashSales)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Ventas tarjeta/transf.</span>
                  <span className="font-medium">{fmt((summary?.cardSales ?? 0) + (summary?.transferSales ?? 0))}</span></div>
                {Number(summary?.totalEntradas) > 0 && (
                  <div className="flex justify-between"><span className="text-gray-500">Entradas manuales</span>
                    <span className="font-medium">+{fmt(summary.totalEntradas)}</span></div>
                )}
                {Number(summary?.totalSalidas) > 0 && (
                  <div className="flex justify-between"><span className="text-gray-500">Salidas manuales</span>
                    <span className="font-medium">-{fmt(summary.totalSalidas)}</span></div>
                )}
                <p className="text-xs text-red-500 italic pt-1">
                  Tarjeta y transferencia no son dinero físico, por eso no se suman al efectivo esperado en caja.
                </p>
                {summary?.cancelledCount > 0 && (
                  <div className="flex justify-between text-red-500">
                    <span>Ventas canceladas ({summary.cancelledCount})</span>
                    <span className="font-medium">-{fmt(summary.cancelledTotal)}</span>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Gastos adicionales ($)</label>
                <input className="input" inputMode="decimal" placeholder="0.00" value={expenses} onChange={(e) => setExpenses(sanitizeDecimalInput(e.target.value))} />
                {(expensesExceedsLimit || fieldErrors.expenses) && (
                  <p className="text-red-600 text-xs mt-1">{expensesExceedsLimit ? EXCESS_MSG : fieldErrors.expenses}</p>
                )}
              </div>
              {/* Oculto mientras el gasto exceda el límite (en vivo) o haya un error del
                  backend: el cálculo (fondo + ventas - gastos) tampoco es válido en esos
                  casos — mostrarlo confunde más que ayuda. */}
              {!expensesExceedsLimit && !fieldErrors.expenses && (
                <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-1 pt-1 border-t border-gray-100">
                  <span className="text-sm font-semibold text-gray-700">Efectivo esperado en caja</span>
                  <span className="text-lg font-bold text-purple-700">{fmt(expectedCash)}</span>
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-600">Notas</label>
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
                {fieldErrors.notes && <p className="text-red-600 text-xs mt-1">{fieldErrors.notes}</p>}
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowClose(false)}>Cancelar</button>
                <button type="submit" className="btn-danger" disabled={loading}>{loading ? '...' : 'Cerrar corte'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Movement modal */}
      {showMovement && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowMovement(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Movimiento de caja</h3>
            {/* Sin `required`/`type="number"` a propósito, ver nota en el modal de apertura. */}
            <form onSubmit={handleMovement} noValidate className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {['ENTRADA', 'SALIDA', 'AJUSTE'].map((t) => (
                  <button key={t} type="button"
                    className={`py-2 rounded-lg text-xs font-semibold border ${movType === t ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200'}`}
                    onClick={() => setMovType(t)}>{t}</button>
                ))}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Monto ($) {movType === 'AJUSTE' && '— puede ser negativo'}</label>
                <input className="input" inputMode="decimal" value={movAmount} onChange={(e) => setMovAmount(sanitizeDecimalInput(e.target.value, movType === 'AJUSTE'))} />
                {(movAmountExceedsLimit || fieldErrors.movAmount) && (
                  <p className="text-red-600 text-xs mt-1">{movAmountExceedsLimit ? EXCESS_MSG : fieldErrors.movAmount}</p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Motivo *</label>
                <input className="input" value={movReason} onChange={(e) => setMovReason(e.target.value)} />
                {fieldErrors.movReason && <p className="text-red-600 text-xs mt-1">{fieldErrors.movReason}</p>}
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowMovement(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={loading}>{loading ? '...' : 'Registrar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold">Corte #{detail.id}</h3>
              <button className="text-gray-400 text-xl" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div className="space-y-2 text-sm">
              {[
                ['Cajero', detail.user?.name ?? '—'],
                ['Cerrado por', closedByLabel(detail)],
                ['Apertura', fmtDate(detail.openedAt)],
                ['Cierre', fmtDate(detail.closedAt)],
                ['Fondo inicial', fmt(detail.openingAmount)],
                ['Transacciones', detail.totalTransactions ?? 0],
                ['  · Efectivo', fmt(detail.cashSales)],
                ['  · Tarjeta', fmt(detail.cardSales)],
                ['  · Transferencia', fmt(detail.transferSales)],
                ['Total ventas', fmt(detail.totalSales)],
                ['Entradas manuales', fmt(detail.totalEntradas)],
                ['Salidas manuales', fmt(detail.totalSalidas)],
                ['Gastos', detail.status === 'OPEN' ? '— (se captura al cerrar)' : fmt(detail.expenses)],
                ['Fondo final (calculado)', detail.status === 'OPEN' ? '— (pendiente de cierre)' : fmt(detail.closingAmount)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-gray-500">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
              {detail.cancelledCount > 0 && (
                <div className="flex justify-between text-red-500">
                  <span>Ventas canceladas ({detail.cancelledCount})</span>
                  <span className="font-medium">-{fmt(detail.cancelledTotal)}</span>
                </div>
              )}
              {detail.notes && <p className="text-gray-400 text-xs mt-2">{detail.notes}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
