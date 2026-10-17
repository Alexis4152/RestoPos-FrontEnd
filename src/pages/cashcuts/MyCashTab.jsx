import { useEffect, useState } from 'react'
import { getCashCutMovements, getCashCutSummary, getMyTodayCashCut, getOpenCashCut } from '../../api/cashCuts'
import { getCashPeople, getCashRegisters } from '../../api/cashRegisters'
import { getReimbursements } from '../../api/reimbursements'
import { useAuth } from '../../context/AuthContext'
import { useNotify } from '../../context/NotifyContext'
import { resolveMediaUrl } from '../../utils/media'
import CloseCutModal from './CloseCutModal'
import { EntryModal, ExitModal } from './MovementModals'
import { ChooseRegisterModal, ReceiveModal } from './OpenCutModals'
import { MovementBadge, Pagination, SignedAmount, fmt, fmtDate, fmtTime } from './common'

/**
 * Pestaña "Mi caja": el corte del usuario en sesión. Sin corte abierto, ofrece abrir uno
 * (elegir caja → recibirla contando el efectivo). Con corte abierto, muestra el resumen en
 * vivo (fondo, ventas en efectivo, entradas, salidas, efectivo esperado), los movimientos
 * del turno y las acciones: registrar entrada, registrar salida y cerrar con arqueo.
 */
