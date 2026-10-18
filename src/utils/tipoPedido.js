/**
 * Tipos de una orden sin mesa (Orden.tipoEntrega) y qué datos del cliente pide cada uno.
 * Mismas reglas que OrdenService#abrir en el backend. Los pedidos de la página web solo
 * usan RECOGER o DOMICILIO.
 */
export const TIPOS_PEDIDO = [
  { key: 'PARA_LLEVAR', label: 'Para llevar', hint: 'Está en caja y se lo lleva', telefono: false, direccion: false },
  { key: 'COMER_AQUI', label: 'Comer aquí', hint: 'Ordena y se sienta donde quiera', telefono: false, direccion: false },
  { key: 'RECOGER', label: 'Para recoger', hint: 'Pide y viene por él', telefono: true, direccion: false },
  { key: 'DOMICILIO', label: 'A domicilio', hint: 'Se le lleva a su dirección', telefono: true, direccion: true },
]

export const tipoPedido = (key) => TIPOS_PEDIDO.find((t) => t.key === key) ?? TIPOS_PEDIDO[0]

/** Texto corto del tipo de una orden sin mesa ("Para llevar", "Comer aquí"...). */
export const etiquetaTipoPedido = (o) => tipoPedido(o?.tipoEntrega).label
