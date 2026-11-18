import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import {
  listPrinters, getConfiguredPrinterName, setConfiguredPrinterName,
  getKitchenPrinterName, setKitchenPrinterName, isPrintStation, setPrintStation, printTest,
} from '../utils/printer'

/**
 * "Impresoras" (Configuración): qué impresoras usa ESTA computadora. Se guarda en el navegador
 * de esta computadora, no en el servidor — cada caja/PC elige las suyas.
 *
 * - Impresora de tickets: cuentas, tickets pagados y, si la tienda NO envía a cocina, las comandas.
 * - Impresora de cocina: las comandas cuando la tienda tiene "Enviar a cocina".
 * - Estación de impresión: esta computadora imprime las comandas que mandan los meseros desde
 *   cualquier dispositivo (ver PrintStation). Debe quedar con RestoPOS abierto y QZ Tray corriendo.
 */
export default function Impresoras() {
  const { user } = useAuth()
  const { notify } = useNotify()
  const aCocina = user?.tienda?.enviarACocina !== false
  const [printers, setPrinters] = useState(null)
  const [qzError, setQzError] = useState('')
  const [ticket, setTicket] = useState(getConfiguredPrinterName())
  const [cocina, setCocina] = useState(getKitchenPrinterName())
  const [estacion, setEstacion] = useState(isPrintStation())
  const [probando, setProbando] = useState('')

  function cargar() {
    setQzError('')
    listPrinters()
      .then((list) => setPrinters(list ?? []))
      .catch((err) => { setPrinters([]); setQzError(err.message || 'No se pudo conectar con QZ Tray') })
  }
  useEffect(cargar, [])

  function guardar() {
    setConfiguredPrinterName(ticket)
    setKitchenPrinterName(cocina)
    setPrintStation(estacion)
    notify('Impresoras guardadas en esta computadora', 'success')
  }

  async function probar(nombre, titulo) {
    setProbando(titulo)
    try {
      await printTest(nombre || undefined, titulo)
      notify(`Prueba enviada a ${nombre || 'la impresora predeterminada'}`, 'success')
    } catch (err) {
      notify(err.message || 'No se pudo imprimir la prueba', 'error')
    } finally {
      setProbando('')
    }
  }

  const selector = (id, value, onChange, vacio) => (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={!printers?.length}>
      <option value="">{vacio}</option>
      {(printers ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
      {value && printers && !printers.includes(value) && <option value={value}>{value} (no encontrada)</option>}
    </select>
  )

  return (
    <div className="max-w-xl">
      <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900 mb-1">Impresoras</h1>
      <p className="text-gray-500 text-sm mb-6">
        Se guarda solo en <b>esta computadora</b>. Necesita QZ Tray instalado y corriendo (qz.io/download).
      </p>

      <div className="card space-y-5">
        {qzError && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-4 py-3">
            {qzError} <button type="button" className="underline font-semibold ml-1" onClick={cargar}>Reintentar</button>
          </div>
        )}
        {printers === null && <p className="text-sm text-gray-400">Buscando impresoras…</p>}

        <div>
          <label htmlFor="imp-ticket" className="block text-sm font-semibold text-gray-800 mb-1">Impresora de tickets</label>
          <div className="flex gap-2">
            <div className="flex-1">{selector('imp-ticket', ticket, setTicket, 'La predeterminada del sistema')}</div>
            <button type="button" className="btn-secondary shrink-0" disabled={!!probando || !!qzError} onClick={() => probar(ticket, 'Impresora de tickets')}>
              {probando === 'Impresora de tickets' ? 'Imprimiendo…' : 'Probar'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Cuentas y tickets{aCocina ? '.' : ', y también las comandas (esta tienda no envía a cocina: las órdenes salen aquí).'}
          </p>
        </div>

        <div>
          <label htmlFor="imp-cocina" className="block text-sm font-semibold text-gray-800 mb-1">Impresora de cocina</label>
          <div className="flex gap-2">
            <div className="flex-1">{selector('imp-cocina', cocina, setCocina, 'La misma de tickets')}</div>
            <button type="button" className="btn-secondary shrink-0" disabled={!!probando || !!qzError} onClick={() => probar(cocina || ticket, 'Impresora de cocina')}>
              {probando === 'Impresora de cocina' ? 'Imprimiendo…' : 'Probar'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {aCocina
              ? 'Aquí salen las comandas de "Enviar a cocina". Normalmente es una impresora de red que está en la cocina.'
              : 'Esta tienda no tiene "Enviar a cocina" activo: por ahora no se usa.'}
          </p>
        </div>

        <label className="flex items-start gap-3 border-t border-gray-100 pt-4 cursor-pointer">
          <input type="checkbox" className="mt-1 w-4 h-4" checked={estacion} onChange={(e) => setEstacion(e.target.checked)} />
          <span>
            <span className="block text-sm font-semibold text-gray-800">Esta computadora es la estación de impresión</span>
            <span className="block text-xs text-gray-600 mt-0.5">
              Imprime automáticamente las comandas que mandan los meseros desde cualquier dispositivo (celular, tablet).
              Déjala con RestoPOS abierto en esta tienda. Activa solo una por tienda (si hay dos, no se duplican, pero
              cada comanda sale en la que la tome primero).
            </span>
          </span>
        </label>

        <button type="button" className="btn-primary" onClick={guardar}>Guardar</button>
      </div>
    </div>
  )
}
