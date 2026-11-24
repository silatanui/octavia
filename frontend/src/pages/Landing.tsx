import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { Wordmark } from '../components/Wordmark'
import '../landing.css'

type SegState = 'run' | 'slow' | 'stop' | 'future' | 'break'
type Seg = [SegState, number]

function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!('IntersectionObserver' in window)) {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.12 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`lp-reveal${shown ? ' is-in' : ''} ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

function SectionHead({
  eyebrow,
  title,
  lead,
  center = false,
  dark = false,
}: {
  eyebrow?: string
  title: string
  lead?: string
  center?: boolean
  dark?: boolean
}) {
  return (
    <div className={`lp-head${center ? ' is-center' : ''}${dark ? ' on-dark' : ''}`}>
      {eyebrow ? <span className="lp-eyebrow">{eyebrow}</span> : null}
      <h2>{title}</h2>
      {lead ? <p>{lead}</p> : null}
    </div>
  )
}

/** Single decorative capsule ribbon — used once on the homepage hero. */
function Ribbon({ row }: { row: [SegState, number][] }) {
  const loop = [...row, ...row]
  return (
    <div className="lp-ribbon" aria-hidden>
      <div className="lp-ribbon-row">
        <div className="lp-ribbon-run">
          {loop.map(([state, w], i) => (
            <i key={i} className={`lp-seg lp-seg-${state}`} style={{ width: w }} />
          ))}
        </div>
      </div>
    </div>
  )
}

function MiniTimeline({
  rows,
  nowRow,
  nowPct = 0,
}: {
  rows: { label: string; segs: Seg[]; qty?: [number, number] }[]
  nowRow?: number
  nowPct?: number
}) {
  return (
    <div className="lp-tl">
      <div className="lp-tl-scale">
        <span />
        <div>
          {[0, 15, 30, 45, 60].map((m) => (
            <span key={m}>{String(m).padStart(2, '0')}</span>
          ))}
        </div>
        <span className="lp-tl-qty-head">Parts / Target</span>
      </div>
      {rows.map((row, i) => {
        const ok = row.qty ? row.qty[0] >= row.qty[1] * 0.92 : true
        const pct = row.qty ? Math.min((row.qty[0] / row.qty[1]) * 100, 100) : 0
        return (
          <div className="lp-tl-row" key={row.label}>
            <span className="lp-tl-hour">{row.label}</span>
            <div className="lp-tl-track">
              {row.segs.map(([state, w], j) => (
                <i key={j} className={`lp-seg lp-seg-${state}`} style={{ width: `${w}%` }} />
              ))}
              {nowRow === i ? (
                <span className="lp-now" style={{ left: `${nowPct}%` }}>
                  <b>NOW</b>
                </span>
              ) : null}
            </div>
            <span className={`lp-tl-qty ${row.qty ? (ok ? 'ok' : 'low') : 'pending'}`}>
              {row.qty ? (
                <>
                  <span className="lp-tl-nums">
                    <strong>{row.qty[0]}</strong>
                    <em>/ {row.qty[1]}</em>
                  </span>
                  <span className="lp-tl-bar">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                </>
              ) : (
                '—'
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const HERO_ROWS = [
  { label: '08', segs: [['run', 38], ['slow', 6], ['run', 30], ['stop', 10], ['run', 16]] as Seg[], qty: [41, 48] as [number, number] },
  { label: '09', segs: [['run', 58], ['stop', 7], ['run', 35]] as Seg[], qty: [46, 48] as [number, number] },
  { label: '10', segs: [['run', 24], ['slow', 8], ['run', 36], ['stop', 12], ['run', 20]] as Seg[], qty: [34, 48] as [number, number] },
  { label: '11', segs: [['run', 44], ['slow', 5], ['run', 15], ['future', 36]] as Seg[], qty: [28, 48] as [number, number] },
  { label: '12', segs: [['future', 100]] as Seg[] },
]

const HERO_RIBBON: [SegState, number][] = [
  ['run', 150], ['slow', 36], ['run', 90], ['stop', 28], ['run', 180], ['break', 40], ['run', 120], ['slow', 24],
  ['run', 200], ['stop', 20], ['run', 110],
]

const MACHINE_ROWS = [
  { code: 'IMM-01', name: 'Engel Duo 700', status: 'run', oee: '78.4%', parts: '522', segs: [['run', 52], ['slow', 6], ['run', 28], ['stop', 6], ['future', 8]] as Seg[] },
  { code: 'IMM-02', name: 'Engel Victory 500', status: 'run', oee: '71.2%', parts: '389', segs: [['run', 40], ['stop', 8], ['run', 44], ['future', 8]] as Seg[] },
  { code: 'IMM-03', name: 'KraussMaffei CX 350', status: 'drip', oee: '66.9%', parts: '1,070', segs: [['run', 30], ['slow', 14], ['run', 40], ['slow', 8], ['future', 8]] as Seg[] },
  { code: 'IMM-06', name: 'Engel Victory 280', status: 'issue', oee: '41.5%', parts: '1,006', segs: [['run', 46], ['stop', 24], ['run', 22], ['future', 8]] as Seg[] },
]

const STAGES = [
  {
    id: 'plan',
    n: '01',
    label: 'Plan',
    title: 'From shift targets to a day you can trust',
    copy: 'Shifts, breaks and start-up windows are part of the plan. Octavia builds a fair expected pace from productive time, so a coffee break never counts as a miss.',
    points: ['Day, Afternoon and Night structures', 'Breaks and start / end windows excluded', 'Targets clamped to the active shift'],
  },
  {
    id: 'run',
    n: '02',
    label: 'Run',
    title: 'The whole hour on one line',
    copy: 'Green running, orange slow, red stop. Every hour is a row, every state is a segment, and a live NOW marker shows exactly where the shift is.',
    points: ['Hourly timeline with live NOW marker', 'Hover any block for range, reason and who logged it', 'Parts against target per hour'],
  },
  {
    id: 'stop',
    n: '03',
    label: 'Stop',
    title: 'Every stop gets a reason, not a shrug',
    copy: 'Right-click a red block, pick a reason from the stop catalog and move on. Uncommented stops stay visible until someone codes them.',
    points: ['Grouped stop catalog', 'Uncommented chip pulls you to the next gap', 'Codes feed Pareto and OEE instantly'],
  },
  {
    id: 'review',
    n: '04',
    label: 'Review',
    title: 'Target against actual, on a true time axis',
    copy: 'A linear time chart plots expected output against actual, flattening only where breaks are scheduled. Behind or ahead is obvious at a glance.',
    points: ['Linear shift time axis', '15 minute output pace grid', 'Availability, performance and quality'],
  },
  {
    id: 'improve',
    n: '05',
    label: 'Improve',
    title: 'An AI that only reads what was recorded',
    copy: 'Octavia AI summarises the shift, flags machines with no output and recommends the next action. It never invents a root cause the data cannot support.',
    points: ['Issues, highlights, standards and recommendations', 'Ask questions about OEE, scrap and downtime', 'Reports with filters you control'],
  },
] as const

function StageMock({ id }: { id: (typeof STAGES)[number]['id'] }) {
  if (id === 'plan') {
    const items = [
      ['06:00', 'Start-up', '10 min', 'planned'],
      ['06:10', 'Production block', '3 h 50 min', 'run'],
      ['10:00', 'Break', '20 min', 'break'],
      ['10:20', 'Production block', '3 h 30 min', 'run'],
      ['13:50', 'Wind-down', '10 min', 'planned'],
    ]
    return (
      <div className="lp-mock lp-mock-plan">
        <div className="lp-mock-bar">
          <strong>Day shift</strong>
          <span>06:00 to 14:00</span>
        </div>
        <ul>
          {items.map(([t, label, dur, kind]) => (
            <li key={t + label}>
              <time>{t}</time>
              <i className={`lp-dot lp-dot-${kind}`} />
              <span>{label}</span>
              <em>{dur}</em>
            </li>
          ))}
        </ul>
        <div className="lp-mock-foot">Net planned production: 7 h 20 min</div>
      </div>
    )
  }
  if (id === 'run') {
    return (
      <div className="lp-mock">
        <div className="lp-mock-bar">
          <strong>IMM-04 · Engel Duo 1100</strong>
          <span className="lp-badge lp-badge-run">
            <i /> RUNNING
          </span>
        </div>
        <MiniTimeline rows={HERO_ROWS.slice(0, 4)} nowRow={3} nowPct={64} />
      </div>
    )
  }
  if (id === 'stop') {
    return (
      <div className="lp-mock">
        <div className="lp-mock-bar">
          <strong>Code stop</strong>
          <span>09:12 to 09:24 · 12 min</span>
        </div>
        <div className="lp-stop-groups">
          {[
            ['Technical', ['Heater fault', 'Hydraulic issue', 'Machine reset']],
            ['Setup', ['Mould change', 'Colour changeover']],
            ['Material', ['Material shortage', 'Resin change']],
          ].map(([group, reasons]) => (
            <div key={group as string}>
              <span>{group as string}</span>
              <div>
                {(reasons as string[]).map((r) => (
                  <b key={r} className={r === 'Hydraulic issue' ? 'is-picked' : ''}>
                    {r}
                  </b>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="lp-mock-foot">Saved as Hydraulic issue · Logged by Alex Admin</div>
      </div>
    )
  }
  if (id === 'review') {
    return (
      <div className="lp-mock">
        <div className="lp-mock-bar">
          <strong>Target vs Actual</strong>
          <span className="lp-pace">Ahead of pace</span>
        </div>
        <svg className="lp-chart" viewBox="0 0 360 150" role="img" aria-label="Expected versus actual output">
          <defs>
            <linearGradient id="lpArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c45c26" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#c45c26" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[30, 60, 90, 120].map((y) => (
            <line key={y} x1="0" x2="360" y1={y} y2={y} stroke="#e3e9e6" strokeWidth="1" />
          ))}
          <path d="M0 140 L96 96 L130 96 L270 40 L360 22" fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 4" />
          <path d="M0 140 L48 118 L96 92 L130 90 L190 62 L240 52 L290 30 L290 150 L0 150 Z" fill="url(#lpArea)" stroke="none" />
          <path d="M0 140 L48 118 L96 92 L130 90 L190 62 L240 52 L290 30" fill="none" stroke="#c45c26" strokeWidth="2.5" strokeLinejoin="round" />
          <circle cx="290" cy="30" r="4.5" fill="#c45c26" />
        </svg>
        <div className="lp-legend">
          <span><i className="a" /> Actual</span>
          <span><i className="e" /> Expected</span>
        </div>
      </div>
    )
  }
  return (
    <div className="lp-mock lp-mock-ai">
      <div className="lp-mock-bar">
        <strong>AI Summary</strong>
        <span>Recorded data only</span>
      </div>
      <p className="lp-ai-line">
        Plant OEE is 71.4% with availability at 97.0%. Parts goal is 84% of target, up 10pp on the prior day.
      </p>
      <div className="lp-ai-tags">
        <b className="red">Issues 3</b>
        <b className="teal">Highlights 5</b>
        <b>Standards 5</b>
        <b className="amber">Next steps 4</b>
      </div>
      <div className="lp-ai-card">
        <i aria-hidden />
        <div>
          <strong>IMM-06 in Fault state</strong>
          <span>Recorded stop reason: Drive fault. Recommend maintenance check before next shift.</span>
        </div>
      </div>
    </div>
  )
}

const FLOORS: { title: string; copy: string; chips: string[]; icon: string }[] = [
  {
    title: 'Injection moulding',
    copy: 'Cycle time against target, mould changes and scrap purges tracked per press.',
    chips: ['Cycle time', 'Mould life', 'Scrap'],
    icon: 'fa-industry',
  },
  {
    title: 'Assembly cells',
    copy: 'Starved and blocked states stay visible so upstream waits never hide inside OEE.',
    chips: ['Waiting for work', 'Takt', 'Quality'],
    icon: 'fa-screwdriver-wrench',
  },
  {
    title: 'Packaging',
    copy: 'Changeovers, colour swaps and material shortages coded and ranked every week.',
    chips: ['Changeover', 'Material', 'Pareto'],
    icon: 'fa-box',
  },
  {
    title: 'Machining',
    copy: 'Tool changes and planned maintenance separated from true unplanned downtime.',
    chips: ['Tool change', 'PM', 'Availability'],
    icon: 'fa-gears',
  },
]

export function Landing() {
  const { user } = useAuth()
  const [stage, setStage] = useState<(typeof STAGES)[number]['id']>('run')
  const active = STAGES.find((s) => s.id === stage) ?? STAGES[1]
  const primaryHref = user ? '/' : '/login'
  const primaryLabel = user ? 'Open Octavia' : 'Open the live demo'

  return (
    <div className="lp">
      <div className="lp-top lp-dark">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link to="/home" className="lp-brand" aria-label="Octavia home">
            <Wordmark size="md" tone="light" />
          </Link>
          <nav className="lp-links" aria-label="Sections">
            <a href="#platform">Platform</a>
            <a href="#results">Results</a>
            <a href="#workflow">Workflow</a>
            <a href="#floors">Floors</a>
          </nav>
          <div className="lp-nav-cta">
            {!user ? (
              <Link to="/login" className="lp-btn lp-btn-ghost">
                Log in
              </Link>
            ) : null}
            <Link to={primaryHref} className="lp-btn lp-btn-solid">
              {user ? 'Open Octavia' : 'Get started'}
            </Link>
          </div>
        </div>
      </header>

        <section className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <span className="lp-pill">
                <i /> Live production monitoring
              </span>
              <h1>
                Your shop floor shouldn't wait for the <span className="lp-hl">end-of-shift report.</span>
              </h1>
              <p>
                Octavia turns every machine into a live hourly timeline with stop reasons, OEE and an AI that explains
                the shift, so supervisors fix losses while they are still happening.
              </p>
              <div className="lp-hero-actions">
                <Link to={primaryHref} className="lp-btn lp-btn-solid lp-btn-lg">
                  {primaryLabel}
                </Link>
                <a href="#workflow" className="lp-btn lp-btn-light lp-btn-lg">
                  See how it works
                </a>
              </div>
              <ul className="lp-hero-facts">
                <li><strong>5s</strong> live refresh</li>
                <li><strong>3</strong> shifts, one view</li>
                <li><strong>A × P × Q</strong> OEE from recorded data</li>
              </ul>
            </div>

            <Reveal className="lp-hero-visual" delay={120}>
              <div className="lp-window">
                <div className="lp-window-bar">
                  <span /><span /><span />
                  <em>octavia.tanuisila.dev / machines / IMM-04</em>
                </div>
                <div className="lp-station-head">
                  <div>
                    <strong>Injection Molder #04</strong>
                    <span>Part: Housing-B12 · Target cycle 75s</span>
                  </div>
                  <span className="lp-badge lp-badge-run">
                    <i /> RUNNING
                  </span>
                </div>
                <div className="lp-kpis">
                  <div><span>Availability</span><strong>94.2%</strong></div>
                  <div><span>OEE</span><strong>78.4%</strong></div>
                  <div><span>Parts</span><strong>177<em> / 240</em></strong></div>
                </div>
                <MiniTimeline rows={HERO_ROWS} nowRow={3} nowPct={64} />
              </div>
            </Reveal>
          </div>

          <Ribbon row={HERO_RIBBON} />

          <div className="lp-wrap lp-built">
            <span>Built for every kind of line</span>
            <ul>
              {['Injection moulding', 'Assembly cells', 'Packaging', 'Machining', 'Extrusion', 'Finishing'].map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <main>
        <section className="lp-section lp-statement">
          <div className="lp-wrap">
            <Reveal>
              <h2>
                The first production monitor that scales with your floor, not your clipboards.
              </h2>
            </Reveal>
          </div>
        </section>

        <section className="lp-section lp-section-tint" id="platform">
          <div className="lp-wrap">
            <Reveal>
              <SectionHead
                eyebrow="Platform"
                title="A live floor and the platform it runs on"
                lead="A dashboard shows you a number. A production system needs more: a control layer to run the shift, context to explain every stop and a foundation you can trust."
              />
            </Reveal>

            <div className="lp-cards-3">
              {(
                [
                  ['fa-table-columns', 'Station Board', 'Operators and supervisors run the shift from one screen. Left-click for performance, right-click to code a stop.', 'Control layer'],
                  ['fa-layer-group', 'Stop Context', 'Octavia builds a living record of why machines stop, so every reason is coded once and reused in every report.', 'Knowledge layer'],
                  ['fa-gauge-high', 'KPI Foundation', 'Availability, performance, quality and OEE are calculated from recorded counts and downtime, never typed in.', 'Execution layer'],
                ] as const
              ).map(([icon, t, c, tag], i) => (
                <Reveal key={t} delay={i * 80}>
                  <article className="lp-card">
                    <span className="lp-card-icon">
                      <i className={`fa-solid ${icon}`} aria-hidden />
                    </span>
                    <span className="lp-card-tag">{tag}</span>
                    <h3>{t}</h3>
                    <p>{c}</p>
                  </article>
                </Reveal>
              ))}
            </div>

            <Reveal>
              <div className="lp-arch" aria-label="Octavia architecture">
                <div className="lp-arch-col">
                  <span className="lp-arch-title">Floor signals</span>
                  {['Machine status', 'Cycle counts', 'Operator input', 'Work orders'].map((t) => (
                    <b key={t}>{t}</b>
                  ))}
                </div>
                <div className="lp-arch-link" aria-hidden>
                  <i /><i /><i />
                </div>
                <div className="lp-arch-core">
                  <span className="lp-arch-title">Octavia</span>
                  <div className="lp-arch-layer">
                    <strong>Station Board</strong>
                    <em>Prioritise · Monitor · Code stops</em>
                  </div>
                  <div className="lp-arch-layer">
                    <strong>Stop Context</strong>
                    <em>Reasons · Shifts · Standards</em>
                  </div>
                  <div className="lp-arch-layer is-base">
                    <strong>KPI Foundation</strong>
                    <em>Availability · Performance · Quality · OEE</em>
                  </div>
                </div>
                <div className="lp-arch-link" aria-hidden>
                  <i /><i /><i />
                </div>
                <div className="lp-arch-col">
                  <span className="lp-arch-title">Powers every decision</span>
                  {['Daily Production', 'Quality & scrap', 'Reports & Pareto', 'AI Summary'].map((t) => (
                    <b key={t}>{t}</b>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="lp-section lp-results" id="results">
          <div className="lp-wrap">
            <Reveal>
              <SectionHead eyebrow="Results" title="Proven on the floor" center />
            </Reveal>
            <div className="lp-stats">
              {[
                ['5s', 'live board refresh'],
                ['15 min', 'output pace grid against target'],
                ['3 shifts', 'Day, Afternoon and Night in one view'],
                ['1 click', 'from a red block to a coded reason'],
                ['0 guesses', 'AI summary reads recorded data only'],
                ['A × P × Q', 'OEE computed, never typed'],
              ].map(([n, t], i) => (
                <Reveal key={n} delay={i * 50}>
                  <div className="lp-stat">
                    <strong>{n}</strong>
                    <span>{t}</span>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap">
            <Reveal>
              <SectionHead eyebrow="Operating model" title="A different way to run a shift" />
            </Reveal>
            <div className="lp-model">
              {[
                ['Every supervisor sees the whole floor', 'One view across lines, shifts and machines, so the worst hour is never a surprise at handover.'],
                ['Maintenance stops eating delivery', 'Uncommented stops stay on screen until coded, and repeat faults surface in Pareto before they become habits.'],
                ['Knowledge stays when people leave', 'Stop reasons, standards and shift notes live in Octavia, not in one operator’s notebook.'],
              ].map(([t, c], i) => (
                <Reveal key={t} delay={i * 90}>
                  <div className="lp-model-item">
                    <span className="lp-model-n">0{i + 1}</span>
                    <h3>{t}</h3>
                    <p>{c}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section lp-section-tint" id="workflow">
          <div className="lp-wrap">
            <Reveal>
              <SectionHead
                eyebrow="Workflow"
                title="One system. Every stage of the shift."
                lead="Octavia plans, runs, explains and improves the shift, with people approving where judgement matters."
                center
              />
            </Reveal>

            <div className="lp-tabs" role="tablist" aria-label="Shift stages">
              {STAGES.map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  type="button"
                  aria-selected={stage === s.id}
                  className={stage === s.id ? 'is-active' : ''}
                  onClick={() => setStage(s.id)}
                >
                  <span>{s.n}</span> {s.label}
                </button>
              ))}
            </div>

            <div className="lp-stage" key={active.id}>
              <div className="lp-stage-copy">
                <span className="lp-eyebrow">{active.n} {active.label}</span>
                <h3>{active.title}</h3>
                <p>{active.copy}</p>
                <ul>
                  {active.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
              <StageMock id={active.id} />
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap">
            <Reveal>
              <SectionHead
                eyebrow="Daily Production"
                title="One pane of glass across the plant"
                lead="Compare every machine on count, OEE and utilisation, with the full shift timeline beside it. Drill into any station in a click."
              />
            </Reveal>
            <Reveal>
              <div className="lp-table-card">
                <div className="lp-table-head">
                  <span>Machine</span>
                  <span>Count</span>
                  <span>OEE</span>
                  <span>Timeline</span>
                </div>
                {MACHINE_ROWS.map((m) => (
                  <div className="lp-table-row" key={m.code}>
                    <div className="lp-m">
                      <i className={`lp-status lp-status-${m.status}`} />
                      <div>
                        <strong>{m.code}</strong>
                        <span>{m.name}</span>
                      </div>
                    </div>
                    <div className="lp-count">
                      <strong>{m.parts}</strong>
                      <span>vs prev day</span>
                    </div>
                    <div className="lp-oee">{m.oee}</div>
                    <div className="lp-tl-track lp-tl-track-sm">
                      {m.segs.map(([state, w], j) => (
                        <i key={j} className={`lp-seg lp-seg-${state}`} style={{ width: `${w}%` }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        <section className="lp-section lp-section-tint">
          <div className="lp-wrap lp-fix">
            <Reveal>
              <SectionHead
                eyebrow="Incidents"
                title="From a stop to a reviewable fix"
                lead="When a machine goes red, Octavia shows what happened, what it is blocking and the reason on record, then waits for a person to close it out."
              />
              <ol className="lp-steps">
                {['Machine goes red', 'Reason is coded', 'Action is assigned', 'Resolved and reported'].map((s, i) => (
                  <li key={s}>
                    <span>{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </Reveal>

            <Reveal delay={100}>
              <div className="lp-incident">
                <div className="lp-incident-head">
                  <span className="lp-badge lp-badge-issue">
                    <i /> FAULT
                  </span>
                  <strong>Hydraulic issue · IMM-06</strong>
                  <time>07:22</time>
                </div>
                <p>
                  Pressure loss stopped the press for 18 minutes. Two downstream assembly cells are waiting on parts.
                </p>
                <div className="lp-board">
                  {[
                    ['Needs attention', [['Hydraulic issue · IMM-06', 'issue']]],
                    ['Reason coded', [['Material shortage · IMM-02', 'drip'], ['Mould change · IMM-04', 'drip']]],
                    ['Resolved', [['Heater fault · IMM-01', 'run']]],
                  ].map(([col, items]) => (
                    <div key={col as string}>
                      <span>{col as string}</span>
                      {(items as string[][]).map(([t, k]) => (
                        <b key={t} className={`k-${k}`}>
                          <i aria-hidden />
                          {t}
                        </b>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="lp-approve">
                  <i /> Reason approved by Shift Supervisor. IMM-06 returned to production.
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="lp-section" id="floors">
          <div className="lp-wrap">
            <Reveal>
              <SectionHead eyebrow="Floors" title="Made for the lines you actually run" center />
            </Reveal>
            <div className="lp-floors">
              {FLOORS.map((f, i) => (
                <Reveal key={f.title} delay={i * 70}>
                  <article className="lp-floor">
                    <div className="lp-floor-icon" aria-hidden>
                      <i className={`fa-solid ${f.icon}`} />
                    </div>
                    <h3>{f.title}</h3>
                    <p>{f.copy}</p>
                    <div className="lp-floor-chips">
                      {f.chips.map((chip) => (
                        <span key={chip}>{chip}</span>
                      ))}
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-cta-wrap">
          <div className="lp-wrap">
            <Reveal>
              <div className="lp-cta-box">
                <div className="lp-cta-inner">
                  <h2>Put the whole shift on one screen.</h2>
                  <p>Open the live demo with sample plant data and see every hour, stop and OEE point as it happens.</p>
                  <div className="lp-hero-actions is-center">
                    <Link to={primaryHref} className="lp-btn lp-btn-solid lp-btn-lg">
                      {primaryLabel}
                    </Link>
                    <a href="#platform" className="lp-btn lp-btn-outline lp-btn-lg">
                      Explore the platform
                    </a>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div>
            <Wordmark size="md" tone="dark" />
            <p>Production monitoring for Tanui Plastic Plant.</p>
          </div>
          <nav aria-label="Footer">
            <a href="#platform">Platform</a>
            <a href="#results">Results</a>
            <a href="#workflow">Workflow</a>
            <Link to="/login">Log in</Link>
          </nav>
          <span>© {new Date().getFullYear()} Octavia</span>
        </div>
      </footer>
    </div>
  )
}
