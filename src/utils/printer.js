import qz from 'qz-tray'
import { getAccountTicketEscPos } from '../api/cuentas'
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
export async function printAccountTicket(accountId) {
  const res = await getAccountTicketEscPos(accountId)
  const hex = res.data?.data
  if (!hex) throw new Error('El servidor no devolvió el contenido del ticket.')

  await ensureConnected()

  const configuredName = getConfiguredPrinterName()
  const printer = configuredName || (await qz.printers.getDefault())
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
