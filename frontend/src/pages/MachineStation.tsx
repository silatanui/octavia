import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, formatNum, formatPct } from '../api'
import { useAuth } from '../auth'
import { UserAvatar } from '../components/Wordmark'

type Segment = {
  start_pct: number
  end_pct: number
  state: string
  color: string
  label: string
  needs_reason?: boolean
  started_at?: string
  ended_at?: string
}

type StopCatalog = {
  most_used: string[]
  groups: Array<{
    key: string
    name: string
    color: string
    category_id?: number
    planned_or_unplanned: string
    reasons: string[]
  }>
}

type PendingStop = {
  started_at: string
  ended_at: string
  label: string
  hourLabel: string
}

type SegmentInspect = {
  seg: Segment
  hourLabel: string
  hourActual: number
  hourTarget: number
  signalCount: number
}

type GanttStop = {
  key: string
  hourLabel: string
  label: string
  state: string
  started_at: string
  ended_at: string
  startMs: number
  endMs: number
}

function isStopSegment(seg: Segment) {
  if (seg.needs_reason || seg.label === 'Uncommented') return true
  if (seg.color === 'red') return true
  return seg.state === 'fault' || seg.state === 'unplanned'
}

function segKey(hourLabel: string, seg: Segment) {
  return `${hourLabel}|${seg.started_at || ''}|${seg.ended_at || ''}|${seg.label}`
}

function parsePaceLabel(
  dateStr: string,
  label: string,
  shiftStartMs?: number | null,
  atIso?: string | null,
) {
  if (atIso) {
    const t = new Date(atIso).getTime()
    return Number.isNaN(t) ? null : t
  }
  // label like "16:18" or "16"
  const parts = label.split(':').map(Number)
  const hh = parts[0]
  const mm = parts.length > 1 ? parts[1] : 0
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null
  const d = new Date(`${dateStr}T00:00:00`)
  d.setHours(hh, mm, 0, 0)
  let ts = d.getTime()
  // Overnight shifts: clock times before shift start belong on the next calendar day
  if (shiftStartMs != null && ts < shiftStartMs - 60_000) {
    ts += 24 * 60 * 60 * 1000
  }
  return ts
}

function formatClock(ms: number) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function interpolateAt(
  points: { ts: number; actual: number | null; expected: number | null }[],
  t: number,
): { actual: number | null; expected: number | null } {
  if (!points.length) return { actual: null, expected: null }
  if (t <= points[0].ts) return { actual: points[0].actual, expected: points[0].expected }
  if (t >= points[points.length - 1].ts) {
    const last = points[points.length - 1]
    return { actual: last.actual, expected: last.expected }
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (t < a.ts || t > b.ts) continue
    const u = (t - a.ts) / Math.max(b.ts - a.ts, 1)
    return {
      actual:
        a.actual != null && b.actual != null ? Math.round(lerp(a.actual, b.actual, u)) : a.actual ?? b.actual,
      expected:
        a.expected != null && b.expected != null
          ? Math.round(lerp(a.expected, b.expected, u))
          : a.expected ?? b.expected,
    }
  }
  return { actual: null, expected: null }
}
type HourRow = {
  hour: number
  label: string
  segments: Segment[]
  markers: { pct: number; kind: string; label: string }[]
  cycle_dots: number[]
  actual: number
  target: number
  on_target: boolean
}

type StationBoard = {
  date: string
  live: boolean
  clock: string
  shift_label: string
  demo_mode?: boolean
  sim_note?: string
  plant?: {
    site_name: string
    location: string
    exterior_image?: string
    tagline?: string
  }
  shift?: {
    key: string
    name: string
    start_hour: number
    end_hour: number
    hours: number
    label: string
    start_at?: string
    end_at?: string
    state?: string
    hour_labels?: string[]
    axis_hours?: number[]
    selectable_dates?: { min: string; max: string }
    all?: {
      key: string
      name: string
      start_hour: number
      end_hour: number
      label: string
      state?: string
      available?: boolean
    }[]
  }
  machine: {
    id: number
    machine_code: string
    machine_name: string
    machine_type?: string | null
    line_name?: string | null
    image_url?: string | null
    status: string
  }
  quantity: {
    actual: number
    planned: number
    unit: string
    shift_progress_pct?: number
    hourly_target?: number
    run_rate_per_min?: number
    slow_rate_factor?: number
    ideal_cycle_seconds?: number
  }
  current_batch: {
    order_number?: string | null
    product_code?: string | null
    product_name?: string | null
    product_image?: string | null
    actual_quantity?: number | null
    planned_quantity?: number | null
    progress_pct?: number | null
  } | null
  previous_batches: Array<{
    order_number: string
    product_name?: string | null
    product_code?: string | null
    actual_quantity: number
    planned_quantity: number
    status: string
  }>
  kpis: {
    oee: number | null
    availability: number | null
    performance: number | null
    quality: number | null
    run_time_label: string
  }
  speed_series: { time: string; pcs_per_min: number; oee: number | null }[]
  oee_trend: {
    hour: number
    availability: number | null
    performance: number | null
    quality: number | null
    output: number
  }[]
  output_pace?: {
    label: string
    hour: number
    at?: string
    expected: number
    actual: number | null
    gap: number | null
  }[]
  pace?: {
    expected_now: number
    actual_now: number
    gap: number
    hourly_target: number
    unit: string
  }
  hour_rows: HourRow[]
}

