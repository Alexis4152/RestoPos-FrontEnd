import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

/**
 * Entry point de la aplicación (Vite + React). Monta el componente raíz `App`
 * en el nodo `#root` del `index.html`, envuelto en `React.StrictMode`.
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
