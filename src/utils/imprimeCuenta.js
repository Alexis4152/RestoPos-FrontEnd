/**
 * Quién imprime la cuenta por pagar (las 2 copias cliente/comercio), configurable por tienda
 * por el SUPER_ADMIN (`tienda.imprimeCuenta`). Misma regla que `ImpresionCuentaPolicy` en el
 * backend, que es quien de verdad la hace cumplir; aquí solo decide qué botones mostrar.
 *
 * - CAJERO (default): quien cobra (rol con la sección Cortes de caja).
 * - MESERO: quien no cobra.
 * - AMBOS: cualquiera de los dos.
 * ADMIN, SUPERVISOR y SUPER_ADMIN siempre pueden.
 */
export const MODOS_IMPRIME_CUENTA = [
  { key: 'CAJERO', label: 'Solo el cajero', desc: 'El mesero genera la cuenta; el cajero la imprime y cobra.' },
  { key: 'MESERO', label: 'Solo el mesero', desc: 'El mesero imprime la cuenta y se la entrega al cliente, que paga en caja.' },
  { key: 'AMBOS', label: 'Mesero y cajero', desc: 'Cualquiera de los dos puede imprimirla.' },
]

const modoDe = (user) => user?.tienda?.imprimeCuenta || 'CAJERO'

/**
 * ¿Le toca a este usuario imprimir la cuenta por su puesto (cajero o mesero)? Se usa para
 * imprimirla en automático al generarla. No considera el permiso extra de los administradores.
 */
export function esQuienImprime(user, puedeCobrar) {
  const modo = modoDe(user)
  if (modo === 'AMBOS') return true
  return modo === 'MESERO' ? !puedeCobrar : puedeCobrar
}

/** ¿Puede imprimir la cuenta por pagar? Su puesto, o ser administrador/supervisor/super admin. */
export function puedeImprimirCuenta(user, puedeCobrar, isAdmin) {
  return !!isAdmin || esQuienImprime(user, puedeCobrar)
}

/** Texto para quien no puede imprimirla: quién sí lo hace. */
export function quienImprimeTexto(user) {
  return modoDe(user) === 'MESERO' ? 'el mesero' : 'el cajero'
}