function oeeTone(v: number | null | undefined) {
  if (v == null) return 'muted'
  if (v >= 80) return 'good'
  if (v >= 60) return 'warn'
  return 'bad'
}

export function MachineStation() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [board, setBoard] = useState<StationBoard | null>(null)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(() => new Date())
  const [machineIds, setMachineIds] = useState<number[]>([])
  const [shiftKey, setShiftKey] = useState<string | null>(null)
  const [viewDate, setViewDate] = useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [catalog, setCatalog] = useState<StopCatalog | null>(null)
  const [pendingStop, setPendingStop] = useState<PendingStop | null>(null)
  const [inspect, setInspect] = useState<SegmentInspect | null>(null)
  const [activeGroup, setActiveGroup] = useState<string>('')
  const [selectedReason, setSelectedReason] = useState('')
  const [stopNotes, setStopNotes] = useState('')
  const [stopBusy, setStopBusy] = useState(false)
  const [stopError, setStopError] = useState('')
  const [footNotice, setFootNotice] = useState('')
  const [chartMode, setChartMode] = useState<'pace' | 'speed'>('pace')
  const [mappedStopKey, setMappedStopKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const params = new URLSearchParams()
      if (viewDate) params.set('date', viewDate)
      if (shiftKey) params.set('shift', shiftKey)
      const qs = params.toString() ? `?${params.toString()}` : ''
      const res = await api.get<StationBoard>(`/machines/${id}/station${qs}`)
      setBoard(res)
      setError('')
      // Keep selection valid (e.g. Night disappears until 22:00 on today)
      if (res.shift?.key) {
        const stillValid = !!shiftKey && !!res.shift.all?.some((s) => s.key === shiftKey)
        if (!stillValid) setShiftKey(res.shift.key)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load station')
    }
  }, [id, shiftKey, viewDate])

  useEffect(() => {
    load()
    // Only poll when reviewing today (live / earlier completed shifts)
    const d = new Date()
    const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (viewDate !== localToday) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load, viewDate])

  useEffect(() => {
    api.get<Array<{ id: number }>>('/machines').then((list) => setMachineIds(list.map((m) => m.id)))
    api
      .get<StopCatalog>('/downtime/catalog')
      .then((c) => {
        setCatalog(c)
        if (c.groups[0]) setActiveGroup(c.groups[0].key)
      })
      .catch(() => setCatalog(null))
  }, [])

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!footNotice) return
    const t = setTimeout(() => setFootNotice(''), 3200)
    return () => clearTimeout(t)
  }, [footNotice])

  const qtyPct = useMemo(() => {
    if (!board?.quantity.planned) return 0
    return Math.min((board.quantity.actual / board.quantity.planned) * 100, 100)
  }, [board])

  const activeGroupObj = useMemo(
    () => catalog?.groups.find((g) => g.key === activeGroup) || catalog?.groups[0] || null,
    [catalog, activeGroup],
  )

  const uncommentedCount = useMemo(() => {
    if (!board) return 0
    return board.hour_rows.reduce(
      (n, row) => n + row.segments.filter((s) => s.needs_reason || s.label === 'Uncommented').length,
      0,
    )
  }, [board])

  function goNeighbor(dir: -1 | 1) {
    if (!id || !machineIds.length) return
    const idx = machineIds.indexOf(Number(id))
    if (idx < 0) return
    const next = machineIds[(idx + dir + machineIds.length) % machineIds.length]
    navigate(`/machines/${next}`)
  }

  function openSegmentInspect(seg: Segment, row: HourRow) {
    if (!seg.started_at || !seg.ended_at || seg.state === 'future') return
    const signalCount = row.cycle_dots.filter(
      (pct) => pct >= seg.start_pct && pct <= seg.end_pct,
    ).length
    setInspect({
      seg,
      hourLabel: row.label,
      hourActual: row.actual,
      hourTarget: row.target,
      signalCount,
    })
  }

  function openStopCoder(seg: Segment, hourLabel: string) {
    if (!seg.started_at || !seg.ended_at) return
    setInspect(null)
    setPendingStop({
      started_at: seg.started_at,
      ended_at: seg.ended_at,
      label: seg.label,
      hourLabel,
    })
    setSelectedReason('')
    setStopNotes('')
    setStopError('')
  }

  function openFirstUncommented() {
    if (!board) return
    for (const row of board.hour_rows) {
      const seg = row.segments.find((s) => s.needs_reason || s.label === 'Uncommented')
      if (seg?.started_at && seg.ended_at) {
        openStopCoder(seg, row.label)
        return
      }
    }
    setFootNotice('No uncommented stops on this shift')
  }

  const ganttStops = useMemo((): GanttStop[] => {
    if (!board) return []
    const out: GanttStop[] = []
    for (const row of board.hour_rows) {
      for (const seg of row.segments) {
        if (!seg.started_at || !seg.ended_at) continue
        if (!isStopSegment(seg)) continue
        const startMs = new Date(seg.started_at).getTime()
        const endMs = new Date(seg.ended_at).getTime()
        if (!(endMs > startMs)) continue
        out.push({
          key: segKey(row.label, seg),
          hourLabel: row.label,
          label: seg.label,
          state: seg.state,
          started_at: seg.started_at,
          ended_at: seg.ended_at,
          startMs,
          endMs,
        })
      }
    }
    return out
  }, [board])

  const paceChartData = useMemo(() => {
    if (!board?.output_pace?.length) return []
    const dateStr = board.date
    const shiftStartMs = board.shift?.start_at ? new Date(board.shift.start_at).getTime() : null
    const shiftEndMs = board.shift?.end_at ? new Date(board.shift.end_at).getTime() : null
    const base = board.output_pace
      .map((p) => {
        const ts = parsePaceLabel(dateStr, p.label, shiftStartMs, p.at)
        if (ts == null) return null
        // Keep chart strictly inside the active shift window
        if (shiftStartMs != null && ts < shiftStartMs - 1000) return null
        if (shiftEndMs != null && ts > shiftEndMs + 1000) return null
        return {
          label: p.label,
          hour: p.hour,
          expected: p.expected as number | null,
          actual: p.actual as number | null,
          gap: p.gap as number | null,
          ts,
        }
      })
      .filter((p): p is NonNullable<typeof p> => !!p)
      .sort((a, b) => a.ts - b.ts)

    if (!base.length) return []

    const minTs = shiftStartMs ?? base[0].ts
    const maxTs = Math.min(
      shiftEndMs ?? base[base.length - 1].ts,
      base[base.length - 1].ts,
    )

    const injectTs = new Set<number>()
    for (const stop of ganttStops) {
      if (stop.endMs < minTs || stop.startMs > maxTs) continue
      const a = Math.max(stop.startMs, minTs)
      const b = Math.min(stop.endMs, maxTs)
      injectTs.add(a)
      injectTs.add(b)
      // mid sample keeps short stops visible on sparse hourly pace
      if (b - a > 60_000) injectTs.add(Math.round((a + b) / 2))
    }

    const byTs = new Map(base.map((p) => [p.ts, { ...p }]))
    for (const t of injectTs) {
      if (byTs.has(t)) continue
      const vals = interpolateAt(base, t)
      byTs.set(t, {
        label: formatClock(t),
        hour: new Date(t).getHours(),
        expected: vals.expected,
        actual: vals.actual,
        gap: vals.actual != null && vals.expected != null ? vals.actual - vals.expected : null,
        ts: t,
      })
    }

    const points = [...byTs.values()]
      .sort((a, b) => a.ts - b.ts)
      .map((p) => {
        const stop =
          p.actual == null
            ? undefined
            : ganttStops.find((s) => p.ts >= s.startMs && p.ts <= s.endMs)
        const inStop = !!stop
        return {
          ...p,
          actual_ok: inStop ? null : p.actual,
          actual_stop: inStop ? p.actual : null,
          stop_key: stop?.key ?? null,
          stop_label: stop?.label ?? null,
          stop_state: stop?.state ?? null,
        }
      })

    // Bridge adjacent points so red/green lines meet at transitions
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const cur = points[i]
      if (prev.actual_ok != null && cur.actual_stop != null && prev.actual != null) {
        prev.actual_stop = prev.actual
      }
      if (prev.actual_stop != null && cur.actual_ok != null && cur.actual != null) {
        cur.actual_stop = cur.actual
      }
    }
    return points
  }, [board, ganttStops])

  const paceStopBands = useMemo(() => {
    if (!paceChartData.length || !ganttStops.length) {
      return [] as { x1: string; x2: string; key: string; label: string }[]
    }
    const bands: { x1: string; x2: string; key: string; label: string }[] = []
    for (const stop of ganttStops) {
      const inside = paceChartData.filter(
        (p) => p.ts >= stop.startMs && p.ts <= stop.endMs && p.actual != null,
      )
      if (inside.length >= 2) {
        bands.push({
          x1: inside[0].label,
          x2: inside[inside.length - 1].label,
          key: stop.key,
          label: stop.label,
        })
        continue
      }
      if (inside.length === 1) {
        const idx = paceChartData.findIndex((p) => p.ts === inside[0].ts)
        const left = paceChartData[Math.max(0, idx - 1)]
        const right = paceChartData[Math.min(paceChartData.length - 1, idx + 1)]
        bands.push({ x1: left.label, x2: right.label, key: stop.key, label: stop.label })
      }
    }
    return bands
  }, [paceChartData, ganttStops])

  const speedChartData = useMemo(() => {
    if (!board?.speed_series?.length) return []
    const dateStr = board.date
    const points = board.speed_series.map((p) => {
      const t = parsePaceLabel(dateStr, p.time)
      const stop = t == null ? undefined : ganttStops.find((s) => t >= s.startMs && t <= s.endMs)
      const inStop = !!stop
      return {
        ...p,
        pcs_ok: inStop ? null : p.pcs_per_min,
        pcs_stop: inStop ? p.pcs_per_min : null,
        stop_key: stop?.key ?? null,
        stop_label: stop?.label ?? null,
        ts: t,
      }
    })
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const cur = points[i]
      if (prev.pcs_ok != null && cur.pcs_stop != null) prev.pcs_stop = prev.pcs_per_min
      if (prev.pcs_stop != null && cur.pcs_ok != null) cur.pcs_stop = cur.pcs_per_min
    }
    return points
  }, [board, ganttStops])

  useEffect(() => {
    if (!mappedStopKey) return
    const el = document.querySelector(`[data-seg-key="${CSS.escape(mappedStopKey)}"]`)
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [mappedStopKey])

  const inspectStats = useMemo(() => {
    if (!inspect || !board) return null
    const start = new Date(inspect.seg.started_at!).getTime()
    const end = new Date(inspect.seg.ended_at!).getTime()
    const minutes = Math.max((end - start) / 60000, 0)
    const seconds = Math.max((end - start) / 1000, 0)
    const hourly = board.quantity.hourly_target || board.pace?.hourly_target || 0
    const rate =
      board.quantity.run_rate_per_min ||
      (hourly ? hourly / 60 : 0)
    const slowFactor = board.quantity.slow_rate_factor ?? 0.45
    const unit = board.quantity.unit || 'pcs'
    const state = inspect.seg.state
    let produced = 0
    let expected = rate * minutes
    if (state === 'running') produced = rate * minutes
    else if (state === 'slow') produced = rate * minutes * slowFactor
    else produced = 0
    const loss = Math.max(expected - produced, 0)
    const cycleSec = board.quantity.ideal_cycle_seconds || (rate > 0 ? 60 / rate : 0)
    const cycles = cycleSec > 0 && state === 'running' ? seconds / cycleSec : produced
    return {
      minutes,
      seconds,
      produced: Math.round(produced * 10) / 10,
      expected: Math.round(expected * 10) / 10,
      loss: Math.round(loss * 10) / 10,
      rate: Math.round(rate * 100) / 100,
      slowFactor,
      unit,
      cycles: Math.round(cycles),
      cycleSec: Math.round(cycleSec * 10) / 10,
      pctOfHourTarget: hourly ? Math.round((produced / hourly) * 1000) / 10 : 0,
      isProd: state === 'running' || state === 'slow',
      needsReason: !!(inspect.seg.needs_reason || inspect.seg.label === 'Uncommented'),
    }
  }, [inspect, board])

  async function saveStopReason() {
    if (!pendingStop || !id || !selectedReason) return
    setStopBusy(true)
    setStopError('')
    try {
      await api.post('/downtime/code-stop', {
        machine_id: Number(id),
        started_at: pendingStop.started_at,
        ended_at: pendingStop.ended_at,
        reason: selectedReason,
        category_id: activeGroupObj?.category_id ?? null,
        group_name: activeGroupObj?.name ?? null,
        notes: stopNotes.trim() || null,
      })
      setPendingStop(null)
      setFootNotice(`Stop coded: ${selectedReason}`)
      await load()
    } catch (e) {
      setStopError(e instanceof Error ? e.message : 'Could not save stop reason')
    } finally {
      setStopBusy(false)
    }
  }

  if (error && !board) {
    return (
      <div className="station-board station-light">
        <div className="station-error">{error}</div>
        <Link to="/machines">Back to machines</Link>
      </div>
    )
  }

  if (!board) {
    return <div className="station-board station-light station-loading">Loading station…</div>
  }

  const m = board.machine
  const batch = board.current_batch

  return (
    <div className="station-board station-light">
      <div className="station-topbar">
        <div className="station-topbar-left">
          <div className="topbar-place">
            <Link to="/machines" className="station-back">
              Machines
            </Link>
            <span className="topbar-place-sep" aria-hidden>
              /
            </span>
            <span className="topbar-place-current">Station</span>
          </div>
          <span className="topbar-divider" />
          <button type="button" className="station-arrow" onClick={() => goNeighbor(-1)} aria-label="Previous machine">
            ‹
          </button>
          <div className="topbar-machine">
            <strong>{m.machine_code}</strong>
            <span>{m.machine_name}</span>
          </div>
          <button type="button" className="station-arrow" onClick={() => goNeighbor(1)} aria-label="Next machine">
            ›
          </button>
        </div>
        <div className="station-topbar-right">
          <div className="topbar-meta">
            <span
              className={`live-pill${
                !board.live
                  ? ' off'
                  : /fault|unplanned|stop/i.test(m.status)
                    ? ' issue'
                    : /idle|setup|slow|planned/i.test(m.status)
                      ? ' drip'
                      : ''
              }`}
            >
              {board.live ? 'LIVE' : 'SHIFT'}
            </span>
            <span className="topbar-clock">{clock.toLocaleTimeString()}</span>
          </div>
          <div className="topbar-user">
            <UserAvatar name={user?.name} />
            <div className="topbar-user-text">
              <div className="user-name">{user?.name}</div>
              <div className="user-role">{user?.role_name}</div>
            </div>
            <button type="button" className="btn btn-ghost btn-compact" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      <header className="station-top">
        <div className={`station-left pace-${board.pace && board.pace.gap < 0 ? 'behind' : 'ahead'}`}>
          <div className="station-shift-line">{board.shift_label}</div>
          <div className="station-day-row">
            <label className="station-date-field">
              <span>Day</span>
              <input
                type="date"
                value={viewDate}
                min={board.shift?.selectable_dates?.min}
                max={board.shift?.selectable_dates?.max}
                onChange={(e) => {
                  setViewDate(e.target.value)
                  setShiftKey(null)
                }}
              />
            </label>
            {board.shift?.state ? (
              <span className={`shift-state-pill state-${board.shift.state}`}>{board.shift.state}</span>
            ) : null}
          </div>
          {board.shift?.all?.length ? (
            <div className="shift-switcher" role="tablist" aria-label="Shifts">
              {board.shift.all.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={(shiftKey || board.shift?.key) === s.key}
                  className={`shift-chip state-${s.state || 'done'}${(shiftKey || board.shift?.key) === s.key ? ' active' : ''}`}
                  onClick={() => setShiftKey(s.key)}
                >
                  {s.name}
                  <span>
                    {String(s.start_hour).padStart(2, '0')}–{String(s.end_hour).padStart(2, '0')}
                    {s.state === 'done' ? ' · done' : s.state === 'live' ? ' · live' : ''}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {board.plant ? (
            <div className="station-plant-chip">
              {board.plant.site_name} · {board.plant.location}
            </div>
          ) : null}

          <div className="station-visuals">
            {m.image_url ? (
              <figure className="station-machine-shot">
                <img src={m.image_url} alt={m.machine_name} />
                <figcaption>
                  {m.machine_code} · {m.machine_type || 'Press'}
                </figcaption>
              </figure>
            ) : null}
            {batch?.product_image ? (
              <figure className="station-product-shot">
                <img src={batch.product_image} alt={batch.product_name || 'Product'} />
                <figcaption>{batch.product_name}</figcaption>
              </figure>
            ) : null}
          </div>

          <div className={`station-qty ${qtyPct >= 85 ? 'on-pace' : qtyPct >= 60 ? 'warn-pace' : 'off-pace'}`}>
            <span className="qty-actual">{formatNum(board.quantity.actual)}</span>
            <span className="qty-sep">/</span>
            <span className="qty-plan">{formatNum(board.quantity.planned)}</span>
            <span className="qty-unit">{board.quantity.unit}</span>
          </div>
          <div className={`station-qty-bar tone-${qtyPct >= 85 ? 'good' : qtyPct >= 60 ? 'warn' : 'bad'}`}>
            <span style={{ width: `${qtyPct}%` }} />
          </div>
          {board.quantity.hourly_target != null ? (
            <div className="shift-progress">
              Hourly target {board.quantity.hourly_target} {board.quantity.unit}/h
              {board.quantity.shift_progress_pct != null
                ? ` · Shift elapsed ${board.quantity.shift_progress_pct.toFixed(0)}%`
                : null}
            </div>
          ) : board.quantity.shift_progress_pct != null ? (
            <div className="shift-progress">Shift elapsed {board.quantity.shift_progress_pct.toFixed(0)}%</div>
          ) : null}

          {batch ? (
            <div className="station-batch">
              <div className="batch-current">
                <span className="mono">{batch.order_number}</span> {batch.product_name}
                {batch.progress_pct != null ? (
                  <span className="batch-pct">{batch.progress_pct.toFixed(0)}%</span>
                ) : null}
              </div>
              <div className="batch-bar">
                <span style={{ width: `${Math.min(batch.progress_pct || 0, 100)}%` }} />
              </div>
            </div>
          ) : null}

          <div className="station-prev">
            <div className="prev-label">Previous</div>
            {board.previous_batches.map((b) => {
              const pct = b.planned_quantity
                ? Math.min((b.actual_quantity / b.planned_quantity) * 100, 100)
                : 0
              return (
                <div key={b.order_number} className="prev-row">
                  <div className="prev-row-meta">
                    <span className="mono">{b.product_code || b.order_number}</span>
                    <span>{b.product_name}</span>
                    <span className={b.actual_quantity >= b.planned_quantity ? 'ok' : 'low'}>
                      {formatNum(b.actual_quantity)}
                      <span className="qty-sep">/</span>
                      {formatNum(b.planned_quantity)}
                    </span>
                  </div>
                  <div className={`prev-bar ${b.actual_quantity >= b.planned_quantity ? 'ok' : 'low'}`}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
            {!board.previous_batches.length ? <div className="prev-empty">No prior jobs</div> : null}
          </div>
        </div>

        <div className={`station-center oee-panel ${oeeTone(board.kpis.oee)}`}>
          <div className="oee-kicker">OEE</div>
          <div className={`station-oee ${oeeTone(board.kpis.oee)}`}>{formatPct(board.kpis.oee)}</div>
          <div className="station-runtime">{board.kpis.run_time_label}</div>
          <div className={`station-status-tag status-${(m.status || '').toLowerCase().replace(/\s+/g, '-')}`}>
            {m.status}
          </div>
          <div className="station-apq">
            <div className="apq-row">
              <span className="apq-key">A</span>
              <span className="apq-track"><i style={{ width: `${Math.min(board.kpis.availability ?? 0, 100)}%` }} /></span>
              <span className="apq-val">{formatPct(board.kpis.availability)}</span>
            </div>
            <div className="apq-row">
              <span className="apq-key">P</span>
              <span className="apq-track tone-amber"><i style={{ width: `${Math.min(board.kpis.performance ?? 0, 100)}%` }} /></span>
              <span className="apq-val">{formatPct(board.kpis.performance)}</span>
            </div>
            <div className="apq-row">
              <span className="apq-key">Q</span>
              <span className="apq-track tone-green"><i style={{ width: `${Math.min(board.kpis.quality ?? 0, 100)}%` }} /></span>
              <span className="apq-val">{formatPct(board.kpis.quality)}</span>
            </div>
          </div>
        </div>

        <div className={`station-charts ${(board.pace?.gap ?? 0) < 0 ? 'pace-behind' : 'pace-ahead'}`}>
          <div className="station-chart-box pace-chart">
            <div className="chart-title-row">
              <div className="chart-mode-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  className={chartMode === 'pace' ? 'active' : ''}
                  aria-selected={chartMode === 'pace'}
                  onClick={() => {
                    setChartMode('pace')
                    setMappedStopKey(null)
                  }}
                >
                  Target vs actual
                </button>
                <button
                  type="button"
                  role="tab"
                  className={chartMode === 'speed' ? 'active' : ''}
                  aria-selected={chartMode === 'speed'}
                  onClick={() => {
                    setChartMode('speed')
                    setMappedStopKey(null)
                  }}
                >
                  Speed
                </button>
              </div>
              {chartMode === 'pace' && board.pace ? (
                <div className={`pace-badge ${board.pace.gap >= 0 ? 'ahead' : 'behind'}`}>
                  {board.pace.gap >= 0 ? '+' : ''}
                  {board.pace.gap} {board.pace.unit} vs plan
                  <span>
                    · now {board.pace.actual_now}/{board.pace.expected_now}
                  </span>
                </div>
              ) : null}
              {chartMode === 'speed' ? (
                <div className="pace-badge ahead">OEE {formatPct(board.kpis.oee)}</div>
              ) : null}
            </div>
            <div className="chart-body chart-body-pace">
              <ResponsiveContainer width="100%" height="100%">
                {chartMode === 'pace' ? (
                  <ComposedChart
                    data={paceChartData}
                    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                    onMouseMove={(state) => {
                      const row = (state as { activePayload?: Array<{ payload?: { stop_key?: string | null } }> })
                        ?.activePayload?.[0]?.payload
                      setMappedStopKey(row?.stop_key || null)
                    }}
                    onMouseLeave={() => setMappedStopKey(null)}
                  >
                    <CartesianGrid stroke="#e8efe9" strokeDasharray="2 2" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#64748b', fontSize: 9 }}
                      tickMargin={4}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} width={32} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #cfe0d4', fontSize: 11 }}
                      formatter={(value, name) => {
                        if (value == null) return ['—', String(name)]
                        return [String(value), String(name)]
                      }}
                      labelFormatter={(label, payload) => {
                        const stopLabel = payload?.[0]?.payload?.stop_label
                        return stopLabel ? `${label} · ${stopLabel}` : String(label)
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="plainline"
                      wrapperStyle={{ fontSize: 10, paddingBottom: 2 }}
                    />
                    {paceStopBands.map((band) => (
                      <ReferenceArea
                        key={band.key}
                        x1={band.x1}
                        x2={band.x2}
                        fill={mappedStopKey === band.key ? '#fecaca' : '#fee2e2'}
                        fillOpacity={mappedStopKey === band.key ? 0.85 : 0.55}
                        stroke={mappedStopKey === band.key ? '#b91c1c' : 'none'}
                        strokeOpacity={0.7}
                        ifOverflow="visible"
                      />
                    ))}
                    <Line
                      type="monotone"
                      dataKey="expected"
                      name="Expected"
                      stroke="#94a3b8"
                      strokeWidth={1.6}
                      strokeDasharray="5 4"
                      dot={false}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="actual_ok"
                      name="Actual"
                      stroke="#0f766e"
                      strokeWidth={2.2}
                      dot={false}
                      activeDot={{ r: 4, fill: '#0f766e' }}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="actual_stop"
                      name="Stop"
                      stroke="#b91c1c"
                      strokeWidth={2.6}
                      dot={false}
                      activeDot={{ r: 5, fill: '#b91c1c' }}
                      connectNulls={false}
                    />
                  </ComposedChart>
                ) : (
                  <ComposedChart
                    data={speedChartData}
                    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                    onMouseMove={(state) => {
                      const row = (state as { activePayload?: Array<{ payload?: { stop_key?: string | null } }> })
                        ?.activePayload?.[0]?.payload
                      setMappedStopKey(row?.stop_key || null)
                    }}
                    onMouseLeave={() => setMappedStopKey(null)}
                  >
                    <CartesianGrid stroke="#e8efe9" strokeDasharray="2 2" vertical={false} />
                    <XAxis
                      dataKey="time"
                      tick={{ fill: '#64748b', fontSize: 9 }}
                      tickMargin={4}
                      interval="preserveStartEnd"
                      minTickGap={28}
                    />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} width={32} allowDecimals />
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #cfe0d4', fontSize: 11 }}
                      formatter={(value, name) => {
                        if (value == null) return ['—', String(name)]
                        return [String(value), String(name)]
                      }}
                      labelFormatter={(label, payload) => {
                        const stopLabel = payload?.[0]?.payload?.stop_label
                        return stopLabel ? `${label} · ${stopLabel}` : String(label)
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="plainline"
                      wrapperStyle={{ fontSize: 10, paddingBottom: 2 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="pcs_ok"
                      name="pcs/min"
                      stroke="#0f766e"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="pcs_stop"
                      name="Stop"
                      stroke="#b91c1c"
                      strokeWidth={2.4}
                      dot={false}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="oee"
                      name="OEE"
                      stroke="#64748b"
                      strokeWidth={1.4}
                      strokeDasharray="4 3"
                      dot={false}
                      connectNulls
                    />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </header>

      <section className="station-timeline">
        <div className="timeline-head">
          <div className="timeline-title">
            Hourly timeline · left-click performance · right-click code stop
          </div>
          <div className="timeline-legend" aria-label="Status legend">
            <span className="leg leg-run">Running</span>
            <span className="leg leg-amber">Slow / micro-stop</span>
            <span className="leg leg-red">Stop / fault</span>
            <span className="leg leg-uncommented">Uncommented</span>
            <span className="leg leg-break">Break (10–30m)</span>
            <span className="leg leg-planned">Start / end (~10m)</span>
            <span className="leg leg-future">Upcoming</span>
          </div>
          {uncommentedCount > 0 ? (
            <button type="button" className="uncommented-chip" onClick={openFirstUncommented}>
              {uncommentedCount} uncommented · add reason
            </button>
          ) : null}
        </div>
        <div className="timeline-minute-scale">
          <span className="scale-spacer" />
          <div className="scale-marks">
            {Array.from({ length: 13 }, (_, i) => (
              <span key={i}>{String(i * 5).padStart(2, '0')}</span>
            ))}
          </div>
          <span className="scale-spacer end" />
        </div>
        {board.hour_rows.map((row, rowIdx) => {
          const isFutureHour = row.segments.length === 1 && row.segments[0]?.state === 'future'
          const eventMarkers = row.markers.filter((mk) => mk.kind === 'tool' || mk.kind === 'alert')
          const actualInt = Math.round(row.actual)
          const targetInt = Math.round(row.target)
          return (
            <div
              className={`hour-row${rowIdx % 2 === 0 ? ' hour-row--alt' : ''}${isFutureHour ? ' is-future' : ''}`}
              key={row.hour}
            >
              <div className="hour-label">{row.label}</div>
              <div className="hour-track-wrap">
                <div className="hour-event-rail">
                  {eventMarkers.map((mk, i) => (
                    <button
                      type="button"
                      key={`m-${row.hour}-${i}`}
                      className={`hour-pin kind-${mk.kind}`}
                      style={{ left: `${mk.pct}%` }}
                      title={mk.label}
                      aria-label={mk.label}
                    />
                  ))}
                </div>
                <div className="hour-track">
                  <div className="hour-grid" aria-hidden />
                  {row.segments.map((s, i) => {
                    // +0.12% closes hairline gaps between abutting abs-positioned segments
                    const width = Math.max(s.end_pct - s.start_pct, 0.35) + 0.12
                    const needsReason = !!(s.needs_reason || s.label === 'Uncommented')
                    const clickable = s.state !== 'future' && !!s.started_at && !!s.ended_at
                    const mapped = mappedStopKey === segKey(row.label, s)
                    const showLabel =
                      width > 7 &&
                      s.state !== 'running' &&
                      s.state !== 'slow' &&
                      (s.state !== 'idle' || needsReason)
                    const codeable =
                      needsReason ||
                      s.color === 'red' ||
                      ['fault', 'unplanned', 'idle', 'setup', 'planned'].includes(s.state)
                    const title = needsReason
                      ? `${s.label} — left-click details · right-click add stop reason`
                      : codeable
                        ? `${s.label} — left-click performance · right-click code stop`
                        : clickable
                          ? `${s.label} — left-click for section performance`
                          : s.label
                    const className = `hour-seg color-${s.color} state-${s.state}${needsReason ? ' needs-reason' : ''}${clickable ? ' is-clickable' : ''}${codeable ? ' is-codeable' : ''}${mapped ? ' is-mapped' : ''}`
                    const style = { left: `${s.start_pct}%`, width: `${width}%` }
                    if (clickable) {
                      return (
                        <button
                          key={`${row.hour}-${i}`}
                          type="button"
                          className={className}
                          title={title}
                          style={style}
                          data-seg-key={segKey(row.label, s)}
                          onClick={() => openSegmentInspect(s, row)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (codeable) openStopCoder(s, row.label)
                            else openSegmentInspect(s, row)
                          }}
                        >
                          {showLabel ? <em>{s.label}</em> : null}
                        </button>
                      )
                    }
                    return (
                      <div
                        key={`${row.hour}-${i}`}
                        className={className}
                        title={title}
                        style={style}
                        data-seg-key={segKey(row.label, s)}
                      >
                        {showLabel ? <em>{s.label}</em> : null}
                      </div>
                    )
                  })}
                  {!isFutureHour ? (
                    <div className="hour-cycles" aria-hidden>
                      {row.cycle_dots.map((pct, i) => (
                        <i key={`d-${row.hour}-${i}`} style={{ left: `${pct}%` }} />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className={`hour-qty ${row.on_target ? 'ok' : 'low'}${isFutureHour ? ' pending' : ''}`}>
                {isFutureHour ? (
                  <span className="qty-pending">—</span>
                ) : (
                  <>
                    <strong>{actualInt}</strong>
                    <span className="qty-sep">/</span>
                    <span className="qty-target">{targetInt}</span>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </section>

      <footer className="station-foot">
        <div className="station-foot-ops">
          <span className="foot-operator">{user?.name || 'Operator'}</span>
          <button
            type="button"
            className="foot-action"
            onClick={() => setFootNotice('Product changeover logged for this station')}
          >
            Product changeover
          </button>
          <button
            type="button"
            className="foot-action"
            onClick={openFirstUncommented}
          >
            Stop reason
            {uncommentedCount > 0 ? <span className="foot-badge">{uncommentedCount}</span> : null}
          </button>
          <Link to="/quality" className="foot-action">
            Scrap
          </Link>
          <button
            type="button"
            className="foot-action"
            onClick={() => setFootNotice('Checklists: shift start / mould / safety')}
          >
            Checklists
          </button>
          <Link to="/reports" className="foot-action">
            Downtime report
          </Link>
        </div>
        <span className="muted foot-meta">
          {board.shift?.label || '8-hour shifts'} · {m.line_name || 'line'}
        </span>
        {footNotice ? <span className="foot-notice">{footNotice}</span> : null}
        <button type="button" className="station-refresh" onClick={load}>
          Refresh
        </button>
      </footer>

      {inspect && inspectStats ? (
        <div className="stop-modal-backdrop" role="presentation" onClick={() => setInspect(null)}>
          <div
            className={`seg-inspect state-${inspect.seg.state}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="seg-inspect-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="seg-inspect-head">
              <div>
                <h2 id="seg-inspect-title">{inspect.seg.label}</h2>
                <p>
                  Hour {inspect.hourLabel}
                  {' · '}
                  {new Date(inspect.seg.started_at!).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                  {' – '}
                  {new Date(inspect.seg.ended_at!).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </p>
              </div>
              <span className={`seg-inspect-state state-${inspect.seg.state}`}>
                {inspect.seg.state}
              </span>
            </header>

            <div className="seg-inspect-grid">
              <div className="seg-stat">
                <span>Duration</span>
                <strong>
                  {inspectStats.minutes < 1
                    ? `${Math.round(inspectStats.seconds)}s`
                    : `${Math.floor(inspectStats.minutes)}m ${Math.round((inspectStats.minutes % 1) * 60)}s`}
                </strong>
              </div>
              <div className="seg-stat">
                <span>{inspectStats.isProd ? 'Produced' : 'Output lost'}</span>
                <strong>
                  {inspectStats.isProd
                    ? formatNum(inspectStats.produced)
                    : formatNum(inspectStats.loss)}{' '}
                  {inspectStats.unit}
                </strong>
              </div>
              <div className="seg-stat">
                <span>Expected at target rate</span>
                <strong>
                  {formatNum(inspectStats.expected)} {inspectStats.unit}
                </strong>
              </div>
              <div className="seg-stat">
                <span>Rate</span>
                <strong>
                  {inspectStats.rate} {inspectStats.unit}/min
                  {inspect.seg.state === 'slow' ? ` · ×${inspectStats.slowFactor}` : ''}
                </strong>
              </div>
              <div className="seg-stat">
                <span>Ideal cycle</span>
                <strong>{inspectStats.cycleSec ? `${inspectStats.cycleSec}s` : '—'}</strong>
              </div>
              <div className="seg-stat">
                <span>{inspectStats.isProd ? 'Est. cycles' : 'Signals in slice'}</span>
                <strong>
                  {inspectStats.isProd ? formatNum(inspectStats.cycles) : inspect.signalCount}
                </strong>
              </div>
              <div className="seg-stat">
                <span>Share of hour target</span>
                <strong>{inspectStats.pctOfHourTarget}%</strong>
              </div>
              <div className="seg-stat">
                <span>Hour total</span>
                <strong>
                  {Math.round(inspect.hourActual)} / {Math.round(inspect.hourTarget)}{' '}
                  {inspectStats.unit}
                </strong>
              </div>
            </div>

            {board.current_batch ? (
              <div className="seg-inspect-product">
                {board.current_batch.product_image ? (
                  <img src={board.current_batch.product_image} alt="" />
                ) : null}
                <div>
                  <strong>{board.current_batch.product_name}</strong>
                  <span className="mono">{board.current_batch.product_code}</span>
                  <span>{board.current_batch.order_number}</span>
                </div>
              </div>
            ) : null}

            <p className="seg-inspect-note">
              {inspectStats.isProd
                ? 'Green / amber slices estimate pieces from run time × catalog rate for this Tanui product.'
                : 'Stop slices produce 0 pcs; loss is what target rate would have made in this window.'}
            </p>

            <footer className="stop-modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setInspect(null)}>
                Close
              </button>
              {inspectStats.needsReason ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openStopCoder(inspect.seg, inspect.hourLabel)}
                >
                  Add stop reason
                </button>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}

      {pendingStop ? (
        <div className="stop-modal-backdrop" role="presentation" onClick={() => setPendingStop(null)}>
          <div
            className="stop-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stop-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="stop-modal-head">
              <h2 id="stop-modal-title">
                Uncommented · hour {pendingStop.hourLabel}
              </h2>
              <p>
                {new Date(pendingStop.started_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {' – '}
                {new Date(pendingStop.ended_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </header>

            {catalog?.most_used?.length ? (
              <div className="stop-most-used">
                <div className="stop-section-label">Most used</div>
                <div className="stop-chip-row">
                  {catalog.most_used.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`stop-chip${selectedReason === r ? ' active' : ''}`}
                      onClick={() => {
                        setSelectedReason(r)
                        const g = catalog.groups.find((x) => x.reasons.includes(r))
                        if (g) setActiveGroup(g.key)
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="stop-columns">
              <div className="stop-col">
                <div className="stop-section-label">Groups</div>
                <ul>
                  {(catalog?.groups || []).map((g) => (
                    <li key={g.key}>
                      <button
                        type="button"
                        className={activeGroup === g.key ? 'active' : ''}
                        onClick={() => setActiveGroup(g.key)}
                      >
                        <i style={{ background: g.color }} />
                        {g.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="stop-col stop-col-reasons">
                <div className="stop-section-label">Reasons</div>
                <ul>
                  {(activeGroupObj?.reasons || []).map((r) => (
                    <li key={r}>
                      <button
                        type="button"
                        className={selectedReason === r ? 'active' : ''}
                        onClick={() => setSelectedReason(r)}
                      >
                        {r}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <label className="stop-notes">
              <span>Note (optional)</span>
              <textarea
                maxLength={500}
                value={stopNotes}
                onChange={(e) => setStopNotes(e.target.value)}
                placeholder="Extra detail for this stop…"
              />
              <em>{stopNotes.length}/500</em>
            </label>

            {stopError ? <div className="stop-error">{stopError}</div> : null}

            <footer className="stop-modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setPendingStop(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!selectedReason || stopBusy}
                onClick={saveStopReason}
              >
                {stopBusy ? 'Saving…' : 'Save reason'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  )
}
