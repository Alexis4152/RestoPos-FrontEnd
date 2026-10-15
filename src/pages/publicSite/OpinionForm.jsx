import { useState } from 'react'
import { Stars } from './Account'

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n ?? 0))
const fmtFecha = (d) => (d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '')
const inputCls = 'mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-300'

/**
 * Opinión de una cuenta de MESA (visita al restaurante): estrellas de la experiencia, de la
 * atención del mesero (opcional), 👍/👎 por platillo (opcional) y comentario. La usan la página
 * del QR del ticket (OpinionPage) y "Mis pedidos" del cliente registrado. `cuenta` es el
 * CuentaParaOpinar del backend; `onEnviar(data)` regresa la cuenta actualizada.
 */
export default function OpinionForm({ cuenta, onEnviar, compacto = false }) {
  const [estrellas, setEstrellas] = useState(0)
  const [meseroEstrellas, setMeseroEstrellas] = useState(0)
  const [votos, setVotos] = useState({}) // { ordenDetalleId: true (👍) | false (👎) }
  const [comentario, setComentario] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const encabezado = (
    <div className={compacto ? '' : 'mb-3'}>
      <p className="text-sm text-gray-500">
        {cuenta.mesa ? `Mesa ${cuenta.mesa} · ` : ''}{fmtFecha(cuenta.fecha)}{cuenta.mesero ? ` · Te atendió ${cuenta.mesero}` : ''}
      </p>
      <p className="text-sm text-gray-500">Total {fmt(cuenta.total)}</p>
    </div>
  )

  if (cuenta.estado === 'YA_OPINADA' && cuenta.opinion) {
    const o = cuenta.opinion
    return (
      <div>
        {encabezado}
        <p className="text-xs font-semibold text-gray-500 uppercase">Tu opinión</p>
        <Stars value={o.estrellas} size="text-xl" />
        {o.meseroEstrellas && (
          <p className="text-sm text-gray-600 mt-1">Atención: <Stars value={o.meseroEstrellas} size="text-base" /></p>
        )}
        {o.platillos.length > 0 && (
          <p className="text-sm text-gray-700 mt-1">{o.platillos.map((p) => `${p.meGusta ? '👍' : '👎'} ${p.nombre}`).join(' · ')}</p>
        )}
        {o.comentario && <p className="text-sm text-gray-700 italic mt-1">"{o.comentario}"</p>}
        <p className="text-sm text-green-700 font-semibold mt-2">¡Gracias por tu opinión!</p>
      </div>
    )
  }
  if (cuenta.estado === 'VENCIDA') {
    return <div>{encabezado}<p className="text-sm text-gray-500">El plazo para opinar de esta visita ya terminó.</p></div>
  }
  if (cuenta.estado === 'NO_PAGADA') {
    return <div>{encabezado}<p className="text-sm text-gray-500">Podrás opinar cuando se pague la cuenta.</p></div>
  }

  const votar = (id, valor) => setVotos((v) => {
    const n = { ...v }
    if (n[id] === valor) delete n[id]; else n[id] = valor // tocar el mismo otra vez lo quita
    return n
  })
  const hasta = cuenta.opinarHasta ? new Date(cuenta.opinarHasta).toLocaleDateString('es-MX', { dateStyle: 'medium' }) : null

  async function enviar(e) {
    e.preventDefault()
    if (estrellas < 1) { setError('Elige de 1 a 5 estrellas para tu experiencia'); return }
    setSaving(true)
    setError('')
    try {
      await onEnviar({
        estrellas,
        meseroEstrellas: meseroEstrellas || undefined,
        comentario: comentario.trim() || undefined,
        platillos: Object.entries(votos).map(([id, meGusta]) => ({ ordenDetalleId: Number(id), meGusta })),
      })
    } catch (err) {
      setError(err.response?.data?.message ?? 'No se pudo enviar tu opinión')
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      {encabezado}
      <div>
        <p className="font-semibold">¿Cómo estuvo tu experiencia? *</p>
        <Stars value={estrellas} onChange={(n) => { setEstrellas(n); setError('') }} size="text-3xl" />
      </div>
      {cuenta.mesero && (
        <div>
          <p className="font-semibold">¿Y la atención de {cuenta.mesero}? <span className="text-xs font-normal text-gray-400">(opcional)</span></p>
          <Stars value={meseroEstrellas} onChange={setMeseroEstrellas} size="text-2xl" />
        </div>
      )}
      {cuenta.platillos.length > 0 && (
        <div>
          <p className="font-semibold">¿Qué te gustó? <span className="text-xs font-normal text-gray-400">(opcional)</span></p>
          <div className="mt-1 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {cuenta.platillos.map((p) => (
              <div key={p.ordenDetalleId} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 text-sm">{Number(p.cantidad)}× {p.nombre}</span>
                <button type="button" onClick={() => votar(p.ordenDetalleId, true)} aria-label="Me gustó"
                  className={`w-10 h-9 rounded-lg border text-lg ${votos[p.ordenDetalleId] === true ? 'bg-green-100 border-green-500' : 'border-gray-200 hover:bg-gray-50'}`}>👍</button>
                <button type="button" onClick={() => votar(p.ordenDetalleId, false)} aria-label="No me gustó"
                  className={`w-10 h-9 rounded-lg border text-lg ${votos[p.ordenDetalleId] === false ? 'bg-red-100 border-red-500' : 'border-gray-200 hover:bg-gray-50'}`}>👎</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="font-semibold">Comentario <span className="text-xs font-normal text-gray-400">(opcional)</span></p>
        <textarea className={inputCls} rows={3} maxLength={500} placeholder="Cuéntanos qué te pareció"
          value={comentario} onChange={(e) => setComentario(e.target.value)} />
        <p className="text-xs text-gray-400 text-right">{comentario.length}/500</p>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      <button disabled={saving} className="w-full rounded-full bg-purple-600 text-white py-3 font-semibold hover:bg-purple-700 disabled:opacity-40">
        {saving ? 'Enviando...' : 'Enviar opinión'}
      </button>
      {hasta && <p className="text-xs text-gray-400 text-center">Puedes opinar hasta el {hasta}.</p>}
    </form>
  )
}
