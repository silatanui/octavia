import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  addWidget,
  availableToAdd,
  catalogById,
  loadLayout,
  layoutNeedsReports,
  removeWidget,
  resetLayout,
  type WidgetId,
} from '../analysisLayout'
import { api, formatNum, formatPct } from '../api'

type OeeBlock = {
  days: number
  oee: number
  delta: number
  availability: number
  performance: number
  quality: number
  total_units: number
  good_units: number
  rejected_units: number
  downtime_minutes: number
}

type DowntimeRow = {
  reason: string
  group: string
  color: string
  minutes: number
  hours: number
  count: number
  duration_label: string
}

type DowntimeBlock = {
  days: number
  total_minutes: number
  rows: DowntimeRow[]
}

type QtyDay = {
  date: string
  label: string
  total: number
  good: number
  scrap: number
}

type Overview = {
  generated_at: string
  oee_7d: OeeBlock
  oee_30d: OeeBlock
  downtime_7d: DowntimeBlock
  downtime_30d: DowntimeBlock
  quantity_30d: QtyDay[]
}

type MgmtReport = {
  oee_trend: Array<{
    label: string
    oee: number | null
    availability: number | null
    performance: number | null
    quality: number | null
  }>
  output_trend: Array<{ label: string; good: number; scrap: number; total: number }>
  downtime_pareto: {
    total_minutes: number
    rows: Array<{
      reason: string
      group: string
      color: string
      hours: number
      count: number
      duration_label: string
      pct_of_downtime: number
    }>
  }
  downtime_by_day: Array<{ label: string; minutes: number }>
  machine_compare: Array<{
    machine_code: string
    oee: number | null
    availability: number | null
    output: number
  }>
  quality_mix: Array<{ name: string; value: number; color: string }>
  top_losses: Array<{
    reason: string
    color: string
    duration_label: string
    count: number
    pct_of_downtime: number
  }>
}

const tipLight = { background: '#fff', border: '1px solid #cbd5e1', fontSize: 11 }

function WidgetMenu({
  openPath,
  onRemove,
}: {
  openPath: string
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="analysis-widget-menu" ref={ref}>
      <button
        type="button"
        className="analysis-widget-menu-btn"
        aria-label="Widget options"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ···
      </button>
      {open ? (
        <div className="analysis-widget-menu-drop" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              navigate(openPath)
            }}
          >
            Open full view
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setOpen(false)
              onRemove()
            }}
          >
            Remove widget
          </button>
        </div>
      ) : null}
    </div>
  )
}

function WidgetShell({
  id,
  title,
  openPath,
  onRemove,
  children,
}: {
  id: WidgetId
  title: string
  openPath: string
  onRemove: (id: WidgetId) => void
  children: ReactNode
}) {
  return (
    <article className="analysis-widget" data-widget={id}>
      <header className="analysis-widget-head">
        <h2>{title}</h2>
        <WidgetMenu openPath={openPath} onRemove={() => onRemove(id)} />
      </header>
      {children}
    </article>
  )
}

function OeeGauge({
  block,
  id,
  title,
  openPath,
  onRemove,
}: {
  block: OeeBlock
  id: WidgetId
  title: string
  openPath: string
  onRemove: (id: WidgetId) => void
}) {
  const rings = useMemo(() => {
    const a = Math.max(0, Math.min(block.availability, 100))
    const p = Math.max(0, Math.min(block.performance, 100))
    const q = Math.max(0, Math.min(block.quality, 100))
    return {
      availability: [
        { name: 'a', value: a, fill: '#0f766e' },
        { name: 'ar', value: 100 - a, fill: '#e2e8f0' },
      ],
      performance: [
        { name: 'p', value: p, fill: '#c45c26' },
        { name: 'pr', value: 100 - p, fill: '#e2e8f0' },
      ],
      quality: [
        { name: 'q', value: q, fill: '#be123c' },
        { name: 'qr', value: 100 - q, fill: '#e2e8f0' },
      ],
    }
  }, [block])

  const deltaPositive = block.delta >= 0

  return (
    <WidgetShell id={id} title={title} openPath={openPath} onRemove={onRemove}>
      <div className="oee-gauge-body">
        <ul className="oee-apq-list">
          <li>
            <i style={{ background: '#0f766e' }} />
            Availability <b>{formatPct(block.availability)}</b>
          </li>
          <li>
            <i style={{ background: '#c45c26' }} />
            Performance <b>{formatPct(block.performance)}</b>
          </li>
          <li>
            <i style={{ background: '#be123c' }} />
            Quality <b>{formatPct(block.quality)}</b>
          </li>
        </ul>
        <div className="oee-gauge-chart">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={rings.availability}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius="78%"
                outerRadius="92%"
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
              />
              <Pie
                data={rings.performance}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius="62%"
                outerRadius="74%"
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
              />
              <Pie
                data={rings.quality}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius="46%"
                outerRadius="58%"
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="oee-gauge-center">
            <strong>{formatPct(block.oee)}</strong>
            <em className={deltaPositive ? 'up' : 'down'}>
              {deltaPositive ? '+' : ''}
              {block.delta.toFixed(2)}%
            </em>
          </div>
        </div>
      </div>
    </WidgetShell>
  )
}

