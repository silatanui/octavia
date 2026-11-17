import { ChartSkeleton, Skeleton } from './Skeleton'

export type AiFinding = {
  severity?: string
  title: string
  detail: string
}

export type ReportsAiAnalysis = {
  generated_at?: string
  provider?: string
  executive_summary: string
  findings: AiFinding[]
  actions: string[]
  disclaimer?: string
}

function severityClass(sev?: string) {
  const s = (sev || '').toLowerCase()
  if (s === 'high') return 'sev-high'
  if (s === 'low') return 'sev-low'
  return 'sev-medium'
}

export function ReportsAiPanel({
  open,
  analysis,
  loading,
  onRefresh,
  onClose,
}: {
  open: boolean
  analysis: ReportsAiAnalysis | null
  loading?: boolean
  onRefresh: () => void
  onClose: () => void
}) {
  if (!open) return null

  return (
    <aside className="reports-ai-panel">
      <div className="reports-ai-head">
        <div>
          <h2>AI Analysis</h2>
          {analysis?.provider ? (
            <span className="muted reports-ai-provider">{analysis.provider}</span>
          ) : null}
        </div>
        <div className="row">
          <button className="icon-btn" type="button" onClick={onRefresh} title="Refresh" disabled={loading}>
            ↻
          </button>
          <button className="icon-btn" type="button" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="reports-ai-body">
        {loading && !analysis ? (
          <div className="ai-skel" role="status" aria-label="Analyzing report">
            <Skeleton className="sk-block ai-skel-line" style={{ width: '90%' }} />
            <Skeleton className="sk-block ai-skel-line" style={{ width: '75%' }} />
            <Skeleton className="sk-block ai-skel-line" style={{ width: '82%' }} />
            <ChartSkeleton height={120} />
          </div>
        ) : null}

        {analysis ? (
          <>
            <p className="ai-executive">{analysis.executive_summary}</p>
            {analysis.disclaimer ? <p className="ai-disclaimer">{analysis.disclaimer}</p> : null}

            <h3 className="reports-ai-section">Findings</h3>
            <div className="reports-ai-findings">
              {(analysis.findings || []).map((f, i) => (
                <article key={`${f.title}-${i}`} className="reports-ai-card">
                  <span className={`reports-ai-sev ${severityClass(f.severity)}`}>
                    {(f.severity || 'medium').toUpperCase()}
                  </span>
                  <h4>{f.title}</h4>
                  <p>{f.detail}</p>
                </article>
              ))}
              {!analysis.findings?.length ? <div className="ai-empty">No findings returned.</div> : null}
            </div>

            <h3 className="reports-ai-section">Suggested actions</h3>
            <ul className="reports-ai-actions">
              {(analysis.actions || []).map((a, i) => (
                <li key={`${a}-${i}`}>{a}</li>
              ))}
              {!analysis.actions?.length ? <li className="muted">No actions returned.</li> : null}
            </ul>
          </>
        ) : null}
      </div>
    </aside>
  )
}
