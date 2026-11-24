import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import { Layout } from './components/Layout'
import { Admin } from './pages/Admin'
import { Analysis } from './pages/Analysis'
import { Dashboard } from './pages/Dashboard'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { Machines } from './pages/Machines'
import { MachineStation } from './pages/MachineStation'
import { Quality } from './pages/Quality'
import { Reports } from './pages/Reports'

/** Logged in: app shell. Logged out: public homepage at "/", login redirect elsewhere. */
function RootGate() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  if (user) return <Layout />
  if (pathname === '/') return <Landing />
  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/home" element={<Landing />} />
      <Route path="/" element={<RootGate />}>
        <Route index element={<Dashboard />} />
        <Route path="machines" element={<Machines />} />
        <Route path="machines/:id" element={<MachineStation />} />
        <Route path="quality" element={<Quality />} />
        <Route path="analysis" element={<Analysis />} />
        <Route path="reports" element={<Reports />} />
        <Route path="admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
