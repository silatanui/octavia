import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, formatNum, formatPct } from '../api'

type Overview = {
  generated_at: string
  filters_echo: { days: number; machine_id: number | null }
  kpis: {
    yield_pct: number | null
    scrap_units: number
    good_units: number
    total_units: number
    scrap_rate: number | null
    inspections: number
    worst_machine: {
      machine_id: number
      machine_code: string
      scrap_rate: number | null
      scrap: number
    } | null
    delta_yield_pct: number | null
    delta_scrap_units: number | null
    delta_scrap_rate: number | null
    delta_inspections: number
  }
  daily_trend: Array<{
    date: string
    label: string
    good: number
    scrap: number
    yield_pct: number | null
  }>
  defect_mix: Array<{
    category: string
    count: number
    rejected_units: number
    color: string
  }>
  by_machine: Array<{
    machine_id: number
    machine_code: string
    machine_name: string
    good: number
    scrap: number
    inspections: number
    yield_pct: number | null
    scrap_rate: number | null
    last_inspected_at: string | null
  }>
  recent: Array<{
    id: number
    inspected_at: string | null
    machine_id: number
    machine_code: string
    machine_name?: string | null
    work_order_number?: string | null
    good_units: number
    rejected_units: number
    defect_category: string | null
    notes: string | null
  }>
}

type Option = {
  id: number
  machine_code?: string
  machine_name?: string
  order_number?: string
}

const DEFECT_OPTIONS = ['Dimensional', 'Surface', 'Missing feature', 'Flash', 'Other']
const DAYS_OPTIONS = [7, 14, 30] as const
const tipStyle = { background: '#0f172a', border: '1px solid #334155', color: '#fff', fontSize: 12 }

function deltaClass(v: number | null | undefined, invert = false) {
  if (v === null || v === undefined || v === 0) return 'quality-delta neutral'
  const good = invert ? v < 0 : v > 0
  return good ? 'quality-delta up' : 'quality-delta down'
}

