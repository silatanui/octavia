type Segment = {
  start_pct: number
  end_pct: number
  state: string
  color: string
  label: string
}

function offsetPct(hour: number, shiftStartHour: number, shiftHours: number) {
  let delta = hour - shiftStartHour
  if (delta < 0) delta += 24
  return (delta / Math.max(shiftHours, 1)) * 100
}

/** Active-shift performance bar (8h Day / Afternoon / Night), same peppered sim as station. */
export function TimelineBar({
  segments,
  hours = [6, 8, 10, 12, 14],
  showAxis = false,
  shiftStartHour = 6,
  shiftHours = 8,
}: {
  segments: Segment[]
  hours?: number[]
  showAxis?: boolean
  shiftStartHour?: number
  shiftHours?: number
}) {
  return (
    <div className="timeline">
      {showAxis ? (
        <div className="timeline-axis">
          {hours.map((h, i) => (
            <span key={`${h}-${i}`} style={{ left: `${offsetPct(h, shiftStartHour, shiftHours)}%` }}>
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>
      ) : null}
      <div className="timeline-track">
        {segments.map((s, i) => (
          <div
            key={`${s.start_pct}-${s.end_pct}-${i}`}
            className={`timeline-seg color-${s.color}`}
            title={s.label}
            style={{
              left: `${s.start_pct}%`,
              width: `${Math.max(s.end_pct - s.start_pct, 0.25)}%`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
