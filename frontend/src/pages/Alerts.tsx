import { useEffect, useState } from 'react'
import { api } from '../api'

export function Alerts() {
  const [alerts, setAlerts] = useState<Array<Record<string, unknown>>>([])
  const [error, setError] = useState('')

  async function load() {
    setAlerts(await api.get('/alerts'))
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  async function updateStatus(id: number, status: string) {
    try {
      await api.patch(`/alerts/${id}`, { status })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <>
      <div className="topbar">
        <strong>Alerts & Actions</strong>
        <span className="topbar-sub">Open issues · acknowledge or close</span>
      </div>
      <div className="page">
        <p className="page-lead">
          Operational alerts raised from machines and processes. Close or acknowledge items so supervisors can
          clear the queue during the shift.
        </p>
        {error ? <div className="error">{error}</div> : null}
        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Type</th>
                <th>Message</th>
                <th>Created</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={String(a.id)}>
                  <td className={`sev-${a.severity}`}>{String(a.severity)}</td>
                  <td>{String(a.alert_type)}</td>
                  <td>{String(a.message)}</td>
                  <td>{a.created_at ? new Date(String(a.created_at)).toLocaleString() : '—'}</td>
                  <td>{String(a.status)}</td>
                  <td>
                    <div className="row">
                      {a.status === 'Open' ? (
                        <button className="btn" type="button" onClick={() => updateStatus(Number(a.id), 'Acknowledged')}>
                          Acknowledge
                        </button>
                      ) : null}
                      {a.status !== 'Closed' ? (
                        <button className="btn btn-primary" type="button" onClick={() => updateStatus(Number(a.id), 'Closed')}>
                          Close
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
