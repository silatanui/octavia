import { useCallback, useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { UserAvatar } from '../components/Wordmark'

type AvailableUser = {
  id: number
  name: string
  email: string
  role_name?: string | null
}

type Assignment = {
  id: number
  user_id: number
  user_name: string
  user_email?: string | null
  user_role_name?: string | null
  work_date: string
  shift_id: number
  shift_name?: string | null
  assignment_role: string
  production_line_id?: number | null
  line_name?: string | null
  machine_id?: number | null
  machine_code?: string | null
  machine_name?: string | null
  notes?: string | null
}

type MachineSlot = {
  machine_id: number
  machine_code: string
  machine_name: string
  status: string
  staff: Assignment[]
}

type LineBlock = {
  production_line_id: number
  line_name: string
  department_id: number
  department_name: string
  leads: Assignment[]
  machines: MachineSlot[]
}

type Board = {
  work_date: string
  shift_id: number | null
  shift_name?: string | null
  can_edit: boolean
  available: AvailableUser[]
  lines: LineBlock[]
  unplaced: Assignment[]
}

type Options = {
  users: AvailableUser[]
  shifts: Array<{ id: number; shift_name: string; start_time?: string; end_time?: string }>
  departments: Array<{ id: number; department_name: string; site_id: number }>
  lines: Array<{ id: number; line_name: string; department_id: number }>
  machines: Array<{
    id: number
    machine_code: string
    machine_name: string
    status: string
    production_line_id: number
  }>
  roles: Array<{ key: string; label: string }>
}

const LEAD_ROLES = new Set(['section_lead', 'team_lead'])

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function roleLabel(key: string, roles?: Options['roles']) {
  return roles?.find((r) => r.key === key)?.label || key.replace(/_/g, ' ')
}

function statusClass(status: string) {
  return status.replace(/\s+/g, '-').toLowerCase()
}

function PersonCard({
  name,
  role,
  canEdit,
  onEdit,
  onRemove,
}: {
  name: string
  role: string
  canEdit: boolean
  onEdit?: () => void
  onRemove?: () => void
}) {
  return (
    <article className="staff-person">
      <UserAvatar name={name} size="md" />
      <div className="staff-person-text">
        <strong>{name}</strong>
        <span>{role}</span>
      </div>
      {canEdit ? (
        <div className="staff-person-actions">
          {onEdit ? (
            <button type="button" onClick={onEdit}>
              Edit
            </button>
          ) : null}
          {onRemove ? (
            <button type="button" onClick={onRemove}>
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export function Staffing() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [options, setOptions] = useState<Options | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [workDate, setWorkDate] = useState(todayIso)
  const [shiftId, setShiftId] = useState('')
  const [deptId, setDeptId] = useState('')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Assignment | null>(null)
  const [form, setForm] = useState({
    user_id: '',
    assignment_role: 'operator',
    production_line_id: '',
    machine_id: '',
    notes: '',
  })

  const canEdit = board?.can_edit ?? false

  const loadOptions = useCallback(async () => {
    const opts = await api.get<Options>('/staffing/options')
    setOptions(opts)
    if (!shiftId && opts.shifts.length) {
      setShiftId(String(opts.shifts[0].id))
    }
  }, [shiftId])

  const loadBoard = useCallback(async () => {
    if (!shiftId) return
    const params = new URLSearchParams({
      work_date: workDate,
      shift_id: shiftId,
    })
    if (deptId) params.set('department_id', deptId)
    const data = await api.get<Board>(`/staffing?${params}`)
    setBoard(data)
  }, [workDate, shiftId, deptId])

  useEffect(() => {
    loadOptions().catch((e) => setError(e.message))
  }, [loadOptions])

  useEffect(() => {
    if (!shiftId) return
    loadBoard().catch((e) => setError(e.message))
  }, [loadBoard, shiftId])

  const machinesForForm = useMemo(() => {
    if (!options) return []
    if (LEAD_ROLES.has(form.assignment_role)) return []
    if (form.production_line_id) {
      return options.machines.filter((m) => String(m.production_line_id) === form.production_line_id)
    }
    return options.machines
  }, [options, form.assignment_role, form.production_line_id])

  function openCreate(preset?: {
    user_id?: number
    production_line_id?: number
    machine_id?: number
    assignment_role?: string
  }) {
    setEditing(null)
    setForm({
      user_id: preset?.user_id ? String(preset.user_id) : '',
      assignment_role: preset?.assignment_role || 'operator',
      production_line_id: preset?.production_line_id ? String(preset.production_line_id) : '',
      machine_id: preset?.machine_id ? String(preset.machine_id) : '',
      notes: '',
    })
    setDialogOpen(true)
    setError('')
  }

  function openEdit(a: Assignment) {
    setEditing(a)
    setForm({
      user_id: String(a.user_id),
      assignment_role: a.assignment_role,
      production_line_id: a.production_line_id ? String(a.production_line_id) : '',
      machine_id: a.machine_id ? String(a.machine_id) : '',
      notes: a.notes || '',
    })
    setDialogOpen(true)
    setError('')
  }

  async function submitAssign(e: FormEvent) {
    e.preventDefault()
    if (!shiftId) return
    setError('')
    setMsg('')
    const isLead = LEAD_ROLES.has(form.assignment_role)
    const placement = {
      assignment_role: form.assignment_role,
      production_line_id: isLead ? Number(form.production_line_id) : null,
      machine_id: isLead ? null : Number(form.machine_id),
      notes: form.notes || null,
    }
    try {
      if (editing) {
        await api.patch(`/staffing/${editing.id}`, {
          ...placement,
          clear_line: !isLead,
          clear_machine: isLead,
        })
        setMsg(`Updated ${editing.user_name}`)
      } else {
        await api.post('/staffing', {
          user_id: Number(form.user_id),
          work_date: workDate,
          shift_id: Number(shiftId),
          ...placement,
        })
        setMsg('Staff assigned')
      }
      setDialogOpen(false)
      await loadBoard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function removeAssignment(a: Assignment) {
    if (!canEdit) return
    if (!window.confirm(`Remove ${a.user_name} from this shift?`)) return
    try {
      await api.delete(`/staffing/${a.id}`)
      setMsg(`Removed ${a.user_name}`)
      await loadBoard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    }
  }

  function stopNav(e: MouseEvent) {
    e.stopPropagation()
  }

  const assignedCount =
    (board?.lines.reduce(
      (n, ln) => n + ln.leads.length + ln.machines.reduce((m, slot) => m + slot.staff.length, 0),
      0,
    ) ?? 0) + (board?.unplaced.length ?? 0)

  return (
    <>
      <div className="topbar">
        <strong>Staffing</strong>
        <span className="topbar-sub">Plant-floor map · leads on lines · crews on machines</span>
        <div className="topbar-meta">
          <span>
            Signed in as <b>{user?.name}</b>
          </span>
          {board ? (
            <span>
              Roster <b>{assignedCount}</b> · available <b>{board.available.length}</b>
            </span>
          ) : null}
        </div>
      </div>

      <div className="page staffing-page">
        <p className="page-lead">
          Click a <strong>line</strong> to open its machines list, or a <strong>machine</strong> tile to open the
          station board. Assign leads to sections and operators to specific machines for the selected day and
          shift.
        </p>
        {error ? <div className="error">{error}</div> : null}
        {msg ? <div className="demo-banner">{msg}</div> : null}

        <div className="staffing-filters panel">
          <div className="field">
            <label>Date</label>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Shift</label>
            <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              {(options?.shifts || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shift_name}
                  {s.start_time && s.end_time ? ` · ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Department</label>
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)}>
              <option value="">All departments</option>
              {(options?.departments || []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.department_name}
                </option>
              ))}
            </select>
          </div>
          <div className="staffing-filter-actions">
            {canEdit ? (
              <button type="button" className="btn btn-primary" onClick={() => openCreate()}>
                Assign staff
              </button>
            ) : (
              <span className="muted">View only — supervisors and managers can edit</span>
            )}
          </div>
        </div>

        <div className="staffing-layout">
          <aside className="staffing-pool panel">
            <h2>Available</h2>
            <p className="muted">Not on this date / shift</p>
            <ul className="staff-pool-list">
              {(board?.available || []).map((u) => (
                <li key={u.id}>
                  <div className="staff-pool-person">
                    <UserAvatar name={u.name} size="md" />
                    <div>
                      <strong>{u.name}</strong>
                      <span>{u.role_name || '—'}</span>
                    </div>
                  </div>
                  {canEdit ? (
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => openCreate({ user_id: u.id })}>
                      Assign
                    </button>
                  ) : null}
                </li>
              ))}
              {board && board.available.length === 0 ? <li className="empty">Everyone is placed</li> : null}
            </ul>
          </aside>

          <div className="staffing-board">
            {(board?.lines || []).map((ln) => (
              <section className="staff-line panel" key={ln.production_line_id}>
                <header
                  className="staff-line-head is-clickable"
                  role="link"
                  tabIndex={0}
                  title={`Open machines on ${ln.line_name}`}
                  onClick={() => navigate(`/machines?line=${ln.production_line_id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigate(`/machines?line=${ln.production_line_id}`)
                    }
                  }}
                >
                  <div className="staff-line-title">
                    <h2>{ln.line_name}</h2>
                    <span className="muted">{ln.department_name} · open machines</span>
                  </div>
                  <div className="staff-line-leads" onClick={stopNav}>
                    {ln.leads.length ? (
                      <div className="avatar-stack" aria-label="Line leads">
                        {ln.leads.map((a) => (
                          <UserAvatar key={a.id} name={a.user_name} size="md" />
                        ))}
                      </div>
                    ) : (
                      <span className="empty">No lead</span>
                    )}
                    {canEdit ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={(e) => {
                          e.stopPropagation()
                          openCreate({
                            production_line_id: ln.production_line_id,
                            assignment_role: 'team_lead',
                          })
                        }}
                      >
                        + Lead
                      </button>
                    ) : null}
                    <span className="staff-line-chevron" aria-hidden>
                      →
                    </span>
                  </div>
                </header>

                {ln.leads.length ? (
                  <div className="staff-leads-detail">
                    {ln.leads.map((a) => (
                      <PersonCard
                        key={a.id}
                        name={a.user_name}
                        role={roleLabel(a.assignment_role, options?.roles)}
                        canEdit={canEdit}
                        onEdit={() => openEdit(a)}
                        onRemove={() => removeAssignment(a)}
                      />
                    ))}
                  </div>
                ) : null}

                <div className="staff-machines">
                  {ln.machines.map((m) => (
                    <button
                      type="button"
                      className={`staff-machine-tile status-${statusClass(m.status)}`}
                      key={m.machine_id}
                      onClick={() => navigate(`/machines/${m.machine_id}`)}
                      title={`Open station · ${m.machine_code}`}
                    >
                      <div className="staff-machine-top">
                        <div>
                          <strong className="mono">{m.machine_code}</strong>
                          <span>{m.machine_name}</span>
                        </div>
                        <em>{m.status}</em>
                      </div>

                      <div className="staff-machine-crew">
                        {m.staff.length ? (
                          <>
                            <div className="avatar-stack">
                              {m.staff.map((a) => (
                                <UserAvatar key={a.id} name={a.user_name} size="md" />
                              ))}
                            </div>
                            <div className="staff-machine-names">
                              {m.staff.map((a) => (
                                <span key={a.id}>
                                  {a.user_name.split(' ')[0]} · {roleLabel(a.assignment_role, options?.roles)}
                                </span>
                              ))}
                            </div>
                          </>
                        ) : (
                          <span className="empty">Open slot</span>
                        )}
                      </div>

                      {canEdit ? (
                        <div className="staff-machine-actions" onClick={stopNav}>
                          {m.staff.map((a) => (
                            <span key={a.id} className="staff-mini-actions">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openEdit(a)
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeAssignment(a)
                                }}
                              >
                                Remove
                              </button>
                            </span>
                          ))}
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={(e) => {
                              e.stopPropagation()
                              openCreate({
                                machine_id: m.machine_id,
                                production_line_id: ln.production_line_id,
                                assignment_role: 'operator',
                              })
                            }}
                          >
                            + Operator
                          </button>
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {board && board.lines.length === 0 ? (
              <div className="panel empty-board">No production lines for this filter.</div>
            ) : null}
          </div>
        </div>
      </div>

      {dialogOpen ? (
        <div className="stop-modal-backdrop" role="presentation" onClick={() => setDialogOpen(false)}>
          <form
            className="stop-modal staffing-modal"
            role="dialog"
            aria-labelledby="staff-assign-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitAssign}
          >
            <header className="stop-modal-head">
              <h2 id="staff-assign-title">{editing ? 'Edit placement' : 'Assign staff'}</h2>
              <button type="button" className="btn btn-ghost" onClick={() => setDialogOpen(false)}>
                Close
              </button>
            </header>
            <div className="stack staffing-modal-body">
              {!editing ? (
                <div className="field">
                  <label>Person</label>
                  <select
                    required
                    value={form.user_id}
                    onChange={(e) => setForm({ ...form, user_id: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {(board?.available || []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role_name || 'staff'})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="staff-edit-preview">
                  <UserAvatar name={editing.user_name} size="lg" />
                  <p className="muted">
                    Editing <strong>{editing.user_name}</strong>
                  </p>
                </div>
              )}

              <div className="field">
                <label>Assignment role</label>
                <select
                  value={form.assignment_role}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      assignment_role: e.target.value,
                      machine_id: LEAD_ROLES.has(e.target.value) ? '' : form.machine_id,
                    })
                  }
                >
                  {(options?.roles || []).map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {LEAD_ROLES.has(form.assignment_role) ? (
                <div className="field">
                  <label>Production line (section)</label>
                  <select
                    required
                    value={form.production_line_id}
                    onChange={(e) => setForm({ ...form, production_line_id: e.target.value })}
                  >
                    <option value="">Select line…</option>
                    {(options?.lines || [])
                      .filter((l) => !deptId || String(l.department_id) === deptId)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.line_name}
                        </option>
                      ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className="field">
                    <label>Line filter (optional)</label>
                    <select
                      value={form.production_line_id}
                      onChange={(e) => setForm({ ...form, production_line_id: e.target.value, machine_id: '' })}
                    >
                      <option value="">All lines</option>
                      {(options?.lines || []).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.line_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Machine</label>
                    <select
                      required
                      value={form.machine_id}
                      onChange={(e) => setForm({ ...form, machine_id: e.target.value })}
                    >
                      <option value="">Select machine…</option>
                      {machinesForForm.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.machine_code} · {m.machine_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div className="field">
                <label>Notes</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            </div>
            <footer className="stop-modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {editing ? 'Save changes' : 'Assign'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </>
  )
}
