import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicTienda, getOpinionCuenta, enviarOpinionCuenta } from '../../api/publicSite'
import { applyTiendaBrand } from '../../utils/theme'
import OpinionForm from './OpinionForm'
import defaultLogo from '../../assets/logo.png'

/**
 * Página del QR del ticket ("¿Qué tal estuvo? Califícanos"): `/sitio/:slug/opinion/:token`.
 * Sin login: el código del enlace ya identifica la cuenta pagada (solo quien tiene el ticket
 * puede opinar). Una opinión por cuenta, hasta 7 días después de pagar.
 */
export default function OpinionPage() {
  const { slug, token } = useParams()
  const [tienda, setTienda] = useState(null)
  const [cuenta, setCuenta] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getPublicTienda(slug).then((r) => {
      setTienda(r.data.data)
      applyTiendaBrand(r.data.data.primaryColor)
      document.title = `Califica tu visita — ${r.data.data.nombre}`
    }).catch(() => {})
    getOpinionCuenta(slug, token)
      .then((r) => setCuenta(r.data.data))
      .catch((err) => setError(err.response?.data?.message ?? 'Este enlace no es válido'))
  }, [slug, token])

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-700 via-purple-600 to-purple-500 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 sm:p-8">
        <div className="text-center mb-4">
          <img src={tienda?.logoPath || defaultLogo} alt="" className="w-16 h-16 rounded-full object-cover border border-gray-200 mx-auto" />
          <h1 className="text-xl font-extrabold mt-2">{tienda?.nombre ?? ''}</h1>
          <p className="text-sm text-gray-500">¿Qué tal estuvo tu visita?</p>
        </div>
        {error ? (
          <p className="text-center text-red-600 bg-red-50 rounded-lg px-3 py-3">{error}</p>
        ) : !cuenta ? (
          <p className="text-center text-gray-400 py-8">Cargando...</p>
        ) : (
          <OpinionForm cuenta={cuenta}
            onEnviar={async (data) => { const r = await enviarOpinionCuenta(slug, token, data); setCuenta(r.data.data) }} />
        )}
        <a href={`/sitio/${slug}`} className="block text-center text-sm text-purple-700 hover:underline mt-5">Ver el menú del restaurante</a>
      </div>
    </div>
  )
}
