import logo from '../assets/logo.png'
import { Persona } from './Icon'

/**
 * Marco de las pantallas sin sesión del punto de venta (iniciar sesión, olvidé mi contraseña,
 * restablecer y cambio obligatorio de contraseña): a la izquierda el área de marca con el
 * plano de mesas (el mismo lenguaje visual del sistema) y a la derecha el formulario. En
 * celular se apilan. `titulo` y `subtitulo` encabezan el formulario.
 */
export default function AuthLayout({ titulo, subtitulo, children }) {
  return (
    <div className="min-h-screen flex flex-wrap bg-[#F4F3EF]">
      <section aria-label="RestoPOS" className="flex-[1_1_520px] bg-purple-50 px-6 py-8 sm:px-14 sm:py-14 flex flex-col gap-8 lg:gap-10 justify-between">
        <div className="flex items-center gap-3">
          <img src={logo} alt="" className="w-11 h-11 rounded-xl object-cover bg-white" />
          <div className="leading-tight">
            <p className="font-extrabold text-lg text-gray-900">RestoPOS</p>
            <p className="text-[13px] text-gray-700">por Nexora Systems</p>
          </div>
        </div>
        <div className="max-w-[480px] space-y-4">
          <p className="text-3xl sm:text-[40px] leading-tight font-extrabold tracking-tight text-gray-900">Todo tu restaurante, mesa por mesa.</p>
          <p className="text-base text-gray-700 leading-relaxed">
            Mesas y comensales en tiempo real, cocina, pedidos de tu página web y a domicilio, reservaciones y cortes de caja de cada tienda.
          </p>
        </div>
        <PlanoIlustrativo />
        <p className="text-[13px] text-gray-700">© {new Date().getFullYear()} Nexora Systems</p>
      </section>

      <section className="flex-[1_1_440px] flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px] space-y-5">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight">{titulo}</h1>
            {subtitulo && <p className="text-[15px] text-gray-600 mt-1">{subtitulo}</p>}
          </div>
          {children}
        </div>
      </section>
    </div>
  )
}

/** Mensaje de error o de éxito de las pantallas de acceso. */
export function AuthAviso({ tipo = 'error', children }) {
  return (
    <div role={tipo === 'error' ? 'alert' : 'status'}
      className={`rounded-xl text-sm px-3.5 py-3 ${tipo === 'error' ? 'bg-red-50 text-red-800' : 'bg-[#E7F3EC] text-[#22603C]'}`}>
      {children}
    </div>
  )
}

/** Clases de los campos y del botón principal, iguales en todas las pantallas de acceso. */
export const authInput = 'input !min-h-[48px] !text-[15px]'
export const authBoton = 'btn-primary w-full min-h-[50px] text-[15px] !font-extrabold'
export const authLink = 'block w-full text-center text-sm font-bold text-purple-700 hover:underline py-2'

/** Plano decorativo de la portada: mesas con sus lugares (rellenas = comensales). */
function PlanoIlustrativo() {
  const mesas = [
    { n: 1, cap: 4, sentados: 3, color: '#24519E', mesa: 'bg-[#E6EDF8] border-[#A9BEE3]' },
    { n: 2, cap: 2, sentados: 0, color: '#2E7D4F', mesa: 'bg-[#F1F8F4] border-[#9CCBB0]' },
    { n: 3, cap: 4, sentados: 4, color: '#B86E00', mesa: 'bg-[#FBF0DC] border-[#E2B76B]' },
    { n: 4, cap: 2, sentados: 2, color: '#24519E', mesa: 'bg-[#E6EDF8] border-[#A9BEE3]' },
    { n: 5, cap: 6, sentados: 0, color: '#2E7D4F', mesa: 'bg-[#F1F8F4] border-[#9CCBB0]' },
    { n: 6, cap: 4, sentados: 2, color: '#24519E', mesa: 'bg-[#E6EDF8] border-[#A9BEE3]' },
  ]
  return (
    <div aria-hidden="true" className="max-w-[480px] bg-white/70 border border-purple-100 rounded-[20px] p-6 sm:p-7 grid grid-cols-3 gap-x-4 gap-y-6">
      {mesas.map((m) => {
        const arriba = Math.ceil(m.cap / 2)
        const lugares = Array.from({ length: m.cap }, (_, i) => i < m.sentados)
        const redonda = m.cap <= 2
        const fila = (lista) => (
          <div className="flex gap-[3px]">
            {lista.map((lleno, i) => <Persona key={i} llena={lleno} className="w-[18px] h-[18px]" color={lleno ? m.color : '#9AA7A3'} />)}
          </div>
        )
        return (
          <div key={m.n} className="flex flex-col items-center gap-1">
            {fila(lugares.slice(0, arriba))}
            <div className={`border-[1.5px] flex items-center justify-center font-extrabold text-sm ${m.mesa}`}
              style={{ width: redonda ? 40 : arriba * 21 + 10, height: redonda ? 40 : 32, borderRadius: redonda ? 20 : 9 }}>{m.n}</div>
            {fila(lugares.slice(arriba))}
          </div>
        )
      })}
    </div>
  )
}
