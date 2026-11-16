import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Wordmark } from '../components/Wordmark'

export function Login() {
  const { user, login } = useAuth()
  const [email, setEmail] = useState('admin@octavia.local')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-shell">
        <header className="login-brand">
          <Wordmark size="lg" tone="dark" />
          <p className="login-company">Tanui Plastic Plant</p>
        </header>

        <form className="login-card" onSubmit={onSubmit} noValidate>
          <div className="login-card-head">
            <h1>Log in</h1>
            <p>Access Octavia production monitoring for Tanui.</p>
          </div>

          <div className="field">
            <label htmlFor="email">Username</label>
            <input
              id="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </div>

          {error ? <div className="login-error">{error}</div> : null}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Log In'}
          </button>

          <p className="login-demo">Demo · admin@octavia.local / admin123</p>
        </form>

        <footer className="login-foot">
          <span>© {new Date().getFullYear()} Octavia</span>
          <span>Built for Tanui operations</span>
        </footer>
      </div>
    </div>
  )
}