function formatDelta(v: number | null | undefined, suffix = 'pp') {
  if (v === null || v === undefined) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}${suffix}`
}

function timeAgo(iso: string | null) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.max(0, Math.round(ms / 60000))
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function Quality() {
  const [days, setDays] = useState(14)
  const [machineFilter, setMachineFilter] = useState('')
  const [data, setData] = useState<Overview | null>(null)
  const [machines, setMachines] = useState<Option[]>([])
  const [orders, setOrders] = useState<Option[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const [feedMachineId, setFeedMachineId] = useState<number | null>(null)
  const [form, setForm] = useState({
    machine_id: '',
    work_order_id: '',
    good_units: '24',
    rejected_units: '1',
    defect_category: 'Dimensional',
    notes: '',
  })

  const qs = useMemo(() => {
    const p = new URLSearchParams({ days: String(days) })
    if (machineFilter) p.set('machine_id', machineFilter)
    return p.toString()
  }, [days, machineFilter])

  const loadOverview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<Overview>(`/quality/overview?${qs}`)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load quality overview')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [qs])

  useEffect(() => {
    api
      .get<Option[]>('/machines')
      .then(setMachines)
      .catch(() => setMachines([]))
    api
      .get<Option[]>('/work-orders')
      .then(setOrders)
      .catch(() => setOrders([]))
  }, [])

  useEffect(() => {
    loadOverview()
  }, [loadOverview])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      await api.post('/quality', {
        machine_id: Number(form.machine_id),
        work_order_id: form.work_order_id ? Number(form.work_order_id) : null,
        good_units: Number(form.good_units),
        rejected_units: Number(form.rejected_units),
        defect_category: form.defect_category || null,
        notes: form.notes || null,
      })
      setDrawerOpen(false)
      await loadOverview()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const kpis = data?.kpis
  const maxScrap = Math.max(...(data?.by_machine.map((m) => m.scrap) || [1]), 1)
  const feed = useMemo(() => {
    const rows = data?.recent || []
    if (!feedMachineId) return rows
    return rows.filter((r) => r.machine_id === feedMachineId)
  }, [data, feedMachineId])

  return (
    <>
      <div className="topbar">
        <strong>Quality</strong>
        <span className="topbar-sub">Yield pulse · scrap · defects</span>
        <div className="field">
          <label>Window</label>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAYS_OPTIONS.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Machine</label>
          <select
            value={machineFilter}
            onChange={(e) => {
              setMachineFilter(e.target.value)
              setFeedMachineId(e.target.value ? Number(e.target.value) : null)
            }}
          >
            <option value="">All machines</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.machine_code}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setDrawerOpen(true)}>
          Log inspection
        </button>
      </div>

      <div className="page quality-page">
        <p className="page-lead">
          Shop-floor quality desk: first-pass yield, scrap trend, defect mix, and machine heat — then a live
          inspection feed. Quality % still rolls into OEE elsewhere.
        </p>
        {error ? <div className="error">{error}</div> : null}
        {loading && !data ? <div className="demo-banner">Loading quality…</div> : null}

        {kpis ? (
          <div className="quality-kpi-strip">
            <div className="quality-kpi">
              <div className="label">First-pass yield</div>
              <div className="value">{formatPct(kpis.yield_pct)}</div>
              <div className={deltaClass(kpis.delta_yield_pct)}>{formatDelta(kpis.delta_yield_pct)}</div>
            </div>
            <div className="quality-kpi">
              <div className="label">Scrap units</div>
              <div className="value">{formatNum(kpis.scrap_units)}</div>
              <div className={deltaClass(kpis.delta_scrap_units, true)}>
                {formatDelta(kpis.delta_scrap_units, '')}
              </div>
            </div>
            <div className="quality-kpi">
              <div className="label">Scrap rate</div>
              <div className="value">{formatPct(kpis.scrap_rate)}</div>
              <div className={deltaClass(kpis.delta_scrap_rate, true)}>
                {formatDelta(kpis.delta_scrap_rate)}
              </div>
            </div>
            <div className="quality-kpi">
              <div className="label">Inspections</div>
              <div className="value">{formatNum(kpis.inspections)}</div>
              <div className="quality-delta neutral">
                {kpis.delta_inspections >= 0 ? '+' : ''}
                {kpis.delta_inspections} vs prior
              </div>
            </div>
            <div className="quality-kpi">
              <div className="label">Watch machine</div>
              <div className="value quality-kpi-machine">
                {kpis.worst_machine?.machine_code || '—'}
              </div>
              <div className="quality-delta down">
                {kpis.worst_machine
                  ? `${formatPct(kpis.worst_machine.scrap_rate)} scrap`
                  : 'No scrap in window'}
              </div>
            </div>
          </div>
        ) : null}

        <div className="quality-visual-row">
          <div className="panel quality-panel">
            <div className="panel-head-row">
              <h2 style={{ margin: 0 }}>Scrap &amp; yield trend</h2>
              <span className="muted" style={{ fontSize: '0.72rem' }}>
                Good + scrap · yield %
              </span>
            </div>
            <div className="quality-chart">
              <ResponsiveContainer>
                <ComposedChart data={data?.daily_trend || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                  <YAxis yAxisId="qty" stroke="#64748b" fontSize={11} />
                  <YAxis
                    yAxisId="pct"
                    orientation="right"
                    domain={[0, 100]}
                    stroke="#64748b"
                    fontSize={11}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip contentStyle={tipStyle} />
                  <Legend />
                  <Bar yAxisId="qty" dataKey="good" name="Good" stackId="q" fill="#0f766e" />
                  <Bar yAxisId="qty" dataKey="scrap" name="Scrap" stackId="q" fill="#be123c" />
                  <Line
                    yAxisId="pct"
                    type="monotone"
                    dataKey="yield_pct"
                    name="Yield %"
                    stroke="#0369a1"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel quality-panel">
            <div className="panel-head-row">
              <h2 style={{ margin: 0 }}>Defect mix</h2>
              <span className="muted" style={{ fontSize: '0.72rem' }}>
                By rejected units
              </span>
            </div>
            <div className="quality-defect-body">
              <div className="quality-chart quality-chart-pie">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={data?.defect_mix || []}
                      dataKey="rejected_units"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      innerRadius="48%"
                      outerRadius="78%"
                      paddingAngle={2}
                    >
                      {(data?.defect_mix || []).map((s) => (
                        <Cell key={s.category} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tipStyle} formatter={(v) => formatNum(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="quality-defect-list">
                {(data?.defect_mix || []).map((d) => (
                  <li key={d.category}>
                    <i style={{ background: d.color }} />
                    <span>{d.category}</span>
                    <b>{formatNum(d.rejected_units)}</b>
                    <em>{d.count} checks</em>
                  </li>
                ))}
                {!data?.defect_mix?.length ? <li className="muted">No defects coded</li> : null}
              </ul>
            </div>
          </div>
        </div>

        <div className="panel quality-panel">
          <div className="panel-head-row">
            <h2 style={{ margin: 0 }}>Machine quality board</h2>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              Click a row to filter the feed
              {feedMachineId ? (
                <>
                  {' · '}
                  <button type="button" className="linkish" onClick={() => setFeedMachineId(null)}>
                    Clear
                  </button>
                </>
              ) : null}
            </span>
          </div>
          <div className="quality-machine-board">
            {(data?.by_machine || []).map((m) => (
              <button
                type="button"
                key={m.machine_id}
                className={`quality-machine-row${feedMachineId === m.machine_id ? ' active' : ''}`}
                onClick={() =>
                  setFeedMachineId((id) => (id === m.machine_id ? null : m.machine_id))
                }
              >
                <div className="quality-machine-meta">
                  <strong>{m.machine_code}</strong>
                  <span>{m.machine_name}</span>
                </div>
                <div className="quality-machine-bar-wrap" title={`${m.scrap} scrap`}>
                  <div
                    className="quality-machine-bar"
                    style={{ width: `${Math.max(4, (m.scrap / maxScrap) * 100)}%` }}
                  />
                </div>
                <div className="quality-machine-stats">
                  <span>{formatPct(m.yield_pct)} yield</span>
                  <span>{formatNum(m.scrap)} scrap</span>
                  <span>{timeAgo(m.last_inspected_at)}</span>
                </div>
              </button>
            ))}
            {!data?.by_machine?.length ? (
              <div className="muted" style={{ padding: '0.75rem' }}>
                No inspections in this window
              </div>
            ) : null}
          </div>
        </div>

        <div className="panel quality-panel">
          <div className="panel-head-row">
            <h2 style={{ margin: 0 }}>Inspection feed</h2>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              {feed.length} recent
              {feedMachineId
                ? ` · ${data?.by_machine.find((m) => m.machine_id === feedMachineId)?.machine_code || ''}`
                : ''}
            </span>
          </div>
          <div className="quality-feed">
            {feed.map((r) => (
              <article key={r.id} className="quality-feed-card">
                <header>
                  <strong>{r.machine_code}</strong>
                  <time>{r.inspected_at ? new Date(r.inspected_at).toLocaleString() : '—'}</time>
                </header>
                <div className="quality-feed-chips">
                  <span className="chip good">Good {formatNum(r.good_units)}</span>
                  <span className="chip scrap">Scrap {formatNum(r.rejected_units)}</span>
                  {r.defect_category ? <span className="chip defect">{r.defect_category}</span> : null}
                  {r.work_order_number ? <span className="chip wo">{r.work_order_number}</span> : null}
                </div>
                {r.notes ? <p>{r.notes}</p> : null}
              </article>
            ))}
            {!feed.length ? <div className="muted">No inspections to show</div> : null}
          </div>

          <button
            type="button"
            className="btn-ghost quality-table-toggle"
            onClick={() => setTableOpen((v) => !v)}
          >
            {tableOpen ? 'Hide all records' : 'Show all records (table)'}
          </button>
          {tableOpen ? (
            <div className="table-wrap quality-table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Inspected</th>
                    <th>Machine</th>
                    <th>WO</th>
                    <th>Good</th>
                    <th>Rejected</th>
                    <th>Defect</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.recent || []).map((r) => (
                    <tr key={r.id}>
                      <td>{r.inspected_at ? new Date(r.inspected_at).toLocaleString() : '—'}</td>
                      <td>{r.machine_code}</td>
                      <td>{r.work_order_number || '—'}</td>
                      <td>{formatNum(r.good_units)}</td>
                      <td>{formatNum(r.rejected_units)}</td>
                      <td>{r.defect_category || '—'}</td>
                      <td>{r.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>

      {drawerOpen ? (
        <div className="quality-drawer-backdrop" onClick={() => setDrawerOpen(false)} role="presentation">
          <aside
            className="quality-drawer"
            role="dialog"
            aria-label="Log inspection"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="quality-drawer-head">
              <h2>Log inspection</h2>
              <button type="button" className="icon-btn" onClick={() => setDrawerOpen(false)}>
                ✕
              </button>
            </header>
            <form className="quality-drawer-form" onSubmit={onSubmit}>
              <div className="field">
                <label>Machine</label>
                <select
                  required
                  value={form.machine_id}
                  onChange={(e) => setForm({ ...form, machine_id: e.target.value })}
                >
                  <option value="">Select…</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.machine_code} · {m.machine_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Work order</label>
                <select
                  value={form.work_order_id}
                  onChange={(e) => setForm({ ...form, work_order_id: e.target.value })}
                >
                  <option value="">None</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number}
                    </option>
                  ))}
                </select>
              </div>
              <div className="quality-drawer-qty">
                <div className="field">
                  <label>Good units</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={form.good_units}
                    onChange={(e) => setForm({ ...form, good_units: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Rejected</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={form.rejected_units}
                    onChange={(e) => setForm({ ...form, rejected_units: e.target.value })}
                  />
                </div>
              </div>
              <div className="field">
                <label>Defect category</label>
                <select
                  value={form.defect_category}
                  onChange={(e) => setForm({ ...form, defect_category: e.target.value })}
                >
                  {DEFECT_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="First-off, colour, mould cavity…"
                />
              </div>
              <button className="btn btn-primary" type="submit">
                Save quality record
              </button>
            </form>
          </aside>
        </div>
      ) : null}
    </>
  )
}
