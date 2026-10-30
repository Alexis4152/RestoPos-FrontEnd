// Escapa lo mínimo indispensable para meter texto (nombre de archivo) dentro de HTML
// armado a mano — nunca es texto de un desconocido (siempre lo arma el propio código,
// ej. `qr-${slug}.png`), pero cuesta poco cerrar la puerta de todas formas.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/**
 * Descarga directa de un blob ya obtenido (CSV, Excel, ZIP...) con el patrón clásico de
 * `<a download>` + clic sintético. A diferencia de {@link openOrDownloadBlob}, no hace
 * falta el rodeo de la pestaña emergente: ese truco es solo para que un PDF o una imagen
 * se vean bien en Safari de iOS; un archivo que el navegador no sabe mostrar (como un
 * .xlsx o un .csv) ya dispara la descarga directa en cualquier navegador.
 *
 * @param {Blob} blob Contenido del archivo (ej. `res.data` de una petición con `responseType: 'blob'`).
 * @param {string} filename Nombre con el que se guarda.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Abre en una pestaña nueva (o, si el navegador de plano bloquea el popup, cae a una
 * descarga directa tipo `<a download>`) el archivo binario que regresa una petición al
 * backend — un PDF o una imagen generada al vuelo, nunca un archivo ya existente en disco.
 *
 * Hace falta este rodeo porque el patrón típico de "pedir el blob y disparar un
 * `<a download>` con clic sintético" no funciona en Safari de iOS: ese navegador bloquea
 * la descarga programática de una URL `blob:`, pero SÍ la muestra si se navega a ella —
 * desde ahí el usuario usa el botón nativo de Compartir/Guardar. En computadora (donde sí
 * funcionaba `<a download>`) este mismo camino también funciona, así que no hace falta
 * detectar el navegador ni tener dos rutas de código distintas.
 *
 * Un PDF, el propio navegador ya lo muestra con su visor nativo (Chrome/Edge/Safari traen
 * uno con botones de descargar/imprimir bien visibles) — ahí basta con navegar a la URL.
 * Una imagen suelta, en cambio, muchos navegadores la muestran "pelona" (sin ningún botón,
 * solo la imagen), sin ninguna pista de cómo guardarla en computadora — para ese caso se
 * arma una paginita mínima con un botón explícito de "Descargar imagen" (un `<a download>`
 * real, que el propio usuario hace clic — el disparador más confiable de todos, en
 * cualquier navegador) junto con la imagen, sobre la que en celular también se puede
 * mantener presionada para "Guardar imagen" de forma nativa.
 *
 * La pestaña se abre ANTES de esperar la respuesta, a propósito: si se abriera después del
 * `await`, varios navegadores ya no lo cuentan como "un `window.open` disparado
 * directamente por un clic del usuario" y lo bloquean como si fuera un pop-up no
 * solicitado — de ahí que esta función reciba `fetchBlob` como una función a invocar
 * (nunca una promesa ya en curso), para poder abrir la pestaña primero.
 *
 * @param {() => Promise<import('axios').AxiosResponse>} fetchBlob Dispara la petición (ej.
 *        `() => getApartadosPromoPdf(id, url)`), con `responseType: 'blob'` en el cliente axios.
 * @param {string} filename Nombre sugerido para el archivo — se usa como nombre del botón
 *        de descarga de la paginita (para imágenes) o si el navegador cae al modo de
 *        descarga directa; el visor nativo del PDF pone su propio nombre al guardar.
 * @param {string} mimeType Tipo MIME del archivo (ej. `'application/pdf'`, `'image/png'`).
 * @returns {Promise<void>}
 * @throws Relanza cualquier error de `fetchBlob()` tal cual, tras cerrar la pestaña que
 *         había quedado en blanco tratando de fallar de la manera menos confusa posible.
 */
export async function openOrDownloadBlob(fetchBlob, filename, mimeType) {
  const popup = window.open('', '_blank')
  try {
    const res = await fetchBlob()
    const url = URL.createObjectURL(new Blob([res.data], { type: mimeType }))
    if (popup && !popup.closed) {
      if (mimeType.startsWith('image/')) {
        const safeName = escapeHtml(filename)
        popup.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeName}</title>
<style>
  body { margin:0; min-height:100vh; display:flex; flex-direction:column; align-items:center;
         justify-content:center; gap:18px; background:#18181b; font-family:system-ui,sans-serif; padding:24px; box-sizing:border-box; }
  img { max-width:90vw; max-height:65vh; background:#fff; border-radius:12px; padding:12px; }
  p { color:#a1a1aa; font-size:13px; margin:0; text-align:center; }
  a.btn { background:#7c3aed; color:#fff; text-decoration:none; padding:12px 24px;
          border-radius:10px; font-weight:600; font-size:15px; }
</style></head>
<body>
  <img src="${url}" alt="${safeName}">
  <a class="btn" href="${url}" download="${safeName}">⬇ Descargar imagen</a>
  <p>En celular: también puedes mantener presionada la imagen para guardarla.</p>
</body></html>`)
        popup.document.close()
      } else {
        popup.location.href = url
      }
    } else {
      // Pop-up bloqueado de todas formas (poco común, pero pasa) — se intenta la descarga
      // directa como respaldo; en computadora normalmente sí funciona.
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
    }
    // A propósito NO se revoca la URL aquí: la pestaña nueva (o la descarga recién
    // disparada) todavía la está usando — el navegador la libera solo cuando descarta ese
    // documento, no hay un momento seguro antes de eso para hacerlo a mano.
  } catch (err) {
    popup?.close()
    throw err
  }
}
