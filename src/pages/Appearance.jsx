import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateTiendaTheme } from '../api/tiendas'
import { generateRamp, generateDarkRamp, isValidHex, NEXORA_BLUE } from '../utils/theme'
import { MODOS, useModo } from '../utils/themeMode'

/**
 * Pantalla "Apariencia": permite al administrador de la tienda elegir el color de marca
 * (`primaryColor`) que se usa en botones, menú activo y el fondo del sidebar para todos
 * los usuarios de esa tienda.
 *
 * Acceso: solo tiene sentido para usuarios `ADMIN` con tienda propia (no aplica a
 * `SUPER_ADMIN`, que no pertenece a ninguna tienda y siempre ve el azul "Nexora" fijo).
 * La visibilidad de la ruta ya se controla a nivel de `PrivateRoute`/menú; este componente
 * no vuelve a chequear el rol.
 *
 * También elige el modo de pantalla (claro / oscuro / automático) de ESTE dispositivo y
 * muestra cómo se ve el color de la tienda en ambos modos (en oscuro la paleta se ajusta
 * sola para que se lea, ver generateDarkRamp).
 *
 * Al guardar, además de persistir el color en el backend, llama a `patchTienda()` de
 * `AuthContext` para reflejar el cambio de inmediato en el sidebar y el resto de la UI
 * sin necesidad de recargar la página ni volver a iniciar sesión.
 */
export default function Appearance() {
  const { user, patchTienda } = useAuth()
  const [color, setColor] = useState(user?.tienda?.primaryColor || NEXORA_BLUE)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Genera la paleta (rampa de tonos claro→oscuro) a partir del color elegido, solo para
  // mostrar la vista previa; si el usuario aún no eligió un hex válido no se calcula nada.
  const previewRamp = isValidHex(color) ? generateRamp(color) : null
  const previewDark = isValidHex(color) ? generateDarkRamp(color) : null
  const { modo, setModo } = useModo()

  /**
   * Guarda el nuevo color de marca de la tienda en el backend y, si tiene éxito,
   * actualiza el `AuthContext` en memoria (vía `patchTienda`) para que el cambio se
   * vea reflejado al instante en el sidebar y demás componentes que usan el color de marca.
   */
  async function handleSave() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await updateTiendaTheme(user.tienda.id, color)
      patchTienda({ primaryColor: color })
      setMessage('Color guardado')
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo guardar el color')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900 mb-1">Apariencia</h1>
      <p className="text-gray-500 text-sm mb-6">
        Elige el color de marca de <span className="font-medium">{user?.tienda?.name}</span>. Se usa en botones,
        menú activo y el fondo del sidebar de todos los usuarios de tu tienda.
      </p>

      <div className="card space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-16 h-16 rounded-lg border border-gray-200 cursor-pointer"
          />
          <div>
            <p className="text-sm font-medium text-gray-700">Color de tu tienda</p>
            <p className="text-xs text-gray-500 font-mono">{color}</p>
          </div>
        </div>

        {previewRamp && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Vista previa de la paleta generada</p>
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              {Object.entries(previewRamp).map(([key, rgb]) => (
                <div key={key} className="flex-1 h-10" style={{ backgroundColor: `rgb(${rgb.split(' ').join(',')})` }} title={key} />
              ))}
            </div>
          </div>
        )}

        {previewRamp && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Así se ve en cada modo</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <MuestraModo titulo="Claro" ramp={previewRamp} fondo="#F4F3EF" tarjeta="#FFFFFF" texto="#1F2937" borde="#E4E1DA" />
              <MuestraModo titulo="Oscuro" ramp={previewDark} fondo="#141412" tarjeta="#1C1C1A" texto="#F2F1EE" borde="#3A3935" />
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
        )}
        {message && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">{message}</div>
        )}

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar color'}
        </button>
      </div>

      <div className="card space-y-3 mt-5">
        <div>
          <h2 className="text-base font-extrabold">Modo de pantalla</h2>
          <p className="text-sm text-gray-600">
            Se guarda en este dispositivo: cada quien elige el suyo (también desde el botón del encabezado).
            Automático sigue el modo del sistema. La página web de la tienda siempre se ve en claro.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Modo de pantalla">
          {MODOS.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={modo === m.key} onClick={() => setModo(m.key)}
              className={`chip ${modo === m.key ? 'chip-on' : ''}`}>{m.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

const rgb = (t) => `rgb(${t.split(' ').join(',')})`

/** Mini pantalla con el color de la tienda aplicado: botón, elemento seleccionado y texto de acento. */
function MuestraModo({ titulo, ramp, fondo, tarjeta, texto, borde }) {
  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: fondo, border: `1px solid ${borde}` }}>
      <p className="text-xs font-bold mb-2" style={{ color: texto }}>{titulo}</p>
      <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: tarjeta, border: `1px solid ${borde}` }}>
        <span className="block text-sm font-bold" style={{ color: rgb(ramp[700]) }}>Mesa 4 · 3 personas</span>
        <span className="block rounded-lg px-2 py-1.5 text-xs font-semibold" style={{ backgroundColor: rgb(ramp[50]), border: `2px solid ${rgb(ramp[600])}`, color: texto }}>
          Seleccionado
        </span>
        <span className="inline-block rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: rgb(ramp[600]) }}>
          Cobrar
        </span>
      </div>
    </div>
  )
}
