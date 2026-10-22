/**
 * Dirección de entrega en campos separados: calle y número, colonia y código postal. La usan el
 * punto de venta (Para llevar → A domicilio), el checkout de la página web y la cuenta del
 * cliente. El backend arma con ellos la dirección completa (ver util/Direccion.java).
 *
 * `value` = { calle, colonia, codigoPostal }; `onChange` recibe solo el campo que cambió.
 */
export default function CamposDireccion({ value, onChange, errors = {}, inputCls = 'input', labelCls = 'text-xs font-medium text-gray-600', idPrefix = 'dir' }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="sm:col-span-3">
        <label htmlFor={`${idPrefix}-calle`} className={labelCls}>Calle y número <span className="text-red-500">*</span></label>
        <input id={`${idPrefix}-calle`} className={inputCls} maxLength={100} autoComplete="address-line1" placeholder="Ej. Av. Juárez 123, int. 4"
          value={value.calle ?? ''} onChange={(e) => onChange({ calle: e.target.value })} />
        {errors.calle && <p className="text-red-600 text-xs mt-1">{errors.calle}</p>}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-colonia`} className={labelCls}>Colonia <span className="text-red-500">*</span></label>
        <input id={`${idPrefix}-colonia`} className={inputCls} maxLength={70} autoComplete="address-level3" placeholder="Ej. Centro"
          value={value.colonia ?? ''} onChange={(e) => onChange({ colonia: e.target.value })} />
        {errors.colonia && <p className="text-red-600 text-xs mt-1">{errors.colonia}</p>}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-cp`} className={labelCls}>Código postal <span className="text-red-500">*</span></label>
        <input id={`${idPrefix}-cp`} className={inputCls} inputMode="numeric" maxLength={5} autoComplete="postal-code" placeholder="Ej. 06000"
          value={value.codigoPostal ?? ''} onChange={(e) => onChange({ codigoPostal: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
        {errors.codigoPostal && <p className="text-red-600 text-xs mt-1">{errors.codigoPostal}</p>}
      </div>
    </div>
  )
}

/** Mismas reglas que el backend (util/Direccion.java). Devuelve { calle?, colonia?, codigoPostal? }. */
export function validarDireccion(d) {
  const e = {}
  if (!d.calle?.trim()) e.calle = 'Escribe la calle y el número'
  else if (d.calle.trim().length > 100) e.calle = 'Máximo 100 caracteres'
  if (!d.colonia?.trim()) e.colonia = 'Escribe la colonia'
  else if (d.colonia.trim().length > 70) e.colonia = 'Máximo 70 caracteres'
  if (!d.codigoPostal?.trim()) e.codigoPostal = 'Escribe el código postal'
  else if (!/^\d{5}$/.test(d.codigoPostal.trim())) e.codigoPostal = 'Debe tener 5 dígitos'
  return e
}

/** Las 3 partes listas para mandar al backend. */
export const direccionPayload = (d) => ({ calle: d.calle.trim(), colonia: d.colonia.trim(), codigoPostal: d.codigoPostal.trim() })
