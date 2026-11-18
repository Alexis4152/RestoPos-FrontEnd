import qz from 'qz-tray'
import { getAccountTicketEscPos, getTicketPdf } from '../api/cuentas'
import { getQzCertificate, signQzData } from '../api/qz'

/**
 * Puente con la impresora térmica de tickets (USB) y el cajón de dinero (conectado por RJ11
 * a la propia impresora), usando QZ Tray como agente local. Puerto directo del mismo utilitario
 * de DemoPV, adaptado a que aquí se imprime una {@code Cuenta} (no una venta de pago único).
 *
 * Por qué existe esto: el backend corre en un servidor en la nube y no tiene forma de hablarle
 * a un puerto USB de la computadora de la caja — ningún navegador puede hacerlo tampoco, por
 * seguridad. QZ Tray es una aplicación pequeña que el cajero instala UNA VEZ en su propia
 * computadora; corre en segundo plano y expone un WebSocket en localhost que esta página sí
 * puede usar para mandarle bytes crudos a la impresora.
 *
 * Requisito en la máquina de la caja: tener QZ Tray instalado y corriendo
 * (https://qz.io/download/). Sin eso, imprimir/abrir el cajón desde aquí no es posible —
 * fallará con un error claro, no en silencio.
 *
 * Firma digital de la conexión: cada conexión se firma con el certificado/llave que expone el
 * backend (`/api/qz/certificate`, `/api/qz/sign` — ver `QzSigningService` del backend). Sin
 * esto, QZ Tray trata la conexión como "anónima" y el checkbox "recordar esta decisión" queda
 * deshabilitado — le pide permiso al cajero en CADA impresión, sin poder recordarlo. Con firma
 * (aunque el certificado sea autofirmado, no hace falta comprarlo a QZ), QZ Tray sigue
 * mostrando "sitio no confiable" la primera vez, pero el cajero SÍ puede marcar "recordar esta
 * decisión" de forma permanente.
 */

let securityConfigured = false

function ensureSecurityConfigured() {
  if (securityConfigured) return
  // { rejectOnFailure: true }: por default, si esta promesa falla, QZ Tray NO avisa — cae en
  // silencio a una conexión anónima (mismo síntoma que sin firmar en absoluto). Con
  // rejectOnFailure el error se propaga de verdad, para poder ver qué está fallando en vez de
  // adivinar por qué "no queda memorizada la autorización".
  qz.security.setCertificatePromise((resolve, reject) => {
    getQzCertificate()
      .then((r) => resolve(r.data.data))
      .catch((err) => {
        console.error('[QZ] No se pudo obtener el certificado de firma', err)
        reject(err)
      })
  }, { rejectOnFailure: true })
  qz.security.setSignatureAlgorithm('SHA512')
  qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
    signQzData(toSign)
      .then((r) => resolve(r.data.data))
      .catch((err) => {
        console.error('[QZ] No se pudo firmar la conexión', err)
        reject(err)
      })
  })
  securityConfigured = true
}

async function ensureConnected() {
  ensureSecurityConfigured()
  if (qz.websocket.isActive()) return
  try {
    await qz.websocket.connect({ retries: 2, delay: 1 })
  } catch (err) {
    throw new Error(
      'No se pudo conectar con QZ Tray. Verifica que esté instalado y corriendo en esta computadora (https://qz.io/download/).'
    )
  }
}

/**
 * Nombre de impresora a usar, si el usuario configuró una específica en esta máquina (útil
 * cuando la computadora tiene más de una impresora instalada y la térmica no es la que el
 * sistema marca como predeterminada).
 */
const PRINTER_NAME_KEY = 'pos_escpos_printer_name'

export function getConfiguredPrinterName() {
  try {
    return localStorage.getItem(PRINTER_NAME_KEY) || ''
  } catch {
    return ''
  }
}

export function setConfiguredPrinterName(name) {
  try {
    if (name) localStorage.setItem(PRINTER_NAME_KEY, name)
    else localStorage.removeItem(PRINTER_NAME_KEY)
  } catch {
    // localStorage no disponible; simplemente no se recuerda la preferencia
  }
}

// ── Impresora de cocina y estación de impresión (por computadora) ─────────────────────
// La comanda que mandan los meseros (desde cualquier dispositivo) la imprime una "estación de
// impresión": una computadora fija con QZ Tray que deja RestoPOS abierto (ver PrintStation).
// Si la tienda tiene "Enviar a cocina", sale en la impresora de cocina; si no, en la de tickets.
const KITCHEN_PRINTER_KEY = 'pos_escpos_kitchen_printer_name'
const STATION_KEY = 'pos_print_station'

export function getKitchenPrinterName() {
  try { return localStorage.getItem(KITCHEN_PRINTER_KEY) || '' } catch { return '' }
}