export default function MyCashTab({ onChanged }) {
  const { user, isAdmin } = useAuth()
  // Conteo ciego (opción de la tienda): el cajero no ve su efectivo esperado ni sus ventas
  // en efectivo hasta cerrar. El admin/supervisor siempre ve todo.
  const blind = !!user?.tienda?.blindCashCount && !isAdmin
  const { notify } = useNotify()
  const [openCut, setOpenCut] = useState(null)
  const [myToday, setMyToday] = useState(null)
  const [summary, setSummary] = useState(null)
  const [movements, setMovements] = useState([])
  // Paginación de los movimientos del turno: vienen todos juntos (un turno tiene pocos),
  // así que se pagina aquí mismo, con los más recientes primero.
  const [movPage, setMovPage] = useState(0)
  const [movSize, setMovSize] = useState(10)
  const [pendingReimbursements, setPendingReimbursements] = useState([])
  const [people, setPeople] = useState([])
  const [registers, setRegisters] = useState(null)
  const [loaded, setLoaded] = useState(false)
  // 'choose' | 'receive' | 'entry' | 'exit' | 'close' | null
  const [modal, setModal] = useState(null)
  const [receiveRegister, setReceiveRegister] = useState(null)
  const [entryPreset, setEntryPreset] = useState(null)

  async function load() {
    try {
      const r = await getOpenCashCut()
      const cut = r.data.data
      setOpenCut(cut)
      if (cut) {
        const [s, m, rb] = await Promise.all([
          getCashCutSummary(cut.id),
          getCashCutMovements(cut.id),
          getReimbursements({ status: 'PENDING', size: 100 }),
        ])
        setSummary(s.data.data)
        setMovements(m.data.data ?? [])
        setPendingReimbursements(rb.data.data?.content ?? [])
      } else {
        setSummary(null)
        setMovements([])
        const t = await getMyTodayCashCut().catch(() => null)
        setMyToday(t?.data?.data ?? null)
      }
    } catch {
      setOpenCut(null)
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    getCashPeople().then((r) => setPeople(r.data.data ?? [])).catch(() => setPeople([]))
  }, [])

  function reloadAll() {
    setModal(null)
    load()
    onChanged?.()
  }

  async function startOpen() {
    try {
      const r = await getCashRegisters()
      setRegisters(r.data.data ?? [])
      setModal('choose')
    } catch (err) {
      notify(err.response?.data?.message ?? 'No se pudieron cargar las cajas', 'error')
    }
  }

  if (!loaded) return <p className="text-sm text-gray-400">Cargando…</p>

  const pendingIds = new Set(pendingReimbursements.map((r) => r.id))
  const movTotalPages = Math.ceil(movements.length / movSize)
  const safeMovPage = Math.min(movPage, Math.max(movTotalPages - 1, 0))
  const pagedMovements = [...movements].reverse().slice(safeMovPage * movSize, (safeMovPage + 1) * movSize)
  const outflows = Number(summary?.expensesTotal ?? 0) + Number(summary?.withdrawalsTotal ?? 0) + Number(summary?.reimbursementsTotal ?? 0)
    + Number(summary?.loansOutTotal ?? 0)

  return (
    <div className="space-y-6">
      {!openCut ? (
        <div className="card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            {myToday ? (
              <>
                <p className="font-semibold text-gray-800">Tu corte de hoy — #{myToday.id} (cerrado)</p>
                <p className="text-sm text-gray-500">
                  {myToday.cashRegister?.name ? `${myToday.cashRegister.name} · ` : ''}{fmtDate(myToday.openedAt)} – {fmtDate(myToday.closedAt)} · Ventas: {fmt(myToday.totalSales)}
                  {myToday.handoverAmount != null && ` · Dejaste ${fmt(myToday.handoverAmount)} en caja`}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500">No tienes un corte abierto. Abre uno recibiendo una caja para poder cobrar.</p>
            )}
          </div>
          <button className="btn-primary" onClick={startOpen}>Abrir corte</button>
        </div>
      ) : (
        <>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-gray-900">
                Corte #{openCut.id}{openCut.cashRegister ? ` · ${openCut.cashRegister.name}` : ''}
              </p>
              <p className="text-sm text-gray-500">
                Abierto desde {fmtDate(openCut.openedAt)}{openCut.previousUserName ? ` · recibido de ${openCut.previousUserName}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary text-green-700" onClick={() => { setEntryPreset(null); setModal('entry') }}>↑ Entrada de efectivo</button>
              <button className="btn-secondary text-red-700 flex items-center gap-2" onClick={() => setModal('exit')}>
                ↓ Salida de efectivo
                {pendingReimbursements.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                    {pendingReimbursements.length} reembolso{pendingReimbursements.length === 1 ? '' : 's'}
                  </span>
                )}
              </button>
              <button className="btn-secondary text-red-700" onClick={() => setModal('close')}>Traspaso de caja</button>
              <button className="btn-danger" onClick={() => setModal('endofday')}>Corte de fin de día</button>
            </div>
          </div>

          {openCut.handoverStatus === 'DIFFERENCE' && (
            <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3">
              Recibiste la caja con una diferencia de {fmt(openCut.handoverDifference)} contra lo que te entregaron. El administrador la va a revisar.
            </p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            <div className="card !p-4"><p className="text-sm text-gray-500">Fondo inicial</p><p className="text-2xl font-bold">{fmt(summary?.openingAmount)}</p></div>
            <div className="card !p-4">
              <p className="text-sm text-gray-500">Ventas en efectivo</p>
              {blind ? <p className="text-lg font-semibold text-gray-400 pt-1">Oculto</p> : <p className="text-2xl font-bold">{fmt(summary?.cashSales)}</p>}
            </div>
            <div className="card !p-4">
              <p className="text-sm text-gray-500">Entradas</p>
              <p className="text-2xl font-bold text-green-700">+{fmt(summary?.entriesTotal)}</p>
            </div>
            <div className="card !p-4">
              <p className="text-sm text-gray-500">Salidas</p>
              <p className="text-2xl font-bold text-red-700">−{fmt(outflows)}</p>
              <p className="text-xs text-gray-500">
                Gastos {fmt(summary?.expensesTotal)} · Retiros {fmt(summary?.withdrawalsTotal)}
                {Number(summary?.loansOutTotal) > 0 && ` · Préstamos a otras cajas ${fmt(summary.loansOutTotal)}`}
              </p>
            </div>
            <div className="rounded-xl p-4 bg-purple-600 text-white">
              <p className="text-sm font-semibold">Efectivo esperado en caja</p>
              {blind
                ? <><p className="text-lg font-semibold pt-1">Oculto</p><p className="text-xs">Conteo ciego: lo verás al cerrar</p></>
                : <p className="text-2xl font-bold">{fmt(summary?.expectedCash)}</p>}
            </div>
          </div>
          <p className="text-sm text-gray-500 -mt-2">
            Ventas con tarjeta/transferencia: {fmt(Number(summary?.cardSales ?? 0) + Number(summary?.transferSales ?? 0))} — no son dinero físico, no cuentan en el efectivo esperado.
          </p>

          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap justify-between gap-2">
              <h3 className="font-semibold text-gray-900">Movimientos de efectivo del turno</h3>
              <span className="text-xs text-gray-500">Esperado = fondo + ventas en efectivo + entradas − salidas</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-gray-50">
                  <tr>{['Hora', 'Tipo', 'Concepto', 'Registró', 'Comprobante', 'Monto'].map((h) => (
                    <th key={h} className={`px-4 py-2 font-medium text-gray-600 ${h === 'Monto' ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pagedMovements.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2 text-gray-500">{fmtTime(m.createdAt)}</td>
                      <td className="px-4 py-2"><MovementBadge type={m.type} /></td>
                      <td className="px-4 py-2">
                        <div>{m.concept ?? '—'}</div>
                        {m.type === 'CONTRIBUTION' && m.person && <div className="text-xs text-gray-500">Puso: {m.person.name}</div>}
                        {m.type === 'CONTRIBUTION' && m.reimbursementId && (
                          <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold ${pendingIds.has(m.reimbursementId) ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                            Reembolsable · {pendingIds.has(m.reimbursementId) ? 'pendiente' : 'pagado'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">{m.registeredBy?.name ?? '—'}</td>
                      <td className="px-4 py-2">
                        {m.receiptPath ? <a className="text-purple-700 hover:underline" href={resolveMediaUrl(m.receiptPath)} target="_blank" rel="noopener noreferrer">Ver foto</a> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right"><SignedAmount type={m.type} amount={m.amount} /></td>
                    </tr>
                  ))}
                  {movements.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Sin movimientos en este turno</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={safeMovPage} size={movSize} totalElements={movements.length} totalPages={movTotalPages}
              count={pagedMovements.length} onPageChange={setMovPage} onSizeChange={(n) => { setMovSize(n); setMovPage(0) }}
            />
          </div>
        </>
      )}

      {modal === 'choose' && registers && (
        <ChooseRegisterModal
          registers={registers} isAdmin={isAdmin}
          onClose={() => setModal(null)}
          onContinue={(r) => { setReceiveRegister(r); setModal('receive') }}
        />
      )}
      {modal === 'receive' && receiveRegister && (
        <ReceiveModal register={receiveRegister} onBack={() => setModal('choose')} onClose={() => setModal(null)} onOpened={reloadAll} />
      )}
      {modal === 'entry' && openCut && (
        <EntryModal cut={openCut} people={people} preset={entryPreset} onClose={() => setModal(null)} onSaved={reloadAll} />
      )}
      {modal === 'exit' && openCut && (
        <ExitModal
          cut={openCut} available={summary?.expectedCash} blind={blind} reimbursements={pendingReimbursements} people={people} isAdmin={isAdmin}
          onClose={() => setModal(null)} onSaved={reloadAll}
          onNeedEntry={(preset) => { setEntryPreset(preset); setModal('entry') }}
        />
      )}
      {(modal === 'close' || modal === 'endofday') && openCut && (
        <CloseCutModal
          cut={openCut} summary={summary} blind={blind} endOfDay={modal === 'endofday'}
          onClose={() => setModal(null)} onClosed={reloadAll}
        />
      )}
    </div>
  )
}
