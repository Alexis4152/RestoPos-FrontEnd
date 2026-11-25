import { useEffect, useState } from 'react'
import { getCashCutCancelledPayments, getCashCutRefunds } from '../../api/cashCuts'

const METHOD = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia' }

/**
 * Cobros cancelados y devoluciones de un turno. `reloadKey` vuelve a pedirlos (p. ej. tras
 * registrar algo en el turno).
 */
export function useCutPayments(cutId, reloadKey) {
  const [cancelled, setCancelled] = useState([])
  const [refunds, setRefunds] = useState([])
  useEffect(() => {
    if (!cutId) return
    getCashCutCancelledPayments(cutId).then((r) => setCancelled(r.data.data ?? [])).catch(() => setCancelled([]))
    getCashCutRefunds(cutId).then((r) => setRefunds(r.data.data ?? [])).catch(() => setRefunds([]))
  }, [cutId, reloadKey])
  return { cancelled, refunds }
}

const where = (r) => `Cuenta ${r.folio}${r.mesa ? ` · Mesa ${r.mesa}` : ''}`

/**
 * Cobros cancelados como filas de la tabla de movimientos. Una cancelación no es un movimiento:
 * el cobro deja de contar en las ventas del turno. `cashEffect` es lo que cambió el esperado:
 * el cobro en efectivo lo baja; el de tarjeta o transferencia no lo toca (0).
 */
export function cancelledToMovements(rows) {
  return rows.map((r) => ({
    id: `cancelled-${r.id}`,
    type: 'CANCELLED_PAYMENT',
    createdAt: r.at,
    concept: `Cobro cancelado · ${where(r)} · ${METHOD[r.metodo] ?? r.metodo}`,
    detail: [r.motivo && `Motivo: ${r.motivo}`, r.metodo === 'CASH'
      ? 'Ya no cuenta en las ventas en efectivo del turno'
      : 'No era efectivo: no cambia el efectivo esperado'].filter(Boolean).join(' · '),
    registeredBy: r.byName ? { name: r.byName } : null,
    amount: Number(r.amount ?? 0),
    cashEffect: r.metodo === 'CASH' ? -Number(r.amount ?? 0) : 0,
    byOther: r.byOther,
  }))
}

/**
 * Devoluciones de cobros hechas en el turno (aunque la cuenta sea de otro día). En efectivo
 * salen de la caja; con tarjeta o transferencia son informativas (`cashEffect` 0).
 */
export function refundsToMovements(rows) {
  return rows.map((r) => ({
    id: `refund-${r.id}`,
    type: r.metodo === 'CASH' ? 'PAYMENT_REFUND' : 'NON_CASH_REFUND',
    createdAt: r.at,
    concept: `Devolución · ${where(r)} · ${METHOD[r.metodo] ?? r.metodo}`,
    detail: [r.motivo, r.metodo === 'CASH' ? null : 'No es efectivo: no cambia el efectivo esperado'].filter(Boolean).join(' · ') || null,
    registeredBy: r.byName ? { name: r.byName } : null,
    amount: Number(r.amount ?? 0),
    cashEffect: r.metodo === 'CASH' ? -Number(r.amount ?? 0) : 0,
  }))
}

/**
 * Aviso cuando alguien distinto al cajero del turno (p. ej. un administrador) canceló cobros
 * del turno: dice quién, para que el cajero sepa por qué cambió su esperado.
 */
export function CancelledByOtherNotice({ rows }) {
  const others = rows.filter((r) => r.byOther)
  if (others.length === 0) return null
  const byName = {}
  others.forEach((r) => { byName[r.byName ?? 'Alguien más'] = (byName[r.byName ?? 'Alguien más'] ?? 0) + 1 })
  const who = Object.entries(byName).map(([name, n]) => `${name} canceló ${n === 1 ? 'un cobro' : `${n} cobros`}`).join('; ')
  return (
    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      {who} de este turno: aparecen en los movimientos como «Cobro cancelado».
    </p>
  )
}
