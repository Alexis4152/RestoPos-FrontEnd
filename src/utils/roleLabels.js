/**
 * Nombres de rol del sistema (el identificador interno que usa el backend) en español para
 * mostrarlos en la UI. Un rol personalizado ya tiene un nombre libre y se muestra tal cual.
 */
const ROLE_LABELS = {
  SUPER_ADMIN: 'Súper administrador',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Administrador',
  MESERO: 'Mesero',
  CAJERO: 'Cajero',
  COCINERO: 'Cocina',
  REPARTIDOR: 'Repartidor',
}

/** Traduce el nombre interno de un rol a español; cualquier otro nombre se devuelve tal cual. */
export function roleLabel(name) {
  return ROLE_LABELS[name] ?? name
}
