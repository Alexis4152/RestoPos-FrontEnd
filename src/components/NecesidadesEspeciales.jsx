import { OCASIONES, iconoOcasion } from '../utils/reservaciones'

/**
 * Campos de "necesidades especiales" de una reservación (periqueras, mesa accesible, carriola,
 * ocasión y otras indicaciones). Lo usan el formulario de la página web y el del personal.
 * `value` = { periqueras, accesible, carriola, ocasion, notas }; `onChange(parcial)`.
 */
export default function NecesidadesEspeciales({ value, onChange, personas = 1 }) {
  const maxPeriqueras = Math.min(10, personas)
  const periqueras = Math.min(value.periqueras ?? 0, maxPeriqueras)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
        <div>
          <p className="text-sm font-medium text-gray-800">🪑 Periqueras para bebé</p>
          <p className="text-xs text-gray-500">Sillas altas para niños pequeños</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Quitar periquera" disabled={periqueras <= 0}
            onClick={() => onChange({ periqueras: periqueras - 1 })}
            className="w-8 h-8 rounded-full border border-gray-300 text-lg leading-none hover:bg-gray-50 disabled:opacity-30">−</button>
          <span className="w-6 text-center font-semibold">{periqueras}</span>
          <button type="button" aria-label="Agregar periquera" disabled={periqueras >= maxPeriqueras}
            onClick={() => onChange({ periqueras: periqueras + 1 })}
            className="w-8 h-8 rounded-full border border-gray-300 text-lg leading-none hover:bg-gray-50 disabled:opacity-30">+</button>
        </div>
      </div>

      <label className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer ${value.accesible ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'}`}>
        <input type="checkbox" className="mt-1 w-4 h-4" checked={!!value.accesible} onChange={(e) => onChange({ accesible: e.target.checked })} />
        <span>
          <span className="block text-sm font-medium text-gray-800">♿ Persona con discapacidad o movilidad reducida</span>
          <span className="block text-xs text-gray-500">Te damos una mesa accesible, sin escalones y con espacio para silla de ruedas.</span>
        </span>
      </label>

      <label className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer ${value.carriola ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'}`}>
        <input type="checkbox" className="mt-1 w-4 h-4" checked={!!value.carriola} onChange={(e) => onChange({ carriola: e.target.checked })} />
        <span>
          <span className="block text-sm font-medium text-gray-800">👶 Llevamos carriola</span>
          <span className="block text-xs text-gray-500">Apartamos espacio junto a la mesa.</span>
        </span>
      </label>

      <div>
        <p className="text-sm font-medium text-gray-800 mb-1.5">¿Celebran algo?</p>
        <div className="flex flex-wrap gap-2">
          {OCASIONES.map((o) => {
            const activa = value.ocasion === o
            return (
              <button key={o} type="button" onClick={() => onChange({ ocasion: activa ? '' : o })}
                className={`px-3 py-1.5 rounded-full text-sm border ${activa ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'}`}>
                {iconoOcasion(o)} {o}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1">Otras indicaciones (opcional)</label>
        <textarea rows={2} maxLength={500} value={value.notas ?? ''} onChange={(e) => onChange({ notas: e.target.value })}
          placeholder="Ej. alergias, preferimos estar lejos de la puerta, llegamos con un perro de asistencia..."
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
      </div>
    </div>
  )
}