function DowntimeWidget({
  block,
  id,
  title,
  openPath,
  onRemove,
}: {
  block: DowntimeBlock
  id: WidgetId
  title: string
  openPath: string
  onRemove: (id: WidgetId) => void
}) {
  const data = block.rows.map((r) => ({
    ...r,
    label: r.reason.length > 18 ? `${r.reason.slice(0, 16)}…` : r.reason,
  }))
  const maxHours = Math.max(...data.map((d) => d.hours), 0.1)

  return (
    <WidgetShell id={id} title={title} openPath={openPath} onRemove={onRemove}>
      <div className="analysis-chart downtime-chart">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
              <XAxis type="number" hide domain={[0, maxHours * 1.15]} />
              <YAxis
                type="category"
                dataKey="label"
                width={108}
                tick={{ fill: '#475569', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tipLight}
                formatter={(value, _name, item) => {
                  const row = item?.payload as DowntimeRow
                  return [`${row?.duration_label || value} · ${row?.count || 0} stops`, row?.group || 'Downtime']
                }}
              />
              <Bar dataKey="hours" radius={0} barSize={14}>
                {data.map((r) => (
                  <Cell key={r.reason} fill={r.color || '#64748b'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="analysis-empty">No downtime coded in this window</div>
        )}
      </div>
    </WidgetShell>
  )
}

function QuantityWidget({
  id,
  title,
  data,
  dataKey,
  color,
  openPath,
  onRemove,
  unit = 'pcs',
}: {
  id: WidgetId
  title: string
  data: QtyDay[]
  dataKey: 'total' | 'good' | 'scrap'
  color: string
  openPath: string
  onRemove: (id: WidgetId) => void
  unit?: string
}) {
  return (
    <WidgetShell id={id} title={title} openPath={openPath} onRemove={onRemove}>
      <div className="analysis-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: '#94a3b8', fontSize: 9 }}
              interval="preserveStartEnd"
              minTickGap={28}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 9 }}
              width={36}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
            />
            <Tooltip
              contentStyle={tipLight}
              formatter={(value) => [`${formatNum(Number(value))} ${unit}`, title]}
            />
            <Bar dataKey={dataKey} fill={color} radius={0} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WidgetShell>
  )
}

function ReportOeeTrend({ report, id, title, openPath, onRemove }: ReportWidgetProps) {
  return (
    <WidgetShell id={id} title={title} openPath={openPath} onRemove={onRemove}>
      <div className="analysis-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={report?.oee_trend || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 9 }} interval="preserveStartEnd" minTickGap={24} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 9 }} width={32} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tipLight} formatter={(v) => formatPct(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="oee" name="OEE" stroke="#0f766e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="availability" name="Availability" stroke="#0369a1" strokeWidth={1.2} dot={false} />
            <Line type="monotone" dataKey="performance" name="Performance" stroke="#c45c26" strokeWidth={1.2} dot={false} />
            <Line type="monotone" dataKey="quality" name="Quality" stroke="#be123c" strokeWidth={1.2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </WidgetShell>
  )
}

type ReportWidgetProps = {
  report: MgmtReport | null
  id: WidgetId
  title: string
  openPath: string
  onRemove: (id: WidgetId) => void
}

function ReportOutputTrend({ report, id, title, openPath, onRemove }: ReportWidgetProps) {
  return (
    <WidgetShell id={id} title={title} openPath={openPath} onRemove={onRemove}>
      <div className="analysis-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={report?.output_trend || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 9 }} interval="preserveStartEnd" minTickGap={24} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} width={36} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tipLight} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="good" name="Good" stackId="out" fill="#0f766e" />
            <Bar dataKey="scrap" name="Scrap" stackId="out" fill="#be123c" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WidgetShell>
  )
}

function ReportPareto({ report, id, title, openPath, onRemove }: ReportWidgetProps) {
  const rows = (report?.downtime_pareto.rows || []).slice(0, 8).map((r) => ({
    ...r,
    label: r.reason.length > 16 ? `${r.reason.slice(0, 15)}…` : r.reason,
  }))
  return (
    <WidgetShell id={id} title={title} openPath={openPath} onRemove={onRemove}>
      <div className="analysis-chart downtime-chart">
        {rows.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="label" width={100} tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={tipLight}
                formatter={(_v, _n, item) => {
                  const row = item?.payload as (typeof rows)[0] | undefined
                  if (!row) return ['—', '']
                  return [`${row.duration_label} · ${row.count} stops`, row.group]
                }}
              />
              <Bar dataKey="hours" barSize={12}>
                {rows.map((r) => (
                  <Cell key={r.reason} fill={r.color || '#64748b'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="analysis-empty">No downtime in this window</div>
        )}
      </div>
    </WidgetShell>
  )
}

function ReportDowntimeByDay({ report, id, title, openPath, onRemove }: ReportWidgetProps) {
  return (
    <WidgetShell id={id} title={title} openPath={openPath} onRemove={onRemove}>
      <div className="analysis-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={report?.downtime_by_day || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 9 }} interval="preserveStartEnd" minTickGap={24} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} width={36} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tipLight} />
            <Area type="monotone" dataKey="minutes" name="Minutes" stroke="#b91c1c" fill="#fecaca" strokeWidth={1.4} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </WidgetShell>
  )
}

function ReportMachineCompare({ report, id, title, openPath, onRemove }: ReportWidgetProps) {
  return (
    <WidgetShell id={id} title={title} openPath={openPath} onRemove={onRemove}>
      <div className="analysis-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={report?.machine_compare || []} margin={{ top: 8, right: 8, left: 0, bottom: 28 }}>
            <XAxis dataKey="machine_code" tick={{ fill: '#94a3b8', fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={40} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 9 }} width={32} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tipLight} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="oee" name="OEE %" fill="#0f766e" />
            <Bar dataKey="availability" name="Avail %" fill="#0369a1" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WidgetShell>
  )
}

function ReportQualityMix({ report, id, title, openPath, onRemove }: ReportWidgetProps) {
  return (
    <WidgetShell id={id} title={title} openPath={openPath} onRemove={onRemove}>
      <div className="analysis-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={report?.quality_mix || []}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="42%"
              outerRadius="72%"
              paddingAngle={2}
            >
              {(report?.quality_mix || []).map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tipLight} formatter={(v) => formatNum(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </WidgetShell>
  )
}

function ReportTopLosses({ report, id, title, openPath, onRemove }: ReportWidgetProps) {
  const rows = report?.top_losses || []
  return (
    <WidgetShell id={id} title={title} openPath={openPath} onRemove={onRemove}>
      <div className="analysis-losses-wrap">
        <table className="analysis-losses-table">
          <thead>
            <tr>
              <th>Reason</th>
              <th>Dur</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.reason}>
                <td>
                  <i className="mgmt-loss-swatch" style={{ background: r.color }} />
                  {r.reason}
                </td>
                <td>{r.duration_label}</td>
                <td>{r.pct_of_downtime.toFixed(0)}%</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={3} className="muted">
                  No downtime
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </WidgetShell>
  )
}

export function Analysis() {
  const [layout, setLayout] = useState<WidgetId[]>(() => loadLayout())
  const [data, setData] = useState<Overview | null>(null)
  const [report, setReport] = useState<MgmtReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)

  const needsReports = layoutNeedsReports(layout)
  const addable = useMemo(() => availableToAdd(layout), [layout])

  useEffect(() => {
    setLoading(true)
    api
      .get<Overview>('/analysis/overview')
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!needsReports) {
      setReport(null)
      return
    }
    api
      .get<MgmtReport>('/reports/management?days=30')
      .then(setReport)
      .catch(() => setReport(null))
  }, [needsReports])

  function handleRemove(id: WidgetId) {
    setLayout(removeWidget(id, layout))
  }

  function handleAdd(id: WidgetId) {
    setLayout(addWidget(id, layout))
    setPickerOpen(false)
  }

  function handleReset() {
    setLayout(resetLayout())
    setPickerOpen(false)
  }

  function renderWidget(id: WidgetId) {
    const def = catalogById(id)
    if (!def || !data) return null
    const common = { id, title: def.title, openPath: def.openPath, onRemove: handleRemove }

    switch (id) {
      case 'oee_7d':
        return <OeeGauge key={id} block={data.oee_7d} {...common} />
      case 'oee_30d':
        return <OeeGauge key={id} block={data.oee_30d} {...common} />
      case 'downtime_7d':
        return <DowntimeWidget key={id} block={data.downtime_7d} {...common} />
      case 'downtime_30d':
        return <DowntimeWidget key={id} block={data.downtime_30d} {...common} />
      case 'qty_total':
        return (
          <QuantityWidget
            key={id}
            data={data.quantity_30d}
            dataKey="total"
            color="#2f4541"
            {...common}
          />
        )
      case 'qty_scrap':
        return (
          <QuantityWidget
            key={id}
            data={data.quantity_30d}
            dataKey="scrap"
            color="#be123c"
            {...common}
          />
        )
      case 'qty_good':
        return (
          <QuantityWidget
            key={id}
            data={data.quantity_30d}
            dataKey="good"
            color="#0f766e"
            {...common}
          />
        )
      case 'oee_trend':
        return <ReportOeeTrend key={id} report={report} {...common} />
      case 'output_trend':
        return <ReportOutputTrend key={id} report={report} {...common} />
      case 'downtime_pareto':
        return <ReportPareto key={id} report={report} {...common} />
      case 'downtime_by_day':
        return <ReportDowntimeByDay key={id} report={report} {...common} />
      case 'machine_compare':
        return <ReportMachineCompare key={id} report={report} {...common} />
      case 'quality_mix':
        return <ReportQualityMix key={id} report={report} {...common} />
      case 'top_losses':
        return <ReportTopLosses key={id} report={report} {...common} />
      default:
        return null
    }
  }

  return (
    <>
      <div className="topbar">
        <strong>Analysis</strong>
        <span className="topbar-sub">OEE &amp; downtime · quantity trends</span>
        <div className="topbar-meta">
          {data ? (
            <span>
              Updated <b>{new Date(data.generated_at).toLocaleString()}</b>
            </span>
          ) : null}
          <button type="button" className="btn-ghost" onClick={handleReset} title="Reset widget layout">
            Reset layout
          </button>
        </div>
      </div>

      <div className="page analysis-page">
        <div className="analysis-tabs" role="tablist">
          <button type="button" className="active" role="tab" aria-selected>
            OEE &amp; Downtime
          </button>
        </div>

        <p className="page-lead">
          Rolling plant view with a customizable widget board. Use <b>+ Add widget</b> or pin charts from
          Management reports. The ··· menu opens the full report or removes a widget.
        </p>

        {error ? <div className="error">{error}</div> : null}
        {loading && !data ? <div className="demo-banner">Loading analysis…</div> : null}

        {data ? (
          <div className="analysis-grid analysis-grid-board">
            {layout.map((id) => renderWidget(id))}

            <article className="analysis-widget analysis-widget-add">
              <button type="button" className="analysis-add-btn" onClick={() => setPickerOpen(true)}>
                + Add widget
              </button>
              <p className="muted">Choose a built-in view or a Management report chart.</p>
            </article>
          </div>
        ) : null}

        {pickerOpen ? (
          <div className="analysis-picker-backdrop" role="presentation" onClick={() => setPickerOpen(false)}>
            <div
              className="analysis-picker"
              role="dialog"
              aria-label="Add widget"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="analysis-picker-head">
                <h3>Add widget</h3>
                <button type="button" className="btn-ghost" onClick={() => setPickerOpen(false)}>
                  Close
                </button>
              </header>
              {addable.length ? (
                <ul className="analysis-picker-list">
                  {addable.map((w) => (
                    <li key={w.id}>
                      <button type="button" onClick={() => handleAdd(w.id)}>
                        <strong>{w.title}</strong>
                        <span>
                          {w.source === 'reports' ? 'From Reports · ' : 'Built-in · '}
                          {w.description}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted analysis-picker-empty">All widgets are already on the board.</p>
              )}
              <p className="muted analysis-picker-hint">
                Tip: you can also pin charts from the Reports page.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
