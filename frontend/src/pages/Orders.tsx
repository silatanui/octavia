import { useEffect, useState, type FormEvent } from 'react'
import { api, formatNum } from '../api'

export function Orders() {
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([])
  const [products, setProducts] = useState<Array<Record<string, unknown>>>([])
  const [machines, setMachines] = useState<Array<Record<string, unknown>>>([])
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    order_number: '',
    product_id: '',
    machine_id: '',
    planned_quantity: '100',
    status: 'Planned',
  })

  async function load() {
    const [o, p, m] = await Promise.all([
      api.get<Array<Record<string, unknown>>>('/work-orders'),
      api.get<Array<Record<string, unknown>>>('/admin/products'),
      api.get<Array<Record<string, unknown>>>('/machines'),
    ])
    setOrders(o)
    setProducts(p)
    setMachines(m)
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    try {
      await api.post('/work-orders', {
        order_number: form.order_number,
        product_id: Number(form.product_id),
        machine_id: form.machine_id ? Number(form.machine_id) : null,
        planned_quantity: Number(form.planned_quantity),
        status: form.status,
      })
      setForm({ ...form, order_number: '' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
  }

  return (
    <>
      <div className="topbar">
        <strong>Production Orders</strong>
        <span className="topbar-sub">Tanui work orders · planned vs actual qty</span>
      </div>
      <div className="page">
        <p className="page-lead">
          Create and track work orders by machine and product. Actual / good / reject quantities feed station
          pace and Daily Production achievement.
        </p>
        {error ? <div className="error">{error}</div> : null}
        <form className="panel form-grid" onSubmit={onCreate}>
          <h2 className="full" style={{ margin: 0 }}>
            New work order
          </h2>
          <div className="field">
            <label>Order number</label>
            <input
              required
              value={form.order_number}
              onChange={(e) => setForm({ ...form, order_number: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Product</label>
            <select
              required
              value={form.product_id}
              onChange={(e) => setForm({ ...form, product_id: e.target.value })}
            >
              <option value="">Select…</option>
              {products.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {String(p.product_code)} — {String(p.product_name)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Machine</label>
            <select value={form.machine_id} onChange={(e) => setForm({ ...form, machine_id: e.target.value })}>
              <option value="">Unassigned</option>
              {machines.map((m) => (
                <option key={String(m.id)} value={String(m.id)}>
                  {String(m.machine_code)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Planned qty</label>
            <input
              type="number"
              required
              value={form.planned_quantity}
              onChange={(e) => setForm({ ...form, planned_quantity: e.target.value })}
            />
          </div>
          <div className="full">
            <button className="btn btn-primary" type="submit">
              Create order
            </button>
          </div>
        </form>

        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Order</th>
                <th>Product</th>
                <th>Machine</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>Good</th>
                <th>Rejected</th>
                <th>Progress</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const planned = Number(o.planned_quantity || 0)
                const actual = Number(o.actual_quantity || 0)
                const pct = planned ? Math.min((actual / planned) * 100, 100) : 0
                const behind = o.status === 'In Progress' && planned > 0 && actual / planned < 0.7
                return (
                  <tr key={String(o.id)} style={behind ? { background: 'rgba(214,69,69,0.08)' } : undefined}>
                    <td className="mono">{String(o.order_number)}</td>
                    <td>{String(o.product_name || o.product_id)}</td>
                    <td>{String(o.machine_name || '—')}</td>
                    <td>{formatNum(planned)}</td>
                    <td>{formatNum(actual)}</td>
                    <td>{formatNum(o.good_quantity as number)}</td>
                    <td>{formatNum(o.rejected_quantity as number)}</td>
                    <td style={{ minWidth: 120 }}>
                      <div className="progress">
                        <span style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td>
                      {String(o.status)}
                      {behind ? ' · Behind' : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