export function setKitchenPrinterName(name) {
  try {
    if (name) localStorage.setItem(KITCHEN_PRINTER_KEY, name)
    else localStorage.removeItem(KITCHEN_PRINTER_KEY)
  } catch { /* sin localStorage: no se recuerda */ }
}

/** ¿Esta computadora es la estación de impresión de comandas? */
export function isPrintStation() {
  try { return localStorage.getItem(STATION_KEY) === '1' } catch { return false }
}

export function setPrintStation(on) {
  try {
    if (on) localStorage.setItem(STATION_KEY, '1')
    else localStorage.removeItem(STATION_KEY)
  } catch { /* sin localStorage: no se recuerda */ }
  window.dispatchEvent(new Event('pos-print-station'))
}

/** Hoja de prueba (para verificar que una impresora responde). */
export async function printTest(printerName, titulo) {
  const enc = (s) => Array.from(s).map((ch) => {
    const c = ch.charCodeAt(0)
    return (c <= 0xff ? c : 0x3f).toString(16).padStart(2, '0')
  }).join('')
  const NL = String.fromCharCode(10)
  const hex = '1b40' + '1b6101' + '1d2111' + enc('PRUEBA' + NL) + '1d2100'
    + enc(titulo + NL + new Date().toLocaleString('es-MX') + NL.repeat(4)) + '1d5601'
  await sendRaw(hex, printerName)
}

/** Lista los nombres de impresoras que QZ Tray ve instaladas en esta computadora. */
export async function listPrinters() {
  await ensureConnected()
  return qz.printers.find()
}

/**
 * Imprime el ticket de una cuenta ya cobrada en la impresora térmica configurada, y abre el
 * cajón de dinero si la cuenta tuvo al menos un pago en efectivo no cancelado (eso lo decide
 * el backend, no esta función — ver `EscPosTicketService`).
 *
 * @param {number|string} accountId Id de la cuenta a imprimir.
 * @throws {Error} con un mensaje en español listo para mostrarle al cajero, si QZ Tray no
 *   está disponible o la impresión falla.
 */
export async function printAccountTicket(accountId, copias = 1, { abrirCajon = true } = {}) {
  const res = await getAccountTicketEscPos(accountId, copias, { abrirCajon })
  const hex = res.data?.data
  if (!hex) throw new Error('El servidor no devolvió el contenido del ticket.')
  await sendRaw(hex)
}

/**
 * Manda comandos ESC/POS (hex) vía QZ Tray a `printerName`, o a la impresora de tickets
 * configurada en esta computadora (o la predeterminada del sistema) si no se indica.
 */
export async function sendRaw(hex, printerName) {
  await ensureConnected()

  const printer = printerName || getConfiguredPrinterName() || (await qz.printers.getDefault())
  const config = qz.configs.create(printer)

  const data = [
    {
      type: 'raw',
      format: 'command',
      flavor: 'hex',
      data: hex,
    },
  ]

  try {
    await qz.print(config, data)
  } catch (err) {
    throw new Error(
      `No se pudo imprimir el ticket (¿está encendida y conectada la impresora "${printer}"?): ${err?.message || err}`
    )
  }
}

/**
 * Cuenta por pagar que genera el mesero: 2 copias en la térmica ("COPIA CLIENTE", que el cliente
 * lleva a la caja para pagar, y "COPIA COMERCIO"), ambas marcadas "CUENTA POR PAGAR". Sin
 * impresora térmica (QZ Tray), abre el PDF para imprimirlo desde el navegador.
 */
/**
 * Al cobrar ya NO se imprime ticket (el mesero imprimió la cuenta en 2 copias): solo se abre el
 * cajón de dinero, y solo si el pago fue en efectivo (eso lo decide el backend). Sin impresora
 * térmica configurada (QZ Tray) no hay cajón conectado: no hace nada ni avisa.
 *
 * @throws {Error} si hay QZ Tray pero el cajón/impresora no respondió (para avisarle al cajero)
 */
export async function abrirCajon(accountId) {
  const res = await getAccountTicketEscPos(accountId, 1, { soloCajon: true })
  const hex = res.data?.data
  if (!hex) return // sin efectivo: nada que abrir
  try {
    await ensureConnected()
  } catch {
    return // sin QZ Tray en esta computadora: no hay cajón conectado
  }
  await sendRaw(hex)
}

/**
 * Reimpresión después de cobrar: las mismas 2 copias (cliente / comercio), ya como ticket
 * pagado, SIN volver a abrir el cajón. Sin impresora térmica, abre el PDF.
 */
export async function reimprimirCuenta(accountId) {
  try {
    await printAccountTicket(accountId, 2, { abrirCajon: false })
  } catch {
    const r = await getTicketPdf(accountId)
    window.open(URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' })), '_blank', 'noopener')
  }
}

export async function printCuentaPorPagar(accountId, copias = 2) {
  try {
    await printAccountTicket(accountId, copias)
  } catch {
    const r = await getTicketPdf(accountId)
    window.open(URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' })), '_blank', 'noopener')
  }
}
