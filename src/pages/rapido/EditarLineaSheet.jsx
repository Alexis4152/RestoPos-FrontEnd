import { useEffect, useState } from 'react'
import { getModificadorGrupos } from '../../api/modificadores'
import { updateOrderItem, cancelOrderItem, addOrderItem } from '../../api/ordenes'
import { useNotify } from '../../context/NotifyContext'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { gruposActivos } from './OpcionesSheet'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)
const ENTREGADO = ['ENTREGADO_MESERO', 'ENTREGADO']
const AVISO_COCINA = { PREPARANDO: 'Cocina ya lo está preparando', LISTO: 'Cocina ya lo terminó' }

/**
 * Modo rápido · editar algo ya enviado a cocina: persona, cantidad, opciones, nota, o quitarlo.
 * El sistema no frena por el estado de cocina (si ya lo están preparando, es cosa de que el
 * mesero les avise; aquí solo se le recuerda). Lo único que se respeta:
 *  - lo ya cobrado (la cantidad no baja de lo facturado ni se cambian sus opciones);
 *  - lo ya entregado no se re-prepara en la misma línea: se puede bajar o quitar, y "+1" lo
 *    manda como pieza nueva para que a cocina sí le aparezca.
 */
export default function EditarLineaSheet({ ordenId, item, comensales, onCerrar, onGuardado }) {
  const { notify, confirmDialog } = useNotify()
  const entregado = ENTREGADO.includes(item.estado)
  const facturada = Number(item.cantidadFacturada || 0)
  const [grupos, setGrupos] = useState([])
  const [sel, setSel] = useState({})
  const [modsTocados, setModsTocados] = useState(false)
  const [cantidad, setCantidad] = useState(Number(item.cantidad))
  const [persona, setPersona] = useState(item.comensal?.id ?? null)
  const [nota, setNota] = useState(item.observaciones ?? '')
  const [busy, setBusy] = useState(false)
  useEscapeKey(onCerrar)

  useEffect(() => {
    if (!item.producto?.id) return
    getModificadorGrupos(item.producto.id).then((r) => {
      const gs = gruposActivos({ modificadorGrupos: r.data.data ?? [] })
      // La línea guarda nombres (grupo + opción), no ids: se preseleccionan por nombre.
      const inicial = {}
      gs.forEach((g) => {
        inicial[g.id] = g.opciones
          .filter((o) => (item.modificadores ?? []).some((m) => m.grupoNombre === g.nombre && m.nombre === o.nombre))
          .map((o) => o.id)
      })
      setGrupos(gs)
      setSel(inicial)
    }).catch(() => {})
  }, [item])

  const puedeOpciones = !entregado && facturada === 0
  function tocar(g, opId) {
    if (!puedeOpciones) return
    setModsTocados(true)
    setSel((s) => {
      const actual = s[g.id] ?? []
      if (g.tipo === 'UNICO') return { ...s, [g.id]: actual.includes(opId) && !g.obligatorio ? [] : [opId] }
      return { ...s, [g.id]: actual.includes(opId) ? actual.filter((x) => x !== opId) : [...actual, opId] }
    })
  }
  const faltan = modsTocados ? grupos.filter((g) => g.obligatorio && (sel[g.id] ?? []).length === 0) : []
  const minimo = Math.max(1, facturada)
  const maximo = entregado ? Number(item.cantidad) : 99

  async function guardar() {
    setBusy(true)
    try {
      await updateOrderItem(ordenId, item.id, {
        comensalId: persona,
        cantidad,
        observaciones: entregado ? item.observaciones : (nota.trim() || null),
        modificadorOpcionIds: modsTocados ? Object.values(sel).flat() : undefined,
        motivo: 'Cambio desde modo rápido',
      })
      notify('Cambio guardado', 'success')
      onGuardado()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo guardar', 'error') }
    finally { setBusy(false) }
  }

  async function quitar() {
    if (!(await confirmDialog(`¿Quitar ${item.productoNombre} del pedido?`, { confirmText: 'Quitar' }))) return
    setBusy(true)
    try {
      await cancelOrderItem(ordenId, item.id, 'Quitado desde modo rápido')
      notify(`${item.productoNombre} quitado`, 'success')
      onGuardado()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo quitar', 'error') }
    finally { setBusy(false) }
  }

  async function otraPieza() {
    setBusy(true)
    try {
      const ids = grupos.flatMap((g) => sel[g.id] ?? [])
      await addOrderItem(ordenId, {
        productoId: item.producto.id, comensalId: item.comensal?.id ?? null, cantidad: 1,
        observaciones: item.observaciones || undefined, modificadorOpcionIds: ids.length ? ids : undefined,
      })
      notify('Otra pieza enviada a cocina', 'success')
      onGuardado()
    } catch (err) { notify(err.response?.data?.message ?? 'No se pudo agregar', 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center" onClick={onCerrar}>
      <div role="dialog" aria-modal="true" aria-labelledby="editar-titulo" onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto px-4 pt-3 pb-5 space-y-4">
        <span aria-hidden="true" className="block mx-auto w-11 h-1.5 rounded-full bg-[#D9D5CC] sm:hidden" />
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="editar-titulo" className="text-xl font-extrabold">{item.productoNombre}</h2>
          <span className="text-base font-extrabold">{fmt(item.subtotal)}</span>
        </div>
        {AVISO_COCINA[item.estado] && (
          <p className="-mt-2 rounded-xl bg-[#FBF0DC] px-3 py-2 text-sm text-[#6B4100]"><b>{AVISO_COCINA[item.estado]}.</b> Si cambias algo, avísales.</p>
        )}
        {entregado && (
          <p className="-mt-2 rounded-xl bg-[#F1EFEA] px-3 py-2 text-sm text-gray-700">Ya se entregó: puedes bajar la cantidad, quitarlo o cambiarlo de persona. Para otra igual usa “+1 otra pieza”.</p>
        )}

        <div className="space-y-1.5">
          <p className="text-sm font-extrabold">¿Para quién?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={persona === null} onClick={() => setPersona(null)} className={`chip ${persona === null ? 'chip-on' : ''}`}>Para la mesa</button>
            {comensales.map((c) => (
              <button key={c.id} type="button" aria-pressed={persona === c.id} onClick={() => setPersona(c.id)}
                className={`chip min-w-[44px] justify-center ${persona === c.id ? 'chip-on' : ''}`}>{c.nombre || c.numero}</button>
            ))}
          </div>
        </div>

        {grupos.map((g) => (
          <fieldset key={g.id} className="space-y-1.5" disabled={!puedeOpciones}>
            <legend className="text-sm font-extrabold">{g.nombre} <span className="font-semibold text-gray-600">· {g.tipo === 'UNICO' ? 'elige 1' : 'puedes elegir varias'}</span></legend>
            <div className="flex flex-wrap gap-2">
              {g.opciones.map((o) => {
                const on = (sel[g.id] ?? []).includes(o.id)
                return (
                  <button key={o.id} type="button" aria-pressed={on} onClick={() => tocar(g, o.id)}
                    className={`min-h-[44px] px-4 rounded-full text-sm font-bold border disabled:opacity-60 ${on ? 'border-2 border-purple-600 bg-purple-50 text-purple-800' : 'border-[#D9D5CC] bg-white text-gray-700'}`}>
                    {o.nombre}{Number(o.precioExtra) > 0 ? ` +${fmt(o.precioExtra)}` : ''}
                  </button>
                )
              })}
            </div>
          </fieldset>
        ))}

        {!entregado && (
          <div>
            <label htmlFor="editar-nota" className="text-sm font-extrabold">Nota para cocina</label>
            <input id="editar-nota" className="input mt-1" maxLength={200} placeholder="Ej. sin cebolla" value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <div className="flex items-center rounded-2xl border border-[#D9D5CC]">
            <button type="button" aria-label="Quitar uno" disabled={cantidad <= minimo} onClick={() => setCantidad((c) => Math.max(minimo, c - 1))}
              className="w-12 h-[52px] text-2xl font-extrabold disabled:opacity-40">−</button>
            <span className="min-w-[28px] text-center text-lg font-extrabold" aria-live="polite">{cantidad}</span>
            <button type="button" aria-label="Agregar uno" disabled={cantidad >= maximo} onClick={() => setCantidad((c) => Math.min(maximo, c + 1))}
              className="w-12 h-[52px] text-2xl font-extrabold disabled:opacity-40">+</button>
          </div>
          <button type="button" disabled={busy || faltan.length > 0} onClick={guardar}
            className="flex-1 min-h-[54px] rounded-2xl bg-purple-600 hover:bg-purple-700 text-white text-base font-extrabold disabled:opacity-50">
            {faltan.length > 0 ? `Elige ${faltan.map((g) => g.nombre.toLowerCase()).join(' y ')}` : 'Guardar cambios'}
          </button>
        </div>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
          {entregado && item.producto?.id && (
            <button type="button" disabled={busy} onClick={otraPieza} className="min-h-[40px] text-sm font-bold text-purple-700 hover:underline disabled:opacity-50">+1 otra pieza (a cocina)</button>
          )}
          <button type="button" disabled={busy || facturada > 0} onClick={quitar}
            className="min-h-[40px] text-sm font-bold text-red-700 hover:underline disabled:opacity-50"
            title={facturada > 0 ? 'Ya se incluyó en una cuenta' : undefined}>
            Quitar del pedido
          </button>
        </div>
      </div>
    </div>
  )
}
