import type { CSSProperties } from 'react'

/** Lightweight shimmer block for loading placeholders. */
export function Skeleton({
  className = '',
  style,
  label,
}: {
  className?: string
  style?: CSSProperties
  label?: string
}) {
  return (
    <span
      className={`sk${className ? ` ${className}` : ''}`}
      style={style}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'status' : undefined}
    />
  )
}

/** Simple chart placeholder: plot area + a few axis ticks. */
export function ChartSkeleton({
  height = 180,
  className = '',
}: {
  height?: number
  className?: string
}) {
  return (
    <div
      className={`sk-chart${className ? ` ${className}` : ''}`}
      style={{ minHeight: height }}
      role="status"
      aria-label="Loading chart"
    >
      <Skeleton className="sk-block sk-chart-plot" />
      <div className="sk-chart-axis">
        <Skeleton className="sk-chart-tick" />
        <Skeleton className="sk-chart-tick" />
        <Skeleton className="sk-chart-tick" />
        <Skeleton className="sk-chart-tick" />
      </div>
    </div>
  )
}

/** Simple KPI strip placeholders. */
export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="sk-kpi-strip" role="status" aria-label="Loading metrics">
      {Array.from({ length: count }, (_, i) => (
        <div className="sk-kpi-card" key={`kpi-${i}`}>
          <Skeleton className="sk-block" style={{ height: 10, width: '42%' }} />
          <Skeleton className="sk-block" style={{ height: 22, width: '58%', marginTop: 8 }} />
        </div>
      ))}
    </div>
  )
}

/** Simple table row placeholders. */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="sk-table" role="status" aria-label="Loading table">
      {Array.from({ length: rows }, (_, r) => (
        <div className="sk-table-row" key={`tr-${r}`}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton
              key={`td-${r}-${c}`}
              className="sk-block sk-table-cell"
              style={{ width: c === 0 ? '28%' : `${12 + ((c * 7) % 18)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
