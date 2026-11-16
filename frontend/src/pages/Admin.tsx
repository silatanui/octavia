import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api } from '../api'

type Tab = 'org' | 'products' | 'users' | 'production'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'org', label: 'Plant structure', hint: 'Sites · departments · lines · machines' },
  { id: 'products', label: 'Products', hint: 'SKU catalog & cycle times' },
  { id: 'users', label: 'Users', hint: 'Accounts & roles' },
  { id: 'production', label: 'Production entry', hint: 'Manual output posting' },
]

export function Admin() {
  const [tab, setTab] = useState<Tab>('org')
  const [sites, setSites] = useState<Array<Record<string, unknown>>>([])
  const [departments, setDepartments] = useState<Array<Record<string, unknown>>>([])
  const [lines, setLines] = useState<Array<Record<string, unknown>>>([])
  const [shifts, setShifts] = useState<Array<Record<string, unknown>>>([])
  const [products, setProducts] = useState<Array<Record<string, unknown>>>([])
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([])
  const [roles, setRoles] = useState<Array<Record<string, unknown>>>([])
  const [machines, setMachines] = useState<Array<Record<string, unknown>>>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [createOpen, setCreateOpen] = useState(true)

  async function load() {
    const [s, d, l, sh, p, m] = await Promise.all([
      api.get<Array<Record<string, unknown>>>('/admin/sites'),
      api.get<Array<Record<string, unknown>>>('/admin/departments'),
      api.get<Array<Record<string, unknown>>>('/admin/lines'),
      api.get<Array<Record<string, unknown>>>('/admin/shifts'),
      api.get<Array<Record<string, unknown>>>('/admin/products'),
      api.get<Array<Record<string, unknown>>>('/machines'),
    ])
    setSites(s)
    setDepartments(d)
    setLines(l)
    setShifts(sh)
    setProducts(p)
    setMachines(m)
    try {
      const [u, r] = await Promise.all([
        api.get<Array<Record<string, unknown>>>('/admin/users'),
        api.get<Array<Record<string, unknown>>>('/admin/roles'),
      ])
      setUsers(u)
      setRoles(r)
    } catch {
      // non-admins may not list users
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!msg) return
    const t = window.setTimeout(() => setMsg(''), 2800)
    return () => window.clearTimeout(t)
  }, [msg])

  const siteName = useMemo(() => {
    const map = new Map(sites.map((s) => [Number(s.id), String(s.site_name)]))
    return (id: unknown) => map.get(Number(id)) || `Site #${id}`
  }, [sites])

  const deptName = useMemo(() => {
    const map = new Map(departments.map((d) => [Number(d.id), String(d.department_name)]))
    return (id: unknown) => map.get(Number(id)) || `Dept #${id}`
  }, [departments])

  const lineName = useMemo(() => {
    const map = new Map(lines.map((l) => [Number(l.id), String(l.line_name)]))
    return (id: unknown) => map.get(Number(id)) || `Line #${id}`
  }, [lines])

  const orgTree = useMemo(() => {
    return departments.map((d) => {
      const deptLines = lines.filter((l) => Number(l.department_id) === Number(d.id))
      return {
        id: Number(d.id),
        name: String(d.department_name),
        site: siteName(d.site_id),
        lines: deptLines.map((l) => {
          const lineMachines = machines.filter((m) => Number(m.production_line_id) === Number(l.id))
          return {
            id: Number(l.id),
            name: String(l.line_name),
            machines: lineMachines.map((m) => ({
              id: Number(m.id),
              code: String(m.machine_code),
              name: String(m.machine_name),
              type: String(m.machine_type || '—'),
              status: String(m.status || '—'),
            })),
          }
        }),
      }
    })
  }, [departments, lines, machines, siteName])

  async function wrap(action: () => Promise<void>, ok: string, form?: HTMLFormElement) {
    setError('')
    try {
      await action()
      setMsg(ok)
      form?.reset()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    }
  }

  async function createSite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    await wrap(
      () =>
        api.post('/admin/sites', {
          site_name: fd.get('site_name'),
          location: fd.get('location'),
          timezone: fd.get('timezone') || 'UTC',
        }),
      'Site created',
      form,
    )
  }

  async function createDept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    await wrap(
      () =>
        api.post('/admin/departments', {
          site_id: Number(fd.get('site_id')),
          department_name: fd.get('department_name'),
        }),
      'Department created',
      form,
    )
  }

  async function createLine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    await wrap(
      () =>
        api.post('/admin/lines', {
          department_id: Number(fd.get('department_id')),
          line_name: fd.get('line_name'),
        }),
      'Line created',
      form,
    )
  }

  async function createMachine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    await wrap(
      () =>
        api.post('/machines', {
          production_line_id: Number(fd.get('production_line_id')),
          machine_code: fd.get('machine_code'),
          machine_name: fd.get('machine_name'),
          machine_type: fd.get('machine_type'),
          status: 'Offline',
        }),
      'Machine created',
      form,
    )
  }

  async function createProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    await wrap(
      () =>
        api.post('/admin/products', {
          product_code: fd.get('product_code'),
          product_name: fd.get('product_name'),
          ideal_cycle_time: Number(fd.get('ideal_cycle_time') || 60),
          unit_of_measure: fd.get('unit_of_measure') || 'pcs',
        }),
      'Product created',
      form,
    )
  }

  async function createUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    await wrap(
      () =>
        api.post('/admin/users', {
          name: fd.get('name'),
          email: fd.get('email'),
          password: fd.get('password'),
          role_id: Number(fd.get('role_id')),
        }),
      'User created',
      form,
    )
  }

  async function recordProduction(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    await wrap(
      () =>
        api.post('/production', {
          machine_id: Number(fd.get('machine_id')),
          work_order_id: fd.get('work_order_id') ? Number(fd.get('work_order_id')) : null,
          shift_id: fd.get('shift_id') ? Number(fd.get('shift_id')) : null,
          total_units: Number(fd.get('total_units')),
          good_units: Number(fd.get('good_units')),
          rejected_units: Number(fd.get('rejected_units') || 0),
          source: 'manual',
        }),
      'Production recorded',
      form,
    )
  }

  const activeTab = TABS.find((t) => t.id === tab)!

  return (
    <>
      <div className="topbar">
        <strong>Administration</strong>
        <span className="topbar-sub">Master data · Tanui Plastic Plant</span>
      </div>

      <div className="page admin-page">
        <p className="page-lead">
          Configure plant structure, products, and users. Changes drive Daily Production filters, staffing
          placements, and station boards.
        </p>

        <div className="admin-stat-strip">
          <div className="admin-stat">
            <span className="label">Sites</span>
            <strong>{sites.length}</strong>
          </div>
          <div className="admin-stat">
            <span className="label">Departments</span>
            <strong>{departments.length}</strong>
          </div>
          <div className="admin-stat">
            <span className="label">Lines</span>
            <strong>{lines.length}</strong>
          </div>
          <div className="admin-stat">
            <span className="label">Machines</span>
            <strong>{machines.length}</strong>
          </div>
          <div className="admin-stat">
            <span className="label">Products</span>
            <strong>{products.length}</strong>
          </div>
          <div className="admin-stat">
            <span className="label">Users</span>
            <strong>{users.length || '—'}</strong>
          </div>
        </div>

        <div className="admin-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              <strong>{t.label}</strong>
              <span>{t.hint}</span>
            </button>
          ))}
        </div>

        {error ? <div className="error">{error}</div> : null}
        {msg ? <div className="admin-toast">{msg}</div> : null}

        <div className="admin-section-head">
          <div>
            <h2>{activeTab.label}</h2>
            <p className="muted">{activeTab.hint}</p>
          </div>
          {tab !== 'production' ? (
            <button type="button" className="btn-ghost" onClick={() => setCreateOpen((v) => !v)}>
              {createOpen ? 'Hide create forms' : 'Show create forms'}
            </button>
          ) : null}
        </div>

        {tab === 'org' ? (
          <div className={`admin-layout${createOpen ? '' : ' browse-only'}`}>
            {createOpen ? (
              <div className="admin-create-col">
                <form className="admin-card" onSubmit={createSite}>
                  <h3>Add site</h3>
                  <div className="field">
                    <label>Site name</label>
                    <input name="site_name" required placeholder="Tanui Plastic Plant" />
                  </div>
                  <div className="field">
                    <label>Location</label>
                    <input name="location" placeholder="City / campus" />
                  </div>
                  <div className="field">
                    <label>Timezone</label>
                    <input name="timezone" defaultValue="Europe/Budapest" />
                  </div>
                  <button className="btn btn-primary" type="submit">
                    Add site
                  </button>
                </form>

                <form className="admin-card" onSubmit={createDept}>
                  <h3>Add department</h3>
                  <div className="field">
                    <label>Site</label>
                    <select name="site_id" required>
                      {sites.map((s) => (
                        <option key={String(s.id)} value={String(s.id)}>
                          {String(s.site_name)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Department name</label>
                    <input name="department_name" required placeholder="Injection Molding" />
                  </div>
                  <button className="btn btn-primary" type="submit">
                    Add department
                  </button>
                </form>

                <form className="admin-card" onSubmit={createLine}>
                  <h3>Add line</h3>
                  <div className="field">
                    <label>Department</label>
                    <select name="department_id" required>
                      {departments.map((d) => (
                        <option key={String(d.id)} value={String(d.id)}>
                          {String(d.department_name)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Line name</label>
                    <input name="line_name" required placeholder="Molding Hall A" />
                  </div>
                  <button className="btn btn-primary" type="submit">
                    Add line
                  </button>
                </form>

                <form className="admin-card" onSubmit={createMachine}>
                  <h3>Add machine</h3>
                  <div className="field">
                    <label>Production line</label>
                    <select name="production_line_id" required>
                      {lines.map((l) => (
                        <option key={String(l.id)} value={String(l.id)}>
                          {String(l.line_name)} · {deptName(l.department_id)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="admin-inline-2">
                    <div className="field">
                      <label>Code</label>
                      <input name="machine_code" required placeholder="IMM-09" />
                    </div>
                    <div className="field">
                      <label>Type</label>
                      <input name="machine_type" placeholder="Injection Press" />
                    </div>
                  </div>
                  <div className="field">
                    <label>Name</label>
                    <input name="machine_name" required placeholder="Engel Duo 700" />
                  </div>
                  <button className="btn btn-primary" type="submit">
                    Add machine
                  </button>
                </form>
              </div>
            ) : null}

            <div className="admin-browse-col">
              <div className="admin-card admin-sites-row">
                <h3>Sites & shifts</h3>
                <div className="admin-chip-row">
                  {sites.map((s) => (
                    <span key={String(s.id)} className="admin-chip">
                      <b>{String(s.site_name)}</b>
                      <em>{String(s.location || s.timezone || '')}</em>
                    </span>
                  ))}
                  {!sites.length ? <span className="muted">No sites yet</span> : null}
                </div>
                <div className="admin-chip-row shifts">
                  {shifts.map((s) => (
                    <span key={String(s.id)} className="admin-chip soft">
                      {String(s.shift_name)}
                    </span>
                  ))}
                </div>
              </div>

              {orgTree.map((dept) => (
                <section key={dept.id} className="admin-org-dept">
                  <header>
                    <div>
                      <h3>{dept.name}</h3>
                      <span className="muted">{dept.site}</span>
                    </div>
                    <span className="admin-count">
                      {dept.lines.length} lines ·{' '}
                      {dept.lines.reduce((n, l) => n + l.machines.length, 0)} machines
                    </span>
                  </header>
                  <div className="admin-org-lines">
                    {dept.lines.map((ln) => (
                      <article key={ln.id} className="admin-org-line">
                        <h4>{ln.name}</h4>
                        <ul>
                          {ln.machines.map((m) => (
                            <li key={m.id}>
                              <span className="mono">{m.code}</span>
                              <span>{m.name}</span>
                              <em>{m.type}</em>
                              <b className={`admin-status ${m.status.toLowerCase().replace(/\s+/g, '-')}`}>
                                {m.status}
                              </b>
                            </li>
                          ))}
                          {!ln.machines.length ? <li className="muted">No machines</li> : null}
                        </ul>
                      </article>
                    ))}
                    {!dept.lines.length ? <p className="muted">No lines in this department</p> : null}
                  </div>
                </section>
              ))}
              {!orgTree.length ? (
                <div className="admin-card">
                  <p className="muted">No departments yet — add a site and department to start.</p>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === 'products' ? (
          <div className={`admin-layout${createOpen ? '' : ' browse-only'}`}>
            {createOpen ? (
              <div className="admin-create-col">
                <form className="admin-card" onSubmit={createProduct}>
                  <h3>Add product</h3>
                  <div className="admin-inline-2">
                    <div className="field">
                      <label>Code</label>
                      <input name="product_code" required placeholder="STO-240" />
                    </div>
                    <div className="field">
                      <label>UoM</label>
                      <input name="unit_of_measure" defaultValue="pcs" />
                    </div>
                  </div>
                  <div className="field">
                    <label>Name</label>
                    <input name="product_name" required placeholder="Garden Storage Box 240L" />
                  </div>
                  <div className="field">
                    <label>Ideal cycle (seconds)</label>
                    <input name="ideal_cycle_time" type="number" defaultValue={60} min={1} />
                  </div>
                  <button className="btn btn-primary" type="submit">
                    Add product
                  </button>
                </form>
              </div>
            ) : null}
            <div className="admin-browse-col">
              <div className="admin-product-grid">
                {products.map((p) => {
                  const cycle = Number(p.ideal_cycle_time || 60)
                  const hourly = cycle > 0 ? Math.round(3600 / cycle) : 0
                  return (
                    <article key={String(p.id)} className="admin-product-card">
                      <header>
                        <span className="mono">{String(p.product_code)}</span>
                        <em>{String(p.unit_of_measure || 'pcs')}</em>
                      </header>
                      <h3>{String(p.product_name)}</h3>
                      <div className="admin-product-meta">
                        <span>
                          <b>{cycle}s</b> cycle
                        </span>
                        <span>
                          <b>~{hourly}</b> / hr
                        </span>
                      </div>
                    </article>
                  )
                })}
                {!products.length ? <p className="muted">No products yet</p> : null}
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'users' ? (
          <div className={`admin-layout${createOpen ? '' : ' browse-only'}`}>
            {createOpen ? (
              <div className="admin-create-col">
                <form className="admin-card" onSubmit={createUser}>
                  <h3>Add user</h3>
                  <div className="field">
                    <label>Name</label>
                    <input name="name" required />
                  </div>
                  <div className="field">
                    <label>Email</label>
                    <input name="email" type="email" required />
                  </div>
                  <div className="field">
                    <label>Password</label>
                    <input name="password" type="password" required minLength={6} />
                  </div>
                  <div className="field">
                    <label>Role</label>
                    <select name="role_id" required>
                      {roles.map((r) => (
                        <option key={String(r.id)} value={String(r.id)}>
                          {String(r.role_name)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={!roles.length}>
                    Add user
                  </button>
                  {!roles.length ? (
                    <p className="muted">You may not have permission to manage users.</p>
                  ) : null}
                </form>
              </div>
            ) : null}
            <div className="admin-browse-col">
              <div className="admin-user-list">
                {users.map((u) => (
                  <article key={String(u.id)} className="admin-user-card">
                    <div className="admin-user-avatar">{String(u.name || '?').slice(0, 1).toUpperCase()}</div>
                    <div className="admin-user-meta">
                      <strong>{String(u.name)}</strong>
                      <span>{String(u.email)}</span>
                    </div>
                    <span className="admin-role-pill">{String(u.role_name || '—')}</span>
                    <span className={`admin-user-status ${(String(u.status) || '').toLowerCase()}`}>
                      {String(u.status || '—')}
                    </span>
                  </article>
                ))}
                {!users.length ? (
                  <div className="admin-card">
                    <p className="muted">No users listed (or insufficient permissions).</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'production' ? (
          <div className="admin-layout browse-only">
            <div className="admin-browse-col">
              <form className="admin-card admin-prod-form" onSubmit={recordProduction}>
                <h3>Manual production entry</h3>
                <p className="muted">
                  Posts a production record against a machine. Use for corrections or demo fills — live
                  station simulation still runs separately.
                </p>
                <div className="admin-inline-2">
                  <div className="field">
                    <label>Machine</label>
                    <select name="machine_id" required>
                      {machines.map((m) => (
                        <option key={String(m.id)} value={String(m.id)}>
                          {String(m.machine_code)} · {lineName(m.production_line_id)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Shift</label>
                    <select name="shift_id">
                      <option value="">None</option>
                      {shifts.map((s) => (
                        <option key={String(s.id)} value={String(s.id)}>
                          {String(s.shift_name)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="admin-inline-3">
                  <div className="field">
                    <label>Total</label>
                    <input name="total_units" type="number" required defaultValue={10} min={0} />
                  </div>
                  <div className="field">
                    <label>Good</label>
                    <input name="good_units" type="number" required defaultValue={9} min={0} />
                  </div>
                  <div className="field">
                    <label>Rejected</label>
                    <input name="rejected_units" type="number" defaultValue={1} min={0} />
                  </div>
                </div>
                <button className="btn btn-primary" type="submit">
                  Save production
                </button>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
