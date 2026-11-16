import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { login as apiLogin, type User } from './api'

type AuthState = {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('octavia_token'))
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('octavia_user')
    return raw ? JSON.parse(raw) : null
  })

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      async login(email, password) {
        const res = await apiLogin(email, password)
        localStorage.setItem('octavia_token', res.access_token)
        localStorage.setItem('octavia_user', JSON.stringify(res.user))
        setToken(res.access_token)
        setUser(res.user)
      },
      logout() {
        localStorage.removeItem('octavia_token')
        localStorage.removeItem('octavia_user')
        setToken(null)
        setUser(null)
      },
    }),
    [user, token],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth requires AuthProvider')
  return ctx
}
