import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, formatNum, formatPct } from '../api'
import { AiSummaryPanel, type AiSummary } from '../components/AiSummaryPanel'
import { Skeleton } from '../components/Skeleton'
import { TimelineBar } from '../components/TimelineBar'
import { PLANT, machineByCode, machineByIndex, productByCode } from '../plantCatalog'

const TABLE_SKELETON_ROWS = 8

type TimelineSeg = {
  start_pct: number
  end_pct: number
  state: string
  color: string
  label: string
}

type MachineRow = {
  id: number
  machine_code: string
  machine_name: string
  line_name?: string | null
  status: string
  part_code?: string | null
  part_name?: string | null
  operation?: string | null
  output: number
  previous_output: number
  target: number
  achievement: number | null
  utilization: number | null
  utilization_goal: number
  oee: number | null
  actual_cycle_seconds: number | null
  ideal_cycle_seconds: number
  cycle_delta_seconds: number | null
  cycle_label: string
  downtime_reasons: { reason: string; minutes: number; hours_label: string }[]
  timeline: TimelineSeg[]
}

type DashboardData = {
  date: string
  compare_date: string
  date_label: string
  compare_label: string
  last_updated: string
  demo_mode: boolean
  timeline_hours: number[]
  timeline_shift_start?: number
  timeline_shift_hours?: number
  active_shift?: { key: string; name: string; label: string }
  kpis: Record<string, number | string | null>
  machines: MachineRow[]
}

type Option = { id: number; [k: string]: unknown }

function metricTone(value: number | null | undefined, goodAbove = 80) {
  if (value == null) return 'neutral'
  return value >= goodAbove ? 'good' : 'bad'
}

function Delta({ value, suffix = '', invert = false }: { value: number | null | undefined; suffix?: string; invert?: boolean }) {
  if (value == null || Number.isNaN(value)) return null
  const positive = invert ? value < 0 : value > 0
  const negative = invert ? value > 0 : value < 0
  const sign = value > 0 ? '+' : ''
  return (
    <span className={`delta ${positive ? 'up' : ''} ${negative ? 'down' : ''}`}>
      {sign}
      {typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value}
      {suffix}
    </span>
  )
}

function MetricBadge({
  value,
  compare,
  goal,
}: {
  value: number | null
  compare?: boolean
  goal?: number
}) {
  if (value == null) return <span className="badge neutral">—</span>
  const tone = goal != null ? (value >= goal ? 'good' : 'bad') : metricTone(value, 80)
  if (compare && goal != null) {
    return (
      <span className={`badge ${tone}`}>
        {value.toFixed(1)}% vs {goal.toFixed(1)}%
      </span>
    )
  }
  return <span className={`badge ${tone}`}>{value.toFixed(1)}%</span>
}

