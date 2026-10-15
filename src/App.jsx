import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { NotifyProvider } from './context/NotifyContext'
import PrivateRoute from './components/PrivateRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import ChangePasswordRequired from './pages/ChangePasswordRequired'
import Dashboard from './pages/Dashboard'
import Tables from './pages/Tables'
import Takeaway from './pages/Takeaway'
import OrderDetail from './pages/OrderDetail'
import Orders from './pages/Orders'
import Kitchen from './pages/Kitchen'
import Menu from './pages/Menu'
import Inventory from './pages/Inventory'
import Reports from './pages/Reports'
import CashCuts from './pages/CashCuts'
import Sales from './pages/Sales'
import Users from './pages/Users'
import Roles from './pages/Roles'
import Categories from './pages/Categories'
import Appearance from './pages/Appearance'
import StoreInfo from './pages/StoreInfo'
import CashCutSchedule from './pages/CashCutSchedule'
import SelectTienda from './pages/SelectTienda'
import PublicSite from './pages/PublicSite'
import OpinionPage from './pages/publicSite/OpinionPage'
import Opiniones from './pages/Opiniones'
import Reservaciones from './pages/Reservaciones'
import WebConfig from './pages/WebConfig'

/**
 * Árbol de rutas de la aplicación.
 *
 * `/login` es pública. Todo lo demás vive bajo un `PrivateRoute` genérico (solo
 * exige sesión iniciada) que envuelve el `Layout` (sidebar + contenido), y dentro
 * de este cada ruta hija está envuelta en su propio `PrivateRoute` con `section`
 * (código de `AppSection` para el chequeo fino de permisos RBAC) o `adminOnly`
 * (para las pantallas de configuración de tienda: Apariencia y Datos de la tienda).
 * Cualquier ruta no reconocida redirige a `/`.
 */
function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Página web pública de cada tienda (menú, mesas, pedidos): sin sesión ni Layout. */}
      <Route path="/sitio/:slug" element={<PublicSite />} />
      {/* QR "califica tu visita" del ticket: sin sesión, el código identifica la cuenta. */}
      <Route path="/sitio/:slug/opinion/:token" element={<OpinionPage />} />
      {/* Sesión requerida pero sin Layout (sidebar): un usuario con mustChangePassword cae
          forzosamente aquí (ver PrivateRoute) hasta que elige una contraseña propia. */}
      <Route path="/change-password" element={<PrivateRoute><ChangePasswordRequired /></PrivateRoute>} />
      {/* Sesión requerida pero sin Layout (sidebar): un actor de plataforma sin tienda
          elegida cae forzosamente aquí (ver PrivateRoute), y también sirve como pantalla
          de "Cambiar tienda" en cualquier momento. */}
      <Route path="/select-tienda" element={<PrivateRoute platformOnly><SelectTienda /></PrivateRoute>} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<PrivateRoute section="DASHBOARD"><Dashboard /></PrivateRoute>} />
                <Route path="/tables" element={<PrivateRoute section="TABLES"><Tables /></PrivateRoute>} />
                <Route path="/reservaciones" element={<PrivateRoute section="TABLES"><Reservaciones /></PrivateRoute>} />
                <Route path="/takeaway" element={<PrivateRoute section="TAKEAWAY"><Takeaway /></PrivateRoute>} />
                <Route path="/orders" element={<PrivateRoute section="ORDERS"><Orders /></PrivateRoute>} />
                <Route path="/orders/:id" element={<PrivateRoute section={['ORDERS', 'TAKEAWAY']}><OrderDetail /></PrivateRoute>} />
                <Route path="/kitchen" element={<PrivateRoute section="KITCHEN"><Kitchen /></PrivateRoute>} />
                <Route path="/menu" element={<PrivateRoute section="MENU"><Menu /></PrivateRoute>} />
                <Route path="/inventory" element={<PrivateRoute section="INVENTORY"><Inventory /></PrivateRoute>} />
                <Route path="/cash-cuts" element={<PrivateRoute section="CASH_CUTS"><CashCuts /></PrivateRoute>} />
                <Route path="/sales" element={<PrivateRoute section="SALES"><Sales /></PrivateRoute>} />
                <Route path="/reports" element={<PrivateRoute section="REPORTS"><Reports /></PrivateRoute>} />
                <Route path="/opiniones" element={<PrivateRoute section="REPORTS"><Opiniones /></PrivateRoute>} />
                <Route path="/users" element={<PrivateRoute section="USERS"><Users /></PrivateRoute>} />
                <Route path="/roles" element={<PrivateRoute section="ROLES"><Roles /></PrivateRoute>} />
                <Route path="/categories" element={<PrivateRoute adminOnly><Categories /></PrivateRoute>} />
                <Route path="/appearance" element={<PrivateRoute adminOnly><Appearance /></PrivateRoute>} />
                <Route path="/store-info" element={<PrivateRoute adminOnly><StoreInfo /></PrivateRoute>} />
                <Route path="/web-config" element={<PrivateRoute adminOnly><WebConfig /></PrivateRoute>} />
                <Route path="/cash-cut-schedule" element={<PrivateRoute superAdminOnly><CashCutSchedule /></PrivateRoute>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </PrivateRoute>
        }
      />
    </Routes>
  )
}

/**
 * Componente raíz de la aplicación.
 *
 * Envuelve todo el árbol en `BrowserRouter` → `AuthProvider` (sesión/RBAC/tienda)
 * → `NotifyProvider` (toasts y confirmaciones) → {@link AppRoutes}, de forma que
 * cualquier componente descendiente tiene acceso a `useAuth()` y `useNotify()`.
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotifyProvider>
          <AppRoutes />
        </NotifyProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
