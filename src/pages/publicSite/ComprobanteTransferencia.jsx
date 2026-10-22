import { useRef, useState } from 'react'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))

/**
 * El cliente que paga por transferencia (a domicilio o para recoger) sube la foto de su comprobante y decide si
 * la transferencia incluye el costo de envío (si no, el envío se le paga en efectivo al
 * repartidor). Mientras no lo suba, el repartidor ve el pedido "Por cobrar". La foto no se le
 * vuelve a mostrar al cliente: solo la ve el personal de la tienda con su sesión.
 *
 * Se usa en el seguimiento del pedido (por código) y en "Mis pedidos" (cliente registrado);
 * `onSubir(file, incluyeEnvio)` hace la llamada que toque y regresa la respuesta del backend.
 */
// `tienda` (opcional): si se pasa, muestra también los datos de la cuenta para transferir.
export default function ComprobanteTransferencia({ status, tienda, onSubir, onActualizado }) {
  const envio = Number(status.costoEnvio || 0)
  const total = Number(status.total || 0)
  const [incluyeEnvio, setIncluyeEnvio] = useState(status.transferenciaIncluyeEnvio ?? true)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const montoTransferir = envio > 0 && !incluyeEnvio ? total - envio : total

  async function subir(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 3 * 1024 * 1024) { setError('La foto no debe pesar más de 3 MB'); return }
    setSubiendo(true); setError('')
    try {
      const r = await onSubir(file, incluyeEnvio)
      onActualizado?.(r.data.data)
    } catch (err) {
      setError(err.response?.data?.message ?? 'No se pudo subir el comprobante, intenta de nuevo')
    } finally { setSubiendo(false) }
  }

  return (
    <div className="mt-3 rounded-xl border border-gray-200 p-3 text-sm">
      {tienda?.transferenciaClabe && (
        <div className="mb-3 rounded-lg bg-blue-50 border border-blue-200 p-2 text-blue-900 space-y-0.5">
          <p className="font-semibold">Datos para transferir</p>
          {tienda.transferenciaBanco && <p>Banco: <span className="font-medium">{tienda.transferenciaBanco}</span></p>}
          {tienda.transferenciaTitular && <p>Titular: <span className="font-medium">{tienda.transferenciaTitular}</span></p>}
          <p>CLABE / cuenta: <span className="font-mono font-semibold select-all">{tienda.transferenciaClabe}</span></p>
        </div>
      )}
      {envio > 0 && (
        <div className="space-y-1">
          <p className="font-semibold text-gray-800">¿Tu transferencia incluye el envío ({fmt(envio)})?</p>
          <label className="flex items-center gap-2"><input type="radio" checked={incluyeEnvio} onChange={() => setIncluyeEnvio(true)} disabled={subiendo} />
            Sí, transfiero todo</label>
          <label className="flex items-center gap-2"><input type="radio" checked={!incluyeEnvio} onChange={() => setIncluyeEnvio(false)} disabled={subiendo} />
            No, el envío se lo pago en efectivo al repartidor</label>
        </div>
      )}
      <p className={`${envio > 0 ? 'mt-2' : ''} text-gray-700`}>Monto a transferir: <span className="font-bold">{fmt(montoTransferir)}</span>
        {envio > 0 && !incluyeEnvio && <span className="text-gray-500"> · {fmt(envio)} en efectivo al recibir</span>}</p>

      {status.comprobanteEnviado ? (
        <div className="mt-3 rounded-lg bg-green-50 border border-green-200 p-2">
          <p className="font-semibold text-green-800">✅ Comprobante enviado</p>
          <p className="text-xs text-green-700">{status.transferenciaIncluyeEnvio === false ? 'Incluye solo platillos · envío en efectivo' : 'Incluye el total'}</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-gray-500">Sube la captura o foto de tu transferencia para que el repartidor la vea como pagada. Solo la ve el personal de la tienda.</p>
      )}

      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={subir} />
      <button type="button" disabled={subiendo} onClick={() => inputRef.current?.click()}
        className="mt-3 w-full rounded-full bg-purple-600 py-2.5 font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
        {subiendo ? 'Subiendo...' : status.comprobanteEnviado ? 'Cambiar comprobante' : '📷 Subir comprobante'}
      </button>
      {status.comprobanteEnviado && envio > 0 && (status.transferenciaIncluyeEnvio ?? true) !== incluyeEnvio && (
        <p className="text-xs text-orange-700 mt-1">Para cambiar si incluye el envío, vuelve a subir el comprobante.</p>
      )}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

/** ¿Este pedido puede subir comprobante? (transferencia a domicilio, todavía sin entregar ni rechazar). */
export const puedeSubirComprobante = (status) => status?.metodoPago === 'TRANSFERENCIA'
  && (status.tipoEntrega === 'DOMICILIO' || status.tipoEntrega === 'RECOGER')
  && !['ENTREGADO', 'RECHAZADO'].includes(status.estado)
