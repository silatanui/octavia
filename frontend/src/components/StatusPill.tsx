export function StatusPill({ status }: { status: string }) {
  const cls = status.replace(/\s+/g, '')
  return <span className={`status-pill status-${cls}`}>{status}</span>
}
