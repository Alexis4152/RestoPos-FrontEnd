/** Pitido corto (dos tonos) con Web Audio — sin archivo de audio que cargar. */
export function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.connect(gain)
      gain.connect(ctx.destination)
      const t = ctx.currentTime + i * 0.18
      gain.gain.setValueAtTime(0.25, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
      osc.start(t)
      osc.stop(t + 0.17)
    })
    setTimeout(() => ctx.close(), 600)
  } catch { /* navegador sin audio o sin interacción previa: queda solo el aviso visual */ }
}
