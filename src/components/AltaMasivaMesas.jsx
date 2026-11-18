import { useState } from 'react'
import { createTablesBulk } from '../api/mesas'
import { useNotify } from '../context/NotifyContext'
import { useEscapeKey } from '../hooks/useEscapeKey'
import ModalCloseButton from './ModalCloseButton'
import Icon from './Icon'

const NUEVA = 'NUEVA'
const filaVacia = (zona = '') => ({ key: Math.random().toString(36).slice(2), zona, zonaNombre: '', cantidad: '4', desde: '', prefijo: '', capacidad: '4' })
const soloDigitos = (v, max) => v.replace(/\D/g, '').slice(0, max)

/**
 * Alta rápida: varias mesas, varias zonas, o varias zonas con sus mesas de un golpe. Cada fila es
 * una zona (existente o nueva) con N mesas numeradas en secuencia. Si no se escribe "desde", se
 * sigue la numeración después de la mesa más alta (contando las filas de arriba). Todo o nada:
 * si algún número ya existe, el backend no crea nada y dice cuáles chocan.
 */
export default function AltaMasivaMesas({ zonas, tables, zonaInicial, onClose, onCreadas }) {
  const { notify, confirmDialog } = useNotify()
  const [filas, setFilas] = useState(() => [filaVacia(zonaInicial ? String(zonaInicial) : (zonas.length ? String(zonas[0].id) : NUEVA))])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  useEscapeKey(() => { if (!guardando) onClose() }, true)

  const cambiar = (key, patch) => setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)))

  // Numeración sugerida: después de la mesa numérica más alta, y de lo que ya suman las filas de arriba.
  const maxExistente = tables.reduce((mx, m) => (/^\d+$/.test(String(m.numero)) ? Math.max(mx, Number(m.numero)) : mx), 0)
  const calculadas = []
  let siguiente = maxExistente + 1
  for (const f of filas) {
    const cantidad = Number(f.cantidad) || 0
    const desde = f.desde !== '' ? Number(f.desde) : (f.prefijo.trim() ? 1 : siguiente)
    calculadas.push({ ...f, cantidadN: cantidad, desdeN: desde })
    if (!f.prefijo.trim() && cantidad > 0) siguiente = Math.max(siguiente, desde + cantidad)
  }

  const nombreZona = (f) => (f.zona === NUEVA ? (f.zonaNombre.trim() || 'Zona nueva') : zonas.find((z) => String(z.id) === f.zona)?.nombre ?? '—')
  const rango = (f) => {
    if (!f.cantidadN) return 'sin mesas (solo la zona)'
    const p = f.prefijo.trim()
    const a = `${p}${f.desdeN}`
    const b = `${p}${f.desdeN + f.cantidadN - 1}`
    return `${f.cantidadN} mesa${f.cantidadN === 1 ? '' : 's'}: ${f.cantidadN === 1 ? a : `${a} a ${b}`}${f.capacidad ? ` · ${f.capacidad} lugares` : ''}`
  }
  const totalMesas = calculadas.reduce((s, f) => s + f.cantidadN, 0)
  const zonasNuevas = new Set(calculadas.filter((f) => f.zona === NUEVA && f.zonaNombre.trim()).map((f) => f.zonaNombre.trim().toLowerCase())).size

  function validar() {
    for (const f of calculadas) {
      if (f.zona === NUEVA && !f.zonaNombre.trim()) return 'Escribe el nombre de cada zona nueva'
      if (f.cantidadN > 200) return 'Máximo 200 mesas por zona a la vez'
      if (f.zona !== NUEVA && f.cantidadN === 0) return `En "${nombreZona(f)}" indica cuántas mesas agregar`
    }
    if (totalMesas === 0 && zonasNuevas === 0) return 'No hay nada que crear'
    return ''
  }

  async function guardar() {
    const msg = validar()
    if (msg) { setError(msg); return }
    const resumen = [
      totalMesas ? `${totalMesas} mesa${totalMesas === 1 ? '' : 's'}` : null,
      zonasNuevas ? `${zonasNuevas} zona${zonasNuevas === 1 ? '' : 's'} nueva${zonasNuevas === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' y ')
    if (!(await confirmDialog(`¿Crear ${resumen}?`, { confirmText: 'Crear', danger: false }))) return
    setGuardando(true)
    setError('')
    try {
      const r = await createTablesBulk({
        grupos: calculadas.map((f) => ({
          zonaId: f.zona !== NUEVA ? Number(f.zona) : undefined,
          zonaNombre: f.zona === NUEVA ? f.zonaNombre.trim() : undefined,
          cantidad: f.cantidadN,
          desde: f.desdeN,
          prefijo: f.prefijo.trim() || undefined,
          capacidad: f.capacidad ? Number(f.capacidad) : undefined,
        })),
      })
      notify(r.data.message ?? 'Mesas creadas', 'success')
      onCreadas()
    } catch (err) {
      const data = err.response?.data?.data
      setError(err.response?.data?.message ?? (data && typeof data === 'object' ? Object.values(data)[0] : 'No se pudieron crear'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="alta-masiva-titulo"
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <ModalCloseButton onClick={() => !guardando && onClose()} />
        <div className="p-6 pb-3 pr-14">
          <h3 id="alta-masiva-titulo" className="text-lg font-extrabold">Agregar varias mesas y zonas</h3>
          <p className="text-sm text-gray-600 mt-1">
            Cada renglón es una zona (existente o nueva) con sus mesas numeradas en orden. Agrega los renglones que necesites.
          </p>
        </div>

        <div className="px-6 overflow-y-auto space-y-3 flex-1">
          {calculadas.map((f, i) => (
            <fieldset key={f.key} className="rounded-xl border border-[#E4E1DA] p-3.5 space-y-3">
              <legend className="sr-only">Zona {i + 1}</legend>
              <div className="grid grid-cols-2 sm:grid-cols-12 gap-2.5 items-end">
                <label className="col-span-2 sm:col-span-4">
                  <span className="text-xs font-semibold text-gray-600">Zona</span>
                  <select className="input" value={f.zona} onChange={(e) => cambiar(f.key, { zona: e.target.value })}>
                    {zonas.map((z) => <option key={z.id} value={String(z.id)}>{z.nombre}</option>)}
                    <option value={NUEVA}>+ Zona nueva…</option>
                  </select>
                </label>
                {f.zona === NUEVA && (
                  <label className="col-span-2 sm:col-span-8">
                    <span className="text-xs font-semibold text-gray-600">Nombre de la zona nueva</span>
                    <input className="input" maxLength={100} placeholder="Ej. Terraza, Salón, Barra" value={f.zonaNombre}
                      onChange={(e) => cambiar(f.key, { zonaNombre: e.target.value })} />
                  </label>
                )}
                <label className="sm:col-span-3">
                  <span className="text-xs font-semibold text-gray-600">¿Cuántas mesas?</span>
                  <input className="input" inputMode="numeric" value={f.cantidad} onChange={(e) => cambiar(f.key, { cantidad: soloDigitos(e.target.value, 3) })} />
                </label>
                <label className="sm:col-span-3">
                  <span className="text-xs font-semibold text-gray-600">Numerar desde</span>
                  <input className="input" inputMode="numeric" placeholder={String(f.desdeN)} value={f.desde} onChange={(e) => cambiar(f.key, { desde: soloDigitos(e.target.value, 5) })} />
                </label>
                <label className="sm:col-span-3">
                  <span className="text-xs font-semibold text-gray-600">Prefijo (opcional)</span>
                  <input className="input" maxLength={10} placeholder="Ej. T" value={f.prefijo} onChange={(e) => cambiar(f.key, { prefijo: e.target.value })} />
                </label>
                <label className="sm:col-span-3">
                  <span className="text-xs font-semibold text-gray-600">Lugares por mesa</span>
                  <input className="input" inputMode="numeric" placeholder="Sin capturar" value={f.capacidad} onChange={(e) => cambiar(f.key, { capacidad: soloDigitos(e.target.value, 3) })} />
                </label>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <p className="flex-1 text-gray-700"><b>{nombreZona(f)}{f.zona === NUEVA ? ' (nueva)' : ''}</b> · {rango(f)}</p>
                {filas.length > 1 && (
                  <button type="button" className="text-red-700 font-semibold hover:underline" onClick={() => setFilas((fs) => fs.filter((x) => x.key !== f.key))}>Quitar</button>
                )}
              </div>
            </fieldset>
          ))}
          <button type="button" className="w-full min-h-[44px] rounded-xl border-2 border-dashed border-gray-300 text-gray-600 hover:border-purple-400 hover:text-purple-700 font-semibold inline-flex items-center justify-center gap-2"
            onClick={() => setFilas((fs) => [...fs, filaVacia(NUEVA)])}>
            <Icon name="mas" className="w-4 h-4" /> Otra zona
          </button>
        </div>

        <div className="p-6 pt-4 border-t border-gray-100 space-y-3">
          {error && <p className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-sm text-gray-700">
              Se crearán <b>{totalMesas} mesa{totalMesas === 1 ? '' : 's'}</b>{zonasNuevas ? <> y <b>{zonasNuevas} zona{zonasNuevas === 1 ? '' : 's'} nueva{zonasNuevas === 1 ? '' : 's'}</b></> : null}
            </p>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={guardando}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Creando…' : 'Crear'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
