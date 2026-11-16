import { useEffect, useState, type FormEvent } from 'react'
import { api, formatNum } from '../api'

export function Downtime() {
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([])
  const [categories, setCategories] = useState<Array<Record<string, unknown>>>([])
  const [machines, setMachines] = useState<Array<Record<string, unknown>>>([])
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    machine_id: '',
    category_id: '',
    reason: '',
    started_at: new Date().toISOString().slice(0, 16),
    ended_at: '',
    notes: '',
  })

  async function load() {
    const [e, c, m] = await Promise.all([
      api.get<Array<Record<string, unknown>>>('/downtime'),
      api.get<Array<Record<string, unknown>>>('/downtime/categories'),
      api.get<Array<Record<string, unknown>>>('/machines'),
    ])
    setEvents(e)
    setCategories(c)
    setMachines(m)
  }

  useEffect(() => {
    load().catch((err) => setError(err.message))
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      await api.post('/downtime', {
        machine_id: Number(form.machine_id),
        category_id: form.category_id ? Number(form.category_id) : null,
        reason: form.reason,
        started_at: new Date(form.started_at).toISOString(),
        ended_at: form.ended_at ? new Date(form.ended_at).toISOString() : null,
        notes: form.notes || null,
      })
      setForm({ ...form, reason: '', notes: '', ended_at: '' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
  }

  return (
    <>
      <div className="topbar">
        <strong>Downtime</strong>
        <span className="topbar-sub">Manual events · also code stops from station timeline</span>
      </div>
      <div className="page">
        <p className="page-lead">
          Log machine stops with category, reason, and window. Coded events appear in Reports Pareto and can
          replace Uncommented segments on the station board.
        </p>
        {error ? <div className="error">{error}</div> : null}
        <form className="panel form-grid" onSubmit={onSubmit}>
          <h2 className="full" style={{ margin: 0 }}>
            Record downtime
          </h2>
          <div className="field">
            <label>Machine</label>
            <select required value={form.machine_id} onChange={(e) => setForm({ ...form, machine_id: e.target.value })}>
              <option value="">Select…</option>
              {machines.map((m) => (
                <option key={String(m.id)} value={String(m.id)}>
                  {String(m.machine_code)} — {String(m.machine_name)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Category</label>
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">Unclassified</option>
              {categories.map((c) => (
                <option key={String(c.id)} value={String(c.id)}>
                  {String(c.category_name)} ({String(c.planned_or_unplanned)})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Started</label>
            <input
              type="datetime-local"
              required
              value={form.started_at}
              onChange={(e) => setForm({ ...form, started_at: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Ended</label>
            <input
              type="datetime-local"
              value={form.ended_at}
              onChange={(e) => setForm({ ...form, ended_at: e.target.value })}
            />
          </div>
          <div className="field full">
            <label>Reason</label>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div className="field full">
            <label>Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
          <div className="full">
            <button className="btn btn-primary" type="submit">
              Save downtime
            </button>
          </div>
        </form>

        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Category</th>
                <th>Reason</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Minutes</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={String(ev.id)}>
                  <td>{String(ev.machine_name || ev.machine_id)}</td>
                  <td>{String(ev.category_name || 'Unclassified')}</td>
                  <td>{String(ev.reason || '—')}</td>
                  <td>{ev.started_at ? new Date(String(ev.started_at)).toLocaleString() : '—'}</td>
                  <td>{ev.ended_at ? new Date(String(ev.ended_at)).toLocaleString() : '—'}</td>
                  <td>{formatNum(ev.duration_minutes as number)}</td>
                  <td>{String(ev.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