export function Dashboard() {
  const navigate = useNavigate()
  const today = new Date().toISOString().slice(0, 10)
  const [datePreset, setDatePreset] = useState('today')
  const [date, setDate] = useState(today)
  const [siteId, setSiteId] = useState('')
  const [deptId, setDeptId] = useState('')
  const [lineId, setLineId] = useState('')
  const [shiftId, setShiftId] = useState('')
  const [machineId, setMachineId] = useState('')
  const [data, setData] = useState<DashboardData | null>(null)
  const [sites, setSites] = useState<Option[]>([])
  const [depts, setDepts] = useState<Option[]>([])
  const [lines, setLines] = useState<Option[]>([])
  const [shifts, setShifts] = useState<Option[]>([])
  const [allMachines, setAllMachines] = useState<Option[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [summary, setSummary] = useState<AiSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get<Option[]>('/admin/sites'),
      api.get<Option[]>('/admin/departments'),
      api.get<Option[]>('/admin/lines'),
      api.get<Option[]>('/admin/shifts'),
      api.get<Option[]>('/machines'),
    ])
      .then(([s, d, l, sh, m]) => {
        setSites(s)
        setDepts(d)
        setLines(l)
        setShifts(sh)
        setAllMachines(m)
        if (s[0]) setSiteId(String(s[0].id))
      })
      .catch((e) => setError(e.message))
  }, [])

  function applyPreset(preset: string) {
    setDatePreset(preset)
    const d = new Date()
    if (preset === 'yesterday') d.setDate(d.getDate() - 1)
    if (preset === '3days') d.setDate(d.getDate() - 3)
    if (preset === '7days') d.setDate(d.getDate() - 7)
    setDate(d.toISOString().slice(0, 10))
  }

  const qs = useMemo(() => {
    const p = new URLSearchParams({ date })
    if (siteId) p.set('site_id', siteId)
    if (deptId) p.set('department_id', deptId)
    if (lineId) p.set('line_id', lineId)
    if (shiftId) p.set('shift_id', shiftId)
    if (machineId) p.set('machine_id', machineId)
    return p.toString()
  }, [date, siteId, deptId, lineId, shiftId, machineId])

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const res = await api.get<AiSummary>(`/dashboard/ai-summary?${qs}`)
      setSummary(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load AI summary')
    } finally {
      setSummaryLoading(false)
    }
  }, [qs])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<DashboardData>(`/dashboard/daily?${qs}`)
      setData(res)
      if (summaryOpen) {
        await loadSummary()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [qs, summaryOpen, loadSummary])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (summaryOpen && !summary) {
      loadSummary()
    }
  }, [summaryOpen, summary, loadSummary])

  useEffect(() => {
    function onFs() {
      setFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  async function toggleFullscreen() {
    const el = document.getElementById('daily-board')
    if (!el) return
    if (!document.fullscreenElement) await el.requestFullscreen()
    else await document.exitFullscreen()
  }

  async function exportCsv() {
    const token = localStorage.getItem('octavia_token')
    const res = await fetch(api.exportCsvUrl(qs), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `octavia_daily_${date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const kpis = data?.kpis
  const machines = data?.machines || []
  const initialLoading = loading && !data
  const refreshing = loading && !!data

  return (
    <div
      id="daily-board"
      className={`daily-board${fullscreen ? ' is-fullscreen' : ''}${initialLoading ? ' is-loading' : ''}${refreshing ? ' is-refreshing' : ''}`}
    >
      <header className="daily-header">
        <div className="daily-toolbar">
          <div className="daily-toolbar-meta">
            <span className="daily-plant-sub">
              {PLANT.siteName} · {PLANT.location}
            </span>
            <span className="refreshed">
              {initialLoading
                ? 'Loading board…'
                : `Refreshed ${data?.last_updated ? new Date(data.last_updated).toLocaleString() : '—'}${refreshing ? ' · Updating…' : ''}${data?.active_shift?.label ? ` · ${data.active_shift.label}` : ''}`}
            </span>
          </div>
          <div className="daily-actions">
            <button className="icon-btn" type="button" onClick={load} title="Refresh">
              ↻
            </button>
            <button className="icon-btn" type="button" onClick={exportCsv} title="Export CSV">
              ⇩
            </button>
            <button
              className={`icon-btn${summaryOpen ? ' active' : ''}`}
              type="button"
              onClick={() => {
                setSummaryOpen((v) => !v)
                if (!summaryOpen) loadSummary()
              }}
              title="AI Summary"
            >
              ✦
            </button>
            <button className="icon-btn" type="button" onClick={toggleFullscreen} title="Fullscreen">
              ⛶
            </button>
          </div>
        </div>

        <div className="daily-filters">
          <select value={datePreset} onChange={(e) => applyPreset(e.target.value)}>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="3days">3 Days Ago</option>
            <option value="7days">7 Days Ago</option>
            <option value="custom">Custom date…</option>
          </select>
          {datePreset === 'custom' ? (
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          ) : null}
          <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
            <option value="">Shifts</option>
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {String(s.shift_name)}
              </option>
            ))}
          </select>
          <select
            value={deptId}
            onChange={(e) => {
              setDeptId(e.target.value)
              setLineId('')
            }}
          >
            <option value="">Groups</option>
            {depts
              .filter((d) => !siteId || String(d.site_id) === siteId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {String(d.department_name)}
                </option>
              ))}
          </select>
          <select value={lineId} onChange={(e) => setLineId(e.target.value)}>
            <option value="">All lines</option>
            {lines
              .filter((l) => !deptId || String(l.department_id) === deptId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {String(l.line_name)}
                </option>
              ))}
          </select>
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">Machines</option>
            {allMachines.map((m) => (
              <option key={m.id} value={m.id}>
                {String(m.machine_code)} — {String(m.machine_name)}
              </option>
            ))}
          </select>
          {sites.length > 1 ? (
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {String(s.site_name)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </header>

      {error ? <div className="error" style={{ padding: '0 1.25rem' }}>{error}</div> : null}

      <section className="daily-kpis" aria-busy={initialLoading}>
        {initialLoading ? (
          Array.from({ length: 5 }, (_, i) => (
            <div className="daily-kpi" key={`kpi-sk-${i}`}>
              <div className="k-label">{['Date Range', 'Total Parts', 'Utilization Rate', 'Parts Goal', 'Downtime'][i]}</div>
              <Skeleton className="sk-block sk-kpi-value" />
              <Skeleton className="sk-block sk-kpi-sub" />
            </div>
          ))
        ) : (
          <>
            <div className="daily-kpi">
              <div className="k-label">Date Range</div>
              <div className="k-value sm">
                {datePreset === 'today'
                  ? 'Today'
                  : datePreset === 'yesterday'
                    ? 'Yesterday'
                    : datePreset === '3days'
                      ? '3 Days Ago'
                      : data?.date_label || date}
                <span className="vs"> vs {data?.compare_label || 'prior day'}</span>
              </div>
            </div>
            <div className="daily-kpi">
              <div className="k-label">Total Parts</div>
              <div className="k-value">
                {formatNum(kpis?.actual_production as number)}
                <Delta value={kpis?.production_delta as number} />
              </div>
            </div>
            <div className="daily-kpi">
              <div className="k-label">Utilization Rate</div>
              <div className="k-value">
                {formatPct(kpis?.utilization as number)}
                <Delta value={kpis?.availability_delta_pp as number} suffix="pp" />
              </div>
            </div>
            <div className="daily-kpi">
              <div className="k-label">Parts Goal</div>
              <div className="k-value">
                {formatPct(kpis?.achievement as number)}
                <Delta value={kpis?.achievement_delta_pp as number} suffix="pp" />
              </div>
            </div>
            <div className="daily-kpi">
              <div className="k-label">Downtime</div>
              <div className="k-value">
                {String(kpis?.downtime_label || '—')}
                {kpis?.downtime_delta_minutes != null ? (
                  <span
                    className={`delta ${
                      Number(kpis.downtime_delta_minutes) > 0
                        ? 'down'
                        : Number(kpis.downtime_delta_minutes) < 0
                          ? 'up'
                          : ''
                    }`}
                  >
                    {Number(kpis.downtime_delta_minutes) > 0 ? '+' : Number(kpis.downtime_delta_minutes) < 0 ? '−' : ''}
                    {String(kpis.downtime_delta_label || '')}
                  </span>
                ) : null}
              </div>
            </div>
          </>
        )}
      </section>

      <div className={`daily-content${summaryOpen ? ' with-summary' : ''}`}>
        <section className="daily-table-wrap">
          <div className="timeline-legend">
            <span><i className="swatch green" /> Running</span>
            <span><i className="swatch amber" /> Slow / micro-stop</span>
            <span><i className="swatch red" /> Stop / fault / issue</span>
            <span><i className="swatch break" /> Break</span>
            <span><i className="swatch planned" /> Start / end</span>
            <span><i className="swatch gray" /> Upcoming / off shift</span>
          </div>
          {initialLoading ? (
            <div className="daily-skel-hint" role="status">
              <i className="sk-pulse-dot" />
              Loading machines and timelines…
            </div>
          ) : null}
          <table className="daily-table">
            <thead>
              <tr>
                <th className="col-machine">Machine</th>
                <th className="col-count">
                  Count
                  <span className="th-sub">vs prev day</span>
                </th>
                <th className="col-oee">OEE</th>
                <th className="col-util">Utilization</th>
                <th className="col-cycle">Cycle time</th>
                <th className="col-reasons">Top reasons</th>
                <th className="col-timeline">
                  <div className="timeline-head">
                    <TimelineBar
                      segments={[]}
                      hours={data?.timeline_hours}
                      showAxis
                      shiftStartHour={data?.timeline_shift_start ?? 6}
                      shiftHours={data?.timeline_shift_hours ?? 8}
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {initialLoading
                ? Array.from({ length: TABLE_SKELETON_ROWS }, (_, i) => (
                    <tr key={`sk-row-${i}`} className="daily-skel-row" aria-hidden>
                      <td className="col-machine">
                        <div className="daily-skel-machine">
                          <Skeleton className="daily-skel-thumb" />
                          <div className="daily-skel-lines">
                            <Skeleton className="daily-skel-line" style={{ width: '72%' }} />
                            <Skeleton className="daily-skel-line" style={{ width: '48%' }} />
                            <Skeleton className="daily-skel-line" style={{ width: '58%' }} />
                          </div>
                          <Skeleton className="daily-skel-thumb sm" />
                        </div>
                      </td>
                      <td className="col-count">
                        <div className="daily-skel-lines">
                          <Skeleton className="daily-skel-line" style={{ width: '3.2rem' }} />
                          <Skeleton className="daily-skel-line" style={{ width: '2.4rem' }} />
                        </div>
                      </td>
                      <td className="col-oee">
                        <Skeleton className="daily-skel-badge" />
                      </td>
                      <td className="col-util">
                        <Skeleton className="daily-skel-badge" style={{ width: '5.5rem' }} />
                      </td>
                      <td className="col-cycle">
                        <Skeleton className="daily-skel-badge" style={{ width: '4.8rem' }} />
                      </td>
                      <td className="col-reasons">
                        <div className="daily-skel-lines">
                          <Skeleton className="daily-skel-line" style={{ width: '88%' }} />
                          <Skeleton className="daily-skel-line" style={{ width: '70%' }} />
                        </div>
                      </td>
                      <td className="col-timeline">
                        <Skeleton className="sk-block daily-skel-timeline" />
                      </td>
                    </tr>
                  ))
                : machines.map((m) => {
                    const catalog = machineByCode(m.machine_code) || machineByIndex(m.id)
                    const product = productByCode(catalog.productCode)
                    return (
                      <tr key={m.id} onClick={() => navigate(`/machines/${m.id}`)}>
                        <td className="col-machine">
                          <div className="machine-cell">
                            <img className="machine-thumb" src={catalog.image} alt="" />
                            <div>
                              <div className="machine-name">{catalog.name}</div>
                              <div className="machine-sub">
                                {catalog.code} · {product.code}
                              </div>
                              <div className="machine-sub faint">{product.name}</div>
                            </div>
                            <img className="product-thumb" src={product.image} alt="" />
                          </div>
                        </td>
                        <td className="col-count">
                          <div className="count-main">{formatNum(m.output)}</div>
                          <div className="count-prev" title="Previous day">
                            prev {formatNum(m.previous_output)}
                          </div>
                        </td>
                        <td className="col-oee">
                          <MetricBadge value={m.oee} />
                        </td>
                        <td className="col-util">
                          <MetricBadge value={m.utilization} compare goal={m.utilization_goal} />
                        </td>
                        <td className="col-cycle">
                          <span
                            className={`badge ${
                              m.cycle_delta_seconds == null
                                ? 'neutral'
                                : m.cycle_delta_seconds <= 0
                                  ? 'good'
                                  : 'bad'
                            }`}
                          >
                            {m.cycle_label}
                          </span>
                        </td>
                        <td className="col-reasons">
                          <ul className="reason-list">
                            {m.downtime_reasons.length ? (
                              m.downtime_reasons.map((r) => (
                                <li key={r.reason}>
                                  <span>{r.reason}</span>
                                  <strong>{r.hours_label}</strong>
                                </li>
                              ))
                            ) : (
                              <li className="empty">No downtime</li>
                            )}
                          </ul>
                        </td>
                        <td className="col-timeline">
                          <TimelineBar
                            segments={m.timeline}
                            hours={data?.timeline_hours}
                            shiftStartHour={data?.timeline_shift_start ?? 6}
                            shiftHours={data?.timeline_shift_hours ?? 8}
                          />
                        </td>
                      </tr>
                    )
                  })}
              {!initialLoading && !machines.length ? (
                <tr>
                  <td colSpan={7} className="empty-row">
                    No machines for the selected filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <AiSummaryPanel
          open={summaryOpen}
          summary={summary}
          loading={summaryLoading}
          onRefresh={loadSummary}
          onClose={() => setSummaryOpen(false)}
        />
      </div>
    </div>
  )
}
