import api from './axios'

/**
 * Certificado público que QZ Tray usa para identificar esta app (ver `qz.security.setCertificatePromise`
 * en `utils/printer.js`). Sin él, QZ Tray trata la conexión como "anónima" y no puede recordar
 * la autorización del cajero.
 * @returns {Promise} Respuesta de axios con el certificado en PEM (`data.data`).
 */
export const getQzCertificate = () => api.get('/qz/certificate')

/**
 * Firma un texto que QZ Tray generó para autenticar una llamada (ver `qz.security.setSignaturePromise`).
 * @param {string} data Texto a firmar, tal cual lo entrega QZ Tray.
 * @returns {Promise} Respuesta de axios con la firma en base64 (`data.data`).
 */
export const signQzData = (data) => api.post('/qz/sign', { data })
