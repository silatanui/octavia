import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { TableSkeleton } from '../components/Skeleton'
import { StatusPill } from '../components/StatusPill'
import { PLANT, machineByCode, machineByIndex, productByCode } from '../plantCatalog'

type MachineRow = {
  id: number
  production_line_id?: number
  machine_code: string
  machine_name: string
  line_name?: string | null
  machine_type?: string | null
  status: string
  status_source?: string
  last_update_at?: string | null
}

function fmtTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function Machines() {
  const [machines, setMachines] = useState<MachineRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const lineFilter = searchParams.get('line') || ''

  useEffect(() => {
    const qs = lineFilter ? `?line_id=${encodeURIComponent(lineFilter)}` : ''
    setLoading(true)
    api
      .get<MachineRow[]>(`/machines${qs}`)
      .then(setMachines)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [lineFilter])

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const m of machines) {
      map[m.status] = (map[m.status] || 0) + 1
    }
    return map
  }, [machines])

  const running = counts.Running || 0
  const stopped =
    (counts.Fault || 0) +
    (counts['Unplanned Stop'] || 0) +
    (counts['Planned Stop'] || 0) +
    (counts.Setup || 0) +
    (counts.Idle || 0) +
    (counts.Offline || 0)

  const lineLabel = machines[0]?.line_name || (lineFilter ? `Line #${lineFilter}` : null)

  return (
    <>
      <div className="topbar">
        <strong>Machines</strong>
        <span className="topbar-sub">{PLANT.siteName} · station board</span>
        <div className="topbar-meta">
          <span>
            Assets <b>{machines.length}</b>
          </span>
          <span>
            Running <b>{running}</b>
          </span>
          <span>
            Not running <b>{stopped}</b>
          </span>
          <span>
            Lines <b>{new Set(machines.map((m) => m.line_name || '—')).size}</b>
          </span>
        </div>
      </div>
      <div className="page">
        {error ? <div className="error">{error}</div> : null}

        <p className="page-lead">
          Live asset list for Tanui injection and assembly cells. Open a row to enter the Octavia station
          view (hourly timeline, OEE, stop coding). Rates shown are catalog targets for the assigned product.
        </p>

        {lineFilter ? (
          <div className="demo-banner machines-line-filter">
            Showing machines on <b>{lineLabel}</b>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                searchParams.delete('line')
                setSearchParams(searchParams, { replace: true })
              }}
            >
              Clear filter
            </button>
          </div>
        ) : null}

        <section className="plant-strip">
          <img src={PLANT.exteriorImage} alt={PLANT.siteName} />
          <div>
            <h1>{PLANT.siteName}</h1>
            <p>
              {PLANT.location} · {PLANT.tagline}
            </p>
            <div className="plant-strip-stats">
              <span>
                Presses / cells <b>{machines.length}</b>
              </span>
              <span>
                Running now <b>{running}</b>
              </span>
              <span>
                Status sources{' '}
                <b>{[...new Set(machines.map((m) => m.status_source || 'manual'))].join(', ') || '—'}</b>
              </span>
            </div>
          </div>
        </section>

        <div className="machine-board">
          {loading && !machines.length ? (
            <TableSkeleton rows={8} cols={5} />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>Line</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Current product</th>
                  <th>Target rate</th>
                  <th>Cycle</th>
                  <th>Source</th>
                  <th>Last update</th>
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => {
                  const catalog = machineByCode(m.machine_code) || machineByIndex(m.id)
                  const product = productByCode(catalog.productCode)
                  const highlighted = lineFilter && String(m.production_line_id) === lineFilter
                  return (
                    <tr
                      key={m.id}
                      className={highlighted ? 'is-line-highlight' : undefined}
                      onClick={() => navigate(`/machines/${m.id}`)}
                    >
                      <td>
                        <div className="cell-machine">
                          <img src={catalog.image} alt="" />
                          <div>
                            <strong className="mono">{catalog.code}</strong>
                            <span>{catalog.name}</span>
                          </div>
                        </div>
                      </td>
                      <td>{catalog.line || m.line_name || '—'}</td>
                      <td className="muted-cell">{catalog.type || m.machine_type || '—'}</td>
                      <td>
                        <StatusPill status={String(m.status)} />
                      </td>
                      <td>
                        <div className="cell-product">
                          <img src={product.image} alt="" />
                          <div>
                            <div>{product.name}</div>
                            <div className="muted-cell mono">{product.code}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num">
                        {product.hourlyTarget} {product.unit}/h
                      </td>
                      <td className="num muted-cell">{product.cycleSeconds}s</td>
                      <td className="muted-cell">{m.status_source || '—'}</td>
                      <td className="num muted-cell">{fmtTime(m.last_update_at)}</td>
                    </tr>
                  )
                })}
                {!machines.length && !error ? (
                  <tr>
                    <td colSpan={9} className="muted-cell">
                      No machines loaded
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
