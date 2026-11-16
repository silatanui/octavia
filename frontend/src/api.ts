const API_BASE = import.meta.env.VITE_API_BASE || '/api'

export type User = {
  id: number
  name: string
  email: string
  status: string
  role_id: number
  role_name?: string | null
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('octavia_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...authHeaders(),
        ...(options.headers || {}),
      },
    })
  } catch {
    throw new Error('Cannot reach API. Is the backend running on port 8000?')
  }
  if (res.status === 401) {
    localStorage.removeItem('octavia_token')
    localStorage.removeItem('octavia_user')
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login'
    }
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({} as { detail?: unknown }))
    const msg =
      typeof detail.detail === 'string'
        ? detail.detail
        : Array.isArray(detail.detail)
          ? detail.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join('; ')
          : res.statusText || 'Request failed'
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json()
  return res.text() as T
}

export async function login(email: string, password: string) {
  const body = new URLSearchParams()
  body.set('username', email)
  body.set('password', password)
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error('Invalid email or password')
  return res.json() as Promise<{ access_token: string; user: User }>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  exportCsvUrl: (qs: string) => `${API_BASE}/dashboard/export.csv?${qs}`,
}

export function formatPct(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  return `${v.toFixed(1)}%`
}

export function formatNum(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString()
}
