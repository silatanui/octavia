import { useEffect, useState } from 'react'
import { Skeleton } from './Skeleton'

export type SummaryItem = {
  category: string
  title: string
  detail: string
  machine_ids: number[]
  machine_codes: string[]
  severity: string
}

export type AiSummary = {
  generated_at?: string
  demo_mode?: boolean
  disclaimer?: string
  executive_summary: string
  counts: {
    issues: number
    highlights: number
    standards: number
    recommendations: number
  }
  tabs: {
    issues: SummaryItem[]
    highlights: SummaryItem[]
    standards: SummaryItem[]
    recommendations: SummaryItem[]
  }
}

type TabKey = 'issues' | 'highlights' | 'standards' | 'recommendations'

const TAB_LABELS: { key: TabKey; label: string }[] = [
  { key: 'issues', label: 'Issues' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'standards', label: 'Standards' },
  { key: 'recommendations', label: 'Recommendations' },
]

function categoryClass(category: string) {
  const c = category.toUpperCase()
  if (c === 'AVAILABILITY') return 'cat-availability'
  if (c === 'PERFORMANCE') return 'cat-performance'
  if (c === 'INTEGRITY') return 'cat-integrity'
  if (c === 'ACTION') return 'cat-action'
  if (c === 'STANDARD') return 'cat-standard'
  return 'cat-integrity'
}

export function AiSummaryPanel({
  summary,
  loading,
  onRefresh,
  onClose,
  open,
}: {
  summary: AiSummary | null
  loading?: boolean
  onRefresh: () => void
  onClose: () => void
  open: boolean
}) {
  const [tab, setTab] = useState<TabKey>('issues')

  useEffect(() => {
    if (summary && summary.counts.issues === 0 && summary.counts.highlights > 0) {
      setTab('highlights')
    }
  }, [summary])

  if (!open) return null

  const items = summary?.tabs?.[tab] || []

  return (
    <aside className="ai-summary">
      <div className="ai-summary-head">
        <h2>AI Summary</h2>
        <div className="row">
          <button className="icon-btn" type="button" onClick={onRefresh} title="Refresh summary" disabled={loading}>
            ↻
          </button>
          <button className="icon-btn" type="button" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="ai-summary-body">
        {loading && !summary ? (
          <div className="ai-skel" role="status" aria-label="Generating summary">
            <Skeleton className="sk-block ai-skel-line" style={{ width: '92%' }} />
            <Skeleton className="sk-block ai-skel-line" style={{ width: '78%' }} />
            <Skeleton className="sk-block ai-skel-line" style={{ width: '84%' }} />
            <div className="ai-skel-card">
              <Skeleton className="daily-skel-badge" style={{ width: '5rem', height: '1rem' }} />
              <Skeleton className="sk-block ai-skel-line" style={{ width: '70%' }} />
              <Skeleton className="sk-block ai-skel-line" style={{ width: '95%' }} />
              <Skeleton className="sk-block ai-skel-line" style={{ width: '60%' }} />
            </div>
            <div className="ai-skel-card">
              <Skeleton className="daily-skel-badge" style={{ width: '4.5rem', height: '1rem' }} />
              <Skeleton className="sk-block ai-skel-line" style={{ width: '66%' }} />
              <Skeleton className="sk-block ai-skel-line" style={{ width: '88%' }} />
            </div>
          </div>
        ) : null}

        {summary ? (
          <>
            <p className="ai-executive">{summary.executive_summary}</p>
            {summary.disclaimer ? <p className="ai-disclaimer">{summary.disclaimer}</p> : null}

            <div className="ai-tabs">
              {TAB_LABELS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`ai-tab${tab === t.key ? ' active' : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  <span className="ai-count">{summary.counts[t.key]}</span>
                </button>
              ))}
            </div>

            <div className="ai-cards">
              {items.map((item, idx) => (
                <article className="ai-card" key={`${item.title}-${idx}`}>
                  <div className={`ai-cat ${categoryClass(item.category)}`}>{item.category}</div>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                  {item.machine_codes?.length ? (
                    <div className="ai-machines">
                      {item.machine_codes.map((code) => (
                        <span key={code}>{code}</span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
              {!items.length ? <div className="ai-empty">No items in this tab.</div> : null}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  )
}
