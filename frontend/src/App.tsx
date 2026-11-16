import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { Layout } from './components/Layout'
import { Admin } from './pages/Admin'
import { Analysis } from './pages/Analysis'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { Machines } from './pages/Machines'
import { MachineStation } from './pages/MachineStation'
import { Quality } from './pages/Quality'
import { Reports } from './pages/Reports'

function Protected({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
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
