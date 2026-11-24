import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Wordmark } from '../components/Wordmark'

export function Login() {
  const { user, login } = useAuth()
  const [email, setEmail] = useState('admin@octavia.local')
  const [password, setPassword] = useState('admin123')
  const [showPassword, setShowPassword] = useState(false)
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
      <aside className="login-hero">
        <div className="login-hero-inner">
          <div className="login-hero-brand">
            <Wordmark size="lg" tone="light" />
            <p className="login-hero-kicker">Tanui Plastic Plant</p>
          </div>
          <h1 className="login-hero-title">See the floor in one place</h1>
          <p className="login-hero-copy">
            Shift timelines, OEE, and stop reasons. Built for operators and supervisors.
          </p>
          <ul className="login-hero-points">
            <li>
              <i className="fa-solid fa-clock" aria-hidden />
              Live hourly timelines
            </li>
            <li>
              <i className="fa-solid fa-gauge-high" aria-hidden />
              OEE from recorded data
            </li>
            <li>
              <i className="fa-solid fa-triangle-exclamation" aria-hidden />
              Coded stop reasons
            </li>
          </ul>
        </div>
      </aside>

      <main className="login-panel">
        <Link to="/home" className="login-back">
          ← Back to home
        </Link>
        <form className="login-form" onSubmit={onSubmit} noValidate>
          <div className="login-form-head">
            <h2>Log in</h2>
            <p>Access Octavia production monitoring for Tanui.</p>
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
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
            <div className="login-password-wrap">
              <input
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPassword ? 'text' : 'password'}
                required
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {error ? (
            <div className="login-error" role="alert" aria-live="polite">
              {error}
            </div>
          ) : null}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Log in'}
          </button>

          <p className="login-demo">
            <span className="login-demo-label">Demo</span>
            <code>admin@octavia.local</code>
            <span className="login-demo-sep">/</span>
            <code>admin123</code>
          </p>
        </form>

        <footer className="login-foot">
          <span>© {new Date().getFullYear()} Octavia</span>
          <span>Built for Tanui operations</span>
        </footer>
      </main>
    </div>
  )
}
