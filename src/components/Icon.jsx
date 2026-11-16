/**
 * Íconos de línea (trazo) del sistema — reemplazan a los emojis del menú y de las
 * pantallas rediseñadas para que todo se vea del mismo peso y color (toman `currentColor`).
 * Uso: <Icon name="mesas" className="w-5 h-5" />. Decorativos por defecto (aria-hidden);
 * si el ícono va solo en un botón, el botón lleva su `aria-label`.
 */
const PATHS = {
  inicio: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
  mesas: <><rect x="3" y="8" width="18" height="6" rx="2" /><path d="M6 14v6M18 14v6M8 4h8" /></>,
  reservas: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  llevar: <><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  ordenes: <><path d="M8 4h8a2 2 0 0 1 2 2v14H6V6a2 2 0 0 1 2-2z" /><path d="M9 9h6M9 13h6M9 17h3" /></>,
  cocina: <><path d="M4 11h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z" /><path d="M2 11h20M9 4c0 2 2 2 2 4M14 4c0 2 2 2 2 4" /></>,
  entregas: <><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M9 17h6l-2-7h4l2 4M13 10l-3-4H7" /></>,
  ventas: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  corte: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /></>,
  menu: <><path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" /><path d="M9 9h6M9 13h4" /></>,
  // Plato con domo (cloche): el catálogo de platillos.
  platillos: <><path d="M4 16a8 8 0 0 1 16 0z" /><path d="M2 19h20M12 8V6M10 6h4" /></>,
  inventario: <><path d="M3 7l9-4 9 4-9 4z" /><path d="M3 7v10l9 4 9-4V7M12 11v10" /></>,
  reportes: <path d="M4 20V10M10 20V4M16 20v-7M2 20h20" />,
  opiniones: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  config: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  usuarios: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 7M22 20a7 7 0 0 0-4-6.3" /></>,
  salir: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  cambiar: <><path d="M4 7h13l-3-3M20 17H7l3 3" /></>,
  buscar: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  mas: <path d="M12 5v14M5 12h14" />,
  atras: <path d="M15 6l-6 6 6 6" />,
  adelante: <path d="M9 6l6 6-6 6" />,
  mover: <path d="M8 7h11l-3-3M16 17H5l3 3" />,
  unir: <><rect x="2" y="9" width="8" height="6" rx="1.5" /><rect x="14" y="9" width="8" height="6" rx="1.5" /><path d="M10 12h4" /></>,
  editar: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" /></>,
  borrar: <><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></>,
  // ── Acciones de fila (IconButton), mismo set que DemoPV ──
  lapiz: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  ajustar: <><path d="M4 21V14M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><circle cx="4" cy="12" r="2" /><circle cx="12" cy="10" r="2" /><circle cx="20" cy="14" r="2" /></>,
  archivar: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>,
  basura: <><path d="M4 7h16" /><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M10 11v6M14 11v6" /></>,
  ver: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
  // Modificadores de un platillo: lista con opciones marcadas.
  opciones: <><path d="M10 6h10M10 12h10M10 18h10" /><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11" /><circle cx="5" cy="18" r="1.5" /></>,
  xCirculo: <><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></>,
  checkCirculo: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 5-5" /></>,
  deshacer: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  recibo: <><path d="M4 3h16v18l-3-2-2 2-2-2-2 2-2-2-2 2-3-2Z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  copiar: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  documento: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
  reloj: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  menuHamb: <path d="M4 6h16M4 12h16M4 18h16" />,
  campana: <><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 21h4" /></>,
  alerta: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
  sonido: <><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></>,
  sol: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  luna: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
}

export default function Icon({ name, className = 'w-5 h-5', strokeWidth = 1.8 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
      strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name] ?? null}
    </svg>
  )
}

/** Figura de persona: rellena = comensal sentado; contorno = lugar libre. */
export function Persona({ llena = true, className = 'w-5 h-5', color }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" style={color ? { color } : undefined}>
      <circle cx="12" cy="7.5" r="4" fill={llena ? 'currentColor' : 'none'} stroke={llena ? 'none' : 'currentColor'} strokeWidth="1.6" />
      <path d="M4 21a8 8 0 0 1 16 0z" fill={llena ? 'currentColor' : 'none'} stroke={llena ? 'none' : 'currentColor'} strokeWidth="1.6" />
    </svg>
  )
}
