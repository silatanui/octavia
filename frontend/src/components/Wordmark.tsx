export function Wordmark({
  size = 'md',
  tone = 'light',
}: {
  size?: 'sm' | 'md' | 'lg'
  tone?: 'light' | 'dark'
}) {
  return (
    <span className={`wordmark wordmark-${size} wordmark-${tone}`} aria-label="Octavia">
      Octavia
    </span>
  )
}

const AVATAR_PALETTE = [
  { bg: '#f4ebe4', fg: '#a34a1c', border: '#e0cfc3' },
  { bg: '#e0f2f1', fg: '#0f766e', border: '#99d5cf' },
  { bg: '#e8eeeb', fg: '#1e2d2b', border: '#b7c4bf' },
  { bg: '#fff1e8', fg: '#c45c26', border: '#f0c9b0' },
  { bg: '#e6f0f6', fg: '#0369a1', border: '#9dc6df' },
  { bg: '#f8e8ec', fg: '#be123c', border: '#e8b4c0' },
  { bg: '#f3eee6', fg: '#7c5a3b', border: '#d4c4ae' },
  { bg: '#e7efec', fg: '#2f4541', border: '#a8bbb5' },
]

function hashName(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h
}

export function UserAvatar({
  name,
  size = 'sm',
  src,
  className = '',
}: {
  name?: string | null
  size?: 'sm' | 'md' | 'lg'
  src?: string | null
  className?: string
}) {
  const label = name || '?'
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('')
  const tone = AVATAR_PALETTE[hashName(label) % AVATAR_PALETTE.length]

  if (src) {
    return (
      <span
        className={`user-avatar user-avatar-${size} user-avatar-photo ${className}`.trim()}
        title={label}
        aria-label={label}
      >
        <img src={src} alt="" />
      </span>
    )
  }

  return (
    <span
      className={`user-avatar user-avatar-${size} ${className}`.trim()}
      title={label}
      aria-label={label}
      style={{ background: tone.bg, color: tone.fg, borderColor: tone.border }}
    >
      {initials || '?'}
    </span>
  )
}
