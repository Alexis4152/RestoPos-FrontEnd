import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Icon from './Icon'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0)

/** Lo que suman los extras libres de UNA pieza del platillo. */
export const totalLibres = (libres) => (libres ?? []).reduce((s, e) => s + Number(e.precio || 0) * Number(e.cantidad || 1), 0)

/** "Aguacate ×1 (libre)" para resúmenes de líneas por enviar. */
export const resumenLibres = (libres) => (libres ?? []).map((e) => `${e.nombre} ×${e.cantidad} (libre)`).join(' · ')

/** Extras libres de una línea ya guardada (filas `libre`, una por pieza) → [{ nombre, precio, cantidad }]. */
export function libresDeItem(mods) {
  const out = new Map()
  ;(mods ?? []).filter((m) => m.libre).forEach((m) => {
    const k = `${m.nombre}|${Number(m.precioExtra)}`
    const prev = out.get(k)
    out.set(k, prev ? { ...prev, cantidad: prev.cantidad + 1 } : { nombre: m.nombre, precio: Number(m.precioExtra), cantidad: 1 })
  })
  return [...out.values()]
}

/**
 * Extras que no están en el menú (ej. "Aguacate" $12): quien toma la orden escribe qué es, el
 * precio y cuántos. Solo si la tienda los tiene activados (Datos de la tienda); si ya hay
 * guardados y se apagó la opción, se pueden quitar pero no agregar.
 *
 * `value` [{ nombre, precio, cantidad }], `onChange(lista)`, `disabled`.
 */
export default function ExtrasLibres({ value, onChange, disabled = false }) {
  const { user } = useAuth()
  const activo = !!user?.tienda?.extraLibre
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [precio, setPrecio] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [error, setError] = useState('')
  const lista = value ?? []
  if (!activo && lista.length === 0) return null

  function cerrar() {
    setAbierto(false); setNombre(''); setPrecio(''); setCantidad(1); setError('')
  }
  function agregar() {
    const n = nombre.trim()
    const p = precio === '' ? NaN : Number(precio)
    if (!n) { setError('Escribe qué es el extra'); return }
    if (n.length > 60) { setError('Máximo 60 caracteres'); return }
    if (!Number.isFinite(p) || p < 0) { setError('Pon el precio (puede ser $0)'); return }
    if (p > 9999) { setError('El precio es demasiado alto'); return }
    if (lista.length >= 10) { setError('Máximo 10 extras libres por platillo'); return }
    onChange([...lista, { nombre: n, precio: Math.round(p * 100) / 100, cantidad }])
    cerrar()
  }

  return (
    <div className="space-y-1.5">
      {lista.length > 0 && <p className="text-sm font-extrabold">Extras libres</p>}
      {lista.map((e, i) => (
        <div key={`${e.nombre}-${i}`} className="flex items-center gap-2 rounded-lg border border-purple-600 bg-purple-50 px-3 py-1.5 text-sm">
          <span className="flex-1 min-w-0 font-semibold text-gray-800">✓ {e.nombre} ×{e.cantidad}</span>
          <span className="font-bold text-gray-700">{Number(e.precio) > 0 ? `+${fmt(Number(e.precio) * e.cantidad)}` : 'sin costo'}</span>
          {!disabled && (
            <button type="button" aria-label={`Quitar ${e.nombre}`} onClick={() => onChange(lista.filter((_, j) => j !== i))}
              className="w-8 h-8 rounded-lg text-red-700 hover:bg-red-100 flex items-center justify-center">
              <Icon name="borrar" className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
      {activo && !disabled && !abierto && (
        <button type="button" onClick={() => setAbierto(true)}
          className="min-h-[40px] px-3.5 rounded-full text-[13px] font-bold border border-dashed border-[#A8A398] bg-white text-gray-700">
          + Extra libre
        </button>
      )}
      {abierto && (
        <div className="rounded-xl border border-[#E4E1DA] p-3 space-y-2">
          <p className="text-sm font-extrabold">Extra libre <span className="font-semibold text-gray-600">· algo que no está en el menú</span></p>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <label htmlFor="extra-libre-nombre" className="text-xs font-medium text-gray-600">Qué es</label>
              <input id="extra-libre-nombre" className="input mt-0.5" maxLength={60} autoFocus placeholder="Ej. Aguacate"
                value={nombre} onChange={(e) => { setNombre(e.target.value); setError('') }} />
            </div>
            <div>
              <label htmlFor="extra-libre-precio" className="text-xs font-medium text-gray-600">Precio c/u</label>
              <input id="extra-libre-precio" className="input mt-0.5 w-24" type="number" min="0" step="0.5" inputMode="decimal" placeholder="$0"
                value={precio} onChange={(e) => { setPrecio(e.target.value); setError('') }} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-600">Cantidad</span>
            <button type="button" aria-label="Quitar uno" disabled={cantidad <= 1} onClick={() => setCantidad((c) => Math.max(1, c - 1))}
              className="w-9 h-9 rounded-full border border-[#D9D5CC] font-extrabold disabled:opacity-40">−</button>
            <span className="w-6 text-center font-extrabold">{cantidad}</span>
            <button type="button" aria-label="Agregar uno" disabled={cantidad >= 20} onClick={() => setCantidad((c) => Math.min(20, c + 1))}
              className="w-9 h-9 rounded-full bg-purple-600 text-white font-extrabold disabled:opacity-40">+</button>
            <span className="flex-1" />
            <button type="button" className="btn-secondary py-1.5" onClick={cerrar}>Cancelar</button>
            <button type="button" className="btn-primary py-1.5" onClick={agregar}>Agregar extra</button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
