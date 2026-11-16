/** Shared Analysis board layout — pin report charts / hide built-ins. */

export type WidgetSource = 'builtin' | 'reports'

export type WidgetId =
  | 'oee_7d'
  | 'oee_30d'
  | 'downtime_7d'
  | 'downtime_30d'
  | 'qty_total'
  | 'qty_scrap'
  | 'qty_good'
  | 'oee_trend'
  | 'output_trend'
  | 'downtime_pareto'
  | 'downtime_by_day'
  | 'machine_compare'
  | 'quality_mix'
  | 'top_losses'

export type WidgetDef = {
  id: WidgetId
  title: string
  source: WidgetSource
  description: string
  openPath: string
}

export const WIDGET_CATALOG: WidgetDef[] = [
  {
    id: 'oee_7d',
    title: 'OEE (Last 7 days)',
    source: 'builtin',
    description: 'Availability / Performance / Quality gauge',
    openPath: '/reports',
  },
  {
    id: 'oee_30d',
    title: 'OEE (Last 30 days)',
    source: 'builtin',
    description: 'Availability / Performance / Quality gauge',
    openPath: '/reports',
  },
  {
    id: 'downtime_7d',
    title: 'Downtime (Last 7 days)',
    source: 'builtin',
    description: 'Top stop reasons',
    openPath: '/reports',
  },
  {
    id: 'downtime_30d',
    title: 'Downtime (Last 30 days)',
    source: 'builtin',
    description: 'Top stop reasons',
    openPath: '/reports',
  },
  {
    id: 'qty_total',
    title: 'Total Quantity (Last 30 days)',
    source: 'builtin',
    description: 'Daily total output',
    openPath: '/reports',
  },
  {
    id: 'qty_scrap',
    title: 'Scrap (Last 30 days)',
    source: 'builtin',
    description: 'Daily scrap',
    openPath: '/reports',
  },
  {
    id: 'qty_good',
    title: 'Good Quantity (Last 30 days)',
    source: 'builtin',
    description: 'Daily good output',
    openPath: '/reports',
  },
  {
    id: 'oee_trend',
    title: 'OEE trend',
    source: 'reports',
    description: 'Daily OEE · Availability · Performance · Quality',
    openPath: '/reports',
  },
  {
    id: 'output_trend',
    title: 'Daily output',
    source: 'reports',
    description: 'Good + scrap stacked bars',
    openPath: '/reports',
  },
  {
    id: 'downtime_pareto',
    title: 'Downtime Pareto',
    source: 'reports',
    description: 'Horizontal stop-reason chart',
    openPath: '/reports',
  },
  {
    id: 'downtime_by_day',
    title: 'Downtime by day',
    source: 'reports',
    description: 'Minutes per day',
    openPath: '/reports',
  },
  {
    id: 'machine_compare',
    title: 'Machine comparison',
    source: 'reports',
    description: 'OEE / availability / output by machine',
    openPath: '/reports',
  },
  {
    id: 'quality_mix',
    title: 'Quality mix',
    source: 'reports',
    description: 'Good vs scrap share',
    openPath: '/reports',
  },
  {
    id: 'top_losses',
    title: 'Top losses',
    source: 'reports',
    description: 'Ranked downtime table',
    openPath: '/reports',
  },
]

export const DEFAULT_LAYOUT: WidgetId[] = [
  'oee_7d',
  'oee_30d',
  'downtime_7d',
  'downtime_30d',
  'qty_total',
  'qty_scrap',
  'qty_good',
]

const STORAGE_KEY = 'octavia_analysis_widgets'

const VALID = new Set(WIDGET_CATALOG.map((w) => w.id))

export function catalogById(id: WidgetId): WidgetDef | undefined {
  return WIDGET_CATALOG.find((w) => w.id === id)
}

export function loadLayout(): WidgetId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...DEFAULT_LAYOUT]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [...DEFAULT_LAYOUT]
    const ids = parsed.filter((id): id is WidgetId => typeof id === 'string' && VALID.has(id as WidgetId))
    return ids.length ? ids : [...DEFAULT_LAYOUT]
  } catch {
    return [...DEFAULT_LAYOUT]
  }
}

export function saveLayout(ids: WidgetId[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
}

export function addWidget(id: WidgetId, current?: WidgetId[]): WidgetId[] {
  const layout = current ? [...current] : loadLayout()
  if (!VALID.has(id) || layout.includes(id)) return layout
  layout.push(id)
  saveLayout(layout)
  return layout
}

export function removeWidget(id: WidgetId, current?: WidgetId[]): WidgetId[] {
  const layout = (current ? [...current] : loadLayout()).filter((x) => x !== id)
  const next = layout.length ? layout : [...DEFAULT_LAYOUT]
  saveLayout(next)
  return next
}

export function resetLayout(): WidgetId[] {
  const next = [...DEFAULT_LAYOUT]
  saveLayout(next)
  return next
}

export function availableToAdd(layout: WidgetId[]): WidgetDef[] {
  const onBoard = new Set(layout)
  return WIDGET_CATALOG.filter((w) => !onBoard.has(w.id))
}

export function layoutNeedsReports(layout: WidgetId[]): boolean {
  return layout.some((id) => catalogById(id)?.source === 'reports')
}
