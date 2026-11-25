import { useEffect, useState } from 'react'
import { getCashCutMovements, getCashCutSummary, getMyTodayCashCut, getOpenCashCut } from '../../api/cashCuts'
import { getCashPeople, getCashRegisters } from '../../api/cashRegisters'
import { getReimbursements } from '../../api/reimbursements'
import { useAuth } from '../../context/AuthContext'
import { useNotify } from '../../context/NotifyContext'
import CloseCutModal from './CloseCutModal'
import CutMovementsTable from './CutMovementsTable'
import { EntryModal, ExitModal } from './MovementModals'
import { ChooseRegisterModal, ReceiveModal } from './OpenCutModals'
import { fmt, fmtDate } from './common'

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

  // Un gasto o retiro al recibir baja lo que se entrega: se vuelve a pedir la caja.
  async function refreshReceiveRegister() {
    const r = await getCashRegisters()
    const list = r.data.data ?? []
    setRegisters(list)
    setReceiveRegister((current) => list.find((x) => x.id === current.id) ?? current)
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
  const outflows = Number(summary?.expensesTotal ?? 0) + Number(summary?.withdrawalsTotal ?? 0) + Number(summary?.reimbursementsTotal ?? 0)
    + Number(summary?.loansOutTotal ?? 0) + Number(summary?.refundsTotal ?? 0)

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
                {Number(summary?.refundsTotal) > 0 && ` · Devoluciones ${fmt(summary.refundsTotal)}`}
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

          <CutMovementsTable cutId={openCut.id} movements={movements} reloadKey={summary} pendingIds={pendingIds} />
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
        <ReceiveModal
          register={receiveRegister} people={people} onRefresh={refreshReceiveRegister}
          onBack={() => setModal('choose')} onClose={() => setModal(null)} onOpened={reloadAll}
        />
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
