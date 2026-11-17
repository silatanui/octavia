import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ReportsAiPanel, type ReportsAiAnalysis } from '../components/ReportsAiPanel'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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
import { addWidget, loadLayout, type WidgetId } from '../analysisLayout'
import { api, formatNum, formatPct } from '../api'
import { ChartSkeleton, KpiSkeleton, TableSkeleton } from '../components/Skeleton'

function PinToAnalysis({ widgetId }: { widgetId: WidgetId }) {
  const [pinned, setPinned] = useState(() => loadLayout().includes(widgetId))
  const [msg, setMsg] = useState('')

  function pin() {
    const next = addWidget(widgetId)
    const was = pinned
    setPinned(next.includes(widgetId))
    setMsg(was ? 'Already on Analysis' : 'Pinned to Analysis')
    window.setTimeout(() => setMsg(''), 1800)
  }

  return (
    <span className="mgmt-pin">
      <button type="button" className="mgmt-pin-btn" onClick={pin} title="Add this chart to the Analysis board">
        {pinned ? 'On Analysis' : 'Pin to Analysis'}
      </button>
      {msg ? (
        <em className="mgmt-pin-toast">
          {msg} · <Link to="/analysis">Open</Link>
        </em>
      ) : null}
    </span>
  )
}

type Option = {
  id: number
  department_name?: string
  line_name?: string
  department_id?: number
  machine_code?: string
  machine_name?: string
  production_line_id?: number
  shift_name?: string
}

type Kpis = {
  oee: number | null
  availability: number | null
  performance: number | null
  quality: number | null
  achievement: number | null
  downtime_minutes: number
  good_units: number
  total_units: number
  scrap_units: number
  delta_oee: number | null
  delta_availability: number | null
  delta_performance: number | null
  delta_quality: number | null
  delta_downtime_minutes: number | null
  delta_good_units: number | null
}

type TrendPoint = {
  date: string
  label: string
  oee: number | null
  availability: number | null
  performance: number | null
  quality: number | null
}

type OutputPoint = {
  date: string
  label: string
  total: number
  good: number
  scrap: number
}

type ParetoRow = {
  reason: string
  group: string
  color: string
  minutes: number
  hours: number
  count: number
  duration_label: string
  pct_of_downtime: number
  pct_of_planned: number
}

type DtDay = { date: string; label: string; minutes: number; hours: number }

type MachineRow = {
  machine_id: number
  machine_code: string
  machine_name: string
  line_name?: string | null
  oee: number | null
  availability: number | null
  performance: number | null
  quality: number | null
  downtime_minutes: number
  output: number
  good: number
  scrap: number
}

type MixSlice = { name: string; value: number; color: string }

type LossRow = {
  reason: string
  group: string
  color: string
  minutes: number
  count: number
  pct_of_downtime: number
  duration_label: string
}

type ManagementReport = {
  generated_at: string
  scope_label: string
  machine_count: number
  filters_echo: {
    days: number
    department_id: number | null
    line_id: number | null
    machine_id: number | null
    shift_id: number | null
    shift_name: string | null
  }
  kpis: Kpis
  oee_trend: TrendPoint[]
  output_trend: OutputPoint[]
  downtime_pareto: { total_minutes: number; rows: ParetoRow[] }
  downtime_by_day: DtDay[]
  machine_compare: MachineRow[]
  quality_mix: MixSlice[]
  top_losses: LossRow[]
  single_machine: MachineRow | null
}

const DAYS_OPTIONS = [7, 14, 30, 60] as const
const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const tipStyle = { background: '#0f172a', border: '1px solid #334155', color: '#fff', fontSize: 12 }

function deltaClass(v: number | null | undefined, invert = false) {
  if (v === null || v === undefined || v === 0) return 'mgmt-delta neutral'
  const good = invert ? v < 0 : v > 0
  return good ? 'mgmt-delta up' : 'mgmt-delta down'
}

function formatDelta(v: number | null | undefined, suffix = 'pp') {
  if (v === null || v === undefined) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}${suffix}`
}

function formatDeltaNum(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${Math.round(v).toLocaleString()}`
}

