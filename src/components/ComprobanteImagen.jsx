import { useEffect, useState } from 'react'
import api from '../api/axios'

/**
 * Foto del comprobante de transferencia de un pedido web. No es un archivo público: se pide a
 * `GET /api/comprobantes/orden/{id}` con la sesión del personal (el JWT lo agrega `api/axios`)
 * y se muestra desde un blob en memoria. Solo la pueden ver repartidor, caja, ADMIN y SUPERVISOR;
 * a quien no tenga permiso (403) no se le muestra nada.
 */
export default function ComprobanteImagen({ ordenId, version, className = '' }) {
  const [url, setUrl] = useState(null)
  const [estado, setEstado] = useState('cargando') // cargando | ok | sinPermiso | error

  useEffect(() => {
    let objectUrl = null
    let vivo = true
    setEstado('cargando')
    api.get(`/comprobantes/orden/${ordenId}`, { responseType: 'blob' })
      .then((r) => {
        if (!vivo) return
        objectUrl = URL.createObjectURL(r.data)
        setUrl(objectUrl)
        setEstado('ok')
      })
      .catch((err) => { if (vivo) setEstado(err.response?.status === 403 ? 'sinPermiso' : 'error') })
    return () => { vivo = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
    // `version` (ej. la fecha en que se subió) vuelve a pedirla si el cliente la cambia.
  }, [ordenId, version])

  if (estado === 'sinPermiso') return null
  if (estado === 'cargando') return <p className="text-xs text-gray-500">Cargando comprobante...</p>
  if (estado === 'error') return <p className="text-xs text-red-600">No se pudo cargar el comprobante.</p>
  return (
    <>
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt="Comprobante de transferencia"
          className={`w-full max-h-72 object-contain rounded-xl border border-gray-200 bg-gray-50 ${className}`} />
      </a>
      <p className="text-xs text-gray-500 mt-1">Toca la imagen para verla completa. Revisa que el monto y la cuenta coincidan.</p>
    </>
  )
}
