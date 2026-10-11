import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateTiendaTheme } from '../api/tiendas'
import { generateRamp, isValidHex, NEXORA_BLUE } from '../utils/theme'

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
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Apariencia</h1>
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
    </div>
  )
}