export function Reports() {
  const [searchParams] = useSearchParams()
  const [days, setDays] = useState(30)
  const [deptId, setDeptId] = useState('')
  const [lineId, setLineId] = useState('')
  const [machineId, setMachineId] = useState(() => searchParams.get('machine_id') || '')
  const [shiftId, setShiftId] = useState('')

  const [applied, setApplied] = useState({
    days: 30,
    deptId: '',
    lineId: '',
    machineId: searchParams.get('machine_id') || '',
    shiftId: '',
  })

  const [depts, setDepts] = useState<Option[]>([])
  const [lines, setLines] = useState<Option[]>([])
  const [machines, setMachines] = useState<Option[]>([])
  const [shifts, setShifts] = useState<Option[]>([])
  const [data, setData] = useState<ManagementReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiOpen, setAiOpen] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState<ReportsAiAnalysis | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<Option[]>('/admin/departments'),
      api.get<Option[]>('/admin/lines'),
      api.get<Option[]>('/machines'),
      api.get<Option[]>('/admin/shifts'),
    ])
      .then(([d, l, m, s]) => {
        setDepts(d)
        setLines(l)
        setMachines(m)
        setShifts(s)
      })
      .catch((e) => setError(e.message))
  }, [])

  const filteredLines = useMemo(
    () => lines.filter((l) => !deptId || String(l.department_id) === deptId),
    [lines, deptId],
  )

  const filteredMachines = useMemo(() => {
    let list = machines
    if (lineId) list = list.filter((m) => String(m.production_line_id) === lineId)
    else if (deptId) {
      const lineIds = new Set(filteredLines.map((l) => l.id))
      list = list.filter((m) => m.production_line_id != null && lineIds.has(m.production_line_id))
    }
    return list
  }, [machines, lineId, deptId, filteredLines])

  const qs = useMemo(() => {
    const p = new URLSearchParams({ days: String(applied.days) })
    if (applied.deptId) p.set('department_id', applied.deptId)
    if (applied.lineId) p.set('line_id', applied.lineId)
    if (applied.machineId) p.set('machine_id', applied.machineId)
    if (applied.shiftId) p.set('shift_id', applied.shiftId)
    return p.toString()
  }, [applied])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<ManagementReport>(`/reports/management?${qs}`)
      setData(res)
      sessionStorage.setItem('octavia_report_filters', qs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load report')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [qs])

  const loadAi = useCallback(async () => {
    setAiLoading(true)
    try {
      const res = await api.get<ReportsAiAnalysis>(`/reports/ai-analysis?${qs}`)
      setAiAnalysis(res)
    } catch (e) {
      setAiAnalysis({
        executive_summary: e instanceof Error ? e.message : 'AI analysis failed',
        findings: [],
        actions: [],
        provider: 'error',
      })
    } finally {
      setAiLoading(false)
    }
  }, [qs])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (aiOpen) loadAi()
  }, [aiOpen, loadAi])

  function applyFilters() {
    setApplied({ days, deptId, lineId, machineId, shiftId })
  }

  async function exportCsv() {
    const token = localStorage.getItem('octavia_token')
    const res = await fetch(`${API_BASE}/reports/management.csv?${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      setError('CSV export failed')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `octavia_management_${applied.days}d.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const singleMachine = Boolean(applied.machineId && data?.single_machine)
  const paretoRows = data?.downtime_pareto.rows || []
  const stopGroups = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of paretoRows) {
      if (r.group && r.color) map.set(r.group, r.color)
    }
    return Array.from(map.entries())
  }, [paretoRows])

  const kpis = data?.kpis

  return (
    <>
      <div className="topbar">
        <strong>Management reports</strong>
        <span className="muted" style={{ fontSize: '0.75rem' }}>
          {data?.scope_label || '—'}
          {loading ? ' · Loading…' : null}
        </span>
        <button className="btn-ghost" type="button" onClick={exportCsv} disabled={!data}>
          Export CSV
        </button>
        <button
          className={`btn-ghost${aiOpen ? ' active' : ''}`}
          type="button"
          onClick={() => setAiOpen((v) => !v)}
        >
          AI Analysis
        </button>
      </div>
      <div className={`mgmt-report-shell${aiOpen ? ' with-ai' : ''}`}>
      <div className="page mgmt-report">
        <p className="page-lead">
          Filter by window, department, line, or machine for OEE trends, losses, output, quality, and
          machine comparison. Use the AI panel for an executive read of the current scope.
        </p>

        <div className="mgmt-report-filters">
          <div className="field">
            <label>Days</label>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  Last {d} days
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Department</label>
            <select
              value={deptId}
              onChange={(e) => {
                setDeptId(e.target.value)
                setLineId('')
                setMachineId('')
              }}
            >
              <option value="">All departments</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.department_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Line</label>
            <select
              value={lineId}
              onChange={(e) => {
                setLineId(e.target.value)
                setMachineId('')
              }}
            >
              <option value="">All lines</option>
              {filteredLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.line_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Machine</label>
            <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">All machines</option>
              {filteredMachines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.machine_code} · {m.machine_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Shift</label>
            <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              <option value="">All shifts</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shift_name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" type="button" onClick={applyFilters}>
            Apply
          </button>
        </div>

        {error ? <div className="error">{error}</div> : null}

        {loading && !data ? (
          <div aria-busy="true">
            <KpiSkeleton count={6} />
            <div className="mgmt-report-grid">
              <div className="panel mgmt-panel mgmt-panel-wide">
                <ChartSkeleton height={220} />
              </div>
              <div className="panel mgmt-panel">
                <ChartSkeleton height={200} />
              </div>
              <div className="panel mgmt-panel">
                <ChartSkeleton height={200} />
              </div>
              <div className="panel mgmt-panel mgmt-panel-wide">
                <TableSkeleton rows={5} cols={4} />
              </div>
            </div>
          </div>
        ) : null}

        {kpis ? (
          <div className="mgmt-kpi-strip">
            <div className="mgmt-kpi">
              <div className="label">OEE</div>
              <div className="value">{formatPct(kpis.oee)}</div>
              <div className={deltaClass(kpis.delta_oee)}>{formatDelta(kpis.delta_oee)}</div>
            </div>
            <div className="mgmt-kpi">
              <div className="label">Availability</div>
              <div className="value">{formatPct(kpis.availability)}</div>
              <div className={deltaClass(kpis.delta_availability)}>{formatDelta(kpis.delta_availability)}</div>
            </div>
            <div className="mgmt-kpi">
              <div className="label">Performance</div>
              <div className="value">{formatPct(kpis.performance)}</div>
              <div className={deltaClass(kpis.delta_performance)}>{formatDelta(kpis.delta_performance)}</div>
            </div>
            <div className="mgmt-kpi">
              <div className="label">Quality</div>
              <div className="value">{formatPct(kpis.quality)}</div>
              <div className={deltaClass(kpis.delta_quality)}>{formatDelta(kpis.delta_quality)}</div>
            </div>
            <div className="mgmt-kpi">
              <div className="label">Downtime</div>
              <div className="value">{formatNum(kpis.downtime_minutes)} m</div>
              <div className={deltaClass(kpis.delta_downtime_minutes, true)}>
                {formatDelta(kpis.delta_downtime_minutes, ' m')}
              </div>
            </div>
            <div className="mgmt-kpi">
              <div className="label">Good qty</div>
              <div className="value">{formatNum(kpis.good_units)}</div>
              <div className={deltaClass(kpis.delta_good_units)}>{formatDeltaNum(kpis.delta_good_units)}</div>
            </div>
          </div>
        ) : null}

        {data ? <div className="mgmt-report-grid">
          <div className="panel mgmt-panel mgmt-panel-wide">
            <div className="panel-head-row">
              <h2 style={{ margin: 0 }}>OEE trend</h2>
              <span className="muted" style={{ fontSize: '0.72rem' }}>
                Daily OEE = Availability × Performance × Quality
              </span>
              <PinToAnalysis widgetId="oee_trend" />
            </div>
            <div className="mgmt-chart">
              <ResponsiveContainer>
                <ComposedChart data={data?.oee_trend || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={11} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={tipStyle} formatter={(v) => formatPct(Number(v))} />
                  <Legend />
                  <Line type="monotone" dataKey="oee" name="OEE" stroke="#0f766e" strokeWidth={2.2} dot={false} />
                  <Line type="monotone" dataKey="availability" name="Availability" stroke="#0369a1" strokeWidth={1.4} dot={false} />
                  <Line type="monotone" dataKey="performance" name="Performance" stroke="#c45c26" strokeWidth={1.4} dot={false} />
                  <Line type="monotone" dataKey="quality" name="Quality" stroke="#be123c" strokeWidth={1.4} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel mgmt-panel">
            <div className="panel-head-row">
              <h2 style={{ margin: 0 }}>Daily output</h2>
              <span className="muted" style={{ fontSize: '0.72rem' }}>
                Good + scrap
              </span>
              <PinToAnalysis widgetId="output_trend" />
            </div>
            <div className="mgmt-chart">
              <ResponsiveContainer>
                <BarChart data={data?.output_trend || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip contentStyle={tipStyle} />
                  <Legend />
                  <Bar dataKey="good" name="Good" stackId="out" fill="#0f766e" />
                  <Bar dataKey="scrap" name="Scrap" stackId="out" fill="#be123c" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel mgmt-panel">
            <div className="panel-head-row">
              <h2 style={{ margin: 0 }}>Downtime Pareto</h2>
              <span className="muted" style={{ fontSize: '0.72rem' }}>
                {paretoRows.length} reasons · {formatNum(data?.downtime_pareto.total_minutes)} min
              </span>
              <PinToAnalysis widgetId="downtime_pareto" />
            </div>
            <div className="mgmt-chart mgmt-chart-tall">
              <ResponsiveContainer>
                <BarChart
                  layout="vertical"
                  data={paretoRows.slice(0, 10)}
                  margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                >
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" stroke="#64748b" fontSize={11} tickFormatter={(v) => `${v}h`} />
                  <YAxis
                    type="category"
                    dataKey="reason"
                    width={110}
                    stroke="#64748b"
                    fontSize={10}
                    tickFormatter={(v) => (String(v).length > 16 ? `${String(v).slice(0, 15)}…` : String(v))}
                  />
                  <Tooltip
                    contentStyle={tipStyle}
                    formatter={(_v, _n, item) => {
                      const row = item?.payload as ParetoRow | undefined
                      if (!row) return ['—', '']
                      return [
                        `${row.duration_label} · ${row.count} stops · ${row.pct_of_downtime}% of DT`,
                        row.group,
                      ]
                    }}
                  />
                  <Bar dataKey="hours" name="Hours" radius={0}>
                    {paretoRows.slice(0, 10).map((r) => (
                      <Cell key={r.reason} fill={r.color || '#b91c1c'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {stopGroups.length ? (
              <div className="stop-group-legend">
                <span>Stop groups</span>
                {stopGroups.map(([name, color]) => (
                  <em key={name}>
                    <i style={{ background: color }} />
                    {name}
                  </em>
                ))}
              </div>
            ) : null}
          </div>

          <div className="panel mgmt-panel">
            <div className="panel-head-row">
              <h2 style={{ margin: 0 }}>Downtime by day</h2>
              <span className="muted" style={{ fontSize: '0.72rem' }}>
                Minutes
              </span>
              <PinToAnalysis widgetId="downtime_by_day" />
            </div>
            <div className="mgmt-chart">
              <ResponsiveContainer>
                <AreaChart data={data?.downtime_by_day || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip contentStyle={tipStyle} />
                  <Area
                    type="monotone"
                    dataKey="minutes"
                    name="Minutes"
                    stroke="#b91c1c"
                    fill="#fecaca"
                    strokeWidth={1.6}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {singleMachine && data?.single_machine ? (
            <div className="panel mgmt-panel mgmt-panel-wide">
              <div className="panel-head-row">
                <h2 style={{ margin: 0 }}>Machine detail</h2>
                <span className="muted" style={{ fontSize: '0.72rem' }}>
                  {data.single_machine.machine_code} · {data.single_machine.machine_name}
                </span>
              </div>
              <div className="mgmt-machine-detail">
                <div>
                  <span className="label">OEE</span>
                  <strong>{formatPct(data.single_machine.oee)}</strong>
                </div>
                <div>
                  <span className="label">Availability</span>
                  <strong>{formatPct(data.single_machine.availability)}</strong>
                </div>
                <div>
                  <span className="label">Performance</span>
                  <strong>{formatPct(data.single_machine.performance)}</strong>
                </div>
                <div>
                  <span className="label">Quality</span>
                  <strong>{formatPct(data.single_machine.quality)}</strong>
                </div>
                <div>
                  <span className="label">Output</span>
                  <strong>{formatNum(data.single_machine.output)}</strong>
                </div>
                <div>
                  <span className="label">Good</span>
                  <strong>{formatNum(data.single_machine.good)}</strong>
                </div>
                <div>
                  <span className="label">Scrap</span>
                  <strong>{formatNum(data.single_machine.scrap)}</strong>
                </div>
                <div>
                  <span className="label">Downtime</span>
                  <strong>{formatNum(data.single_machine.downtime_minutes)} m</strong>
                </div>
              </div>
            </div>
          ) : (
            <div className="panel mgmt-panel mgmt-panel-wide">
              <div className="panel-head-row">
                <h2 style={{ margin: 0 }}>Machine comparison</h2>
                <span className="muted" style={{ fontSize: '0.72rem' }}>
                  {data?.machine_compare.length || 0} machines · OEE / downtime / output
                </span>
                <PinToAnalysis widgetId="machine_compare" />
              </div>
              <div className="mgmt-chart mgmt-chart-tall">
                <ResponsiveContainer>
                  <BarChart
                    data={data?.machine_compare || []}
                    margin={{ top: 8, right: 8, left: 0, bottom: 48 }}
                  >
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="machine_code"
                      stroke="#64748b"
                      fontSize={10}
                      interval={0}
                      angle={-30}
                      textAnchor="end"
                      height={56}
                    />
                    <YAxis yAxisId="pct" stroke="#64748b" fontSize={11} domain={[0, 100]} />
                    <YAxis yAxisId="qty" orientation="right" stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={tipStyle} />
                    <Legend />
                    <Bar yAxisId="pct" dataKey="oee" name="OEE %" fill="#0f766e" />
                    <Bar yAxisId="pct" dataKey="availability" name="Avail %" fill="#0369a1" />
                    <Bar yAxisId="qty" dataKey="output" name="Output" fill="#64748b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="panel mgmt-panel">
            <div className="panel-head-row">
              <h2 style={{ margin: 0 }}>Quality mix</h2>
              <span className="muted" style={{ fontSize: '0.72rem' }}>
                Good vs scrap
              </span>
              <PinToAnalysis widgetId="quality_mix" />
            </div>
            <div className="mgmt-chart mgmt-chart-pie">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={data?.quality_mix || []}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="48%"
                    outerRadius="78%"
                    paddingAngle={2}
                  >
                    {(data?.quality_mix || []).map((s) => (
                      <Cell key={s.name} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tipStyle} formatter={(v) => formatNum(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel mgmt-panel">
            <div className="panel-head-row">
              <h2 style={{ margin: 0 }}>Top losses</h2>
              <span className="muted" style={{ fontSize: '0.72rem' }}>
                Ranked by downtime
              </span>
              <PinToAnalysis widgetId="top_losses" />
            </div>
            <div className="mgmt-losses-table-wrap">
              <table className="mgmt-losses-table">
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th>Duration</th>
                    <th>Stops</th>
                    <th>% DT</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.top_losses || []).map((r) => (
                    <tr key={r.reason}>
                      <td>
                        <i className="mgmt-loss-swatch" style={{ background: r.color }} />
                        {r.reason}
                      </td>
                      <td>{r.duration_label}</td>
                      <td>{r.count}</td>
                      <td>{r.pct_of_downtime.toFixed(1)}%</td>
                    </tr>
                  ))}
                  {!data?.top_losses?.length ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No downtime in this window
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div> : null}
      </div>
      <ReportsAiPanel
        open={aiOpen}
        analysis={aiAnalysis}
        loading={aiLoading}
        onRefresh={loadAi}
        onClose={() => setAiOpen(false)}
      />
      </div>
    </>
  )
}
