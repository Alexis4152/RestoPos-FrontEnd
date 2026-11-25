import { useEffect, useState } from 'react'
import { getCashCutReceivedMovements } from '../../api/cashCuts'
import { destinationLabel } from './common'

/** Movimientos con la caja cerrada que recibió un turno. `reloadKey` vuelve a pedirlos. */
export function useBeforeOpeningMovements(cutId, reloadKey) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    if (!cutId) return
    getCashCutReceivedMovements(cutId).then((r) => setRows(r.data.data ?? [])).catch(() => setRows([]))
  }, [cutId, reloadKey])
  return rows
}

function concept(m) {
  if (m.type === 'WITHDRAWAL') return `Destino: ${destinationLabel(m)}`
  return m.concept ?? '—'
}

/**
 * Los convierte en filas de la tabla del turno. Ya están descontados del fondo inicial, así que
 * no cambian el efectivo esperado: `cashEffect` es 0 y el monto va sin signo.
 */
export function beforeOpeningToMovements(rows) {
  return rows.map((m) => ({
    ...m,
    id: `before-opening-${m.id}`,
    createdAt: m.occurredAt ?? m.createdAt,
    concept: concept(m),
    detail: 'Antes de abrir el turno: ya está descontado del fondo inicial',
    cashEffect: 0,
  }))
}
