/** Compact line icons for sidebar / navbar */

import type { ReactNode } from 'react'

type IconProps = { className?: string }

function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function IconDashboard({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="8" height="8" />
      <rect x="13" y="3" width="8" height="5" />
      <rect x="13" y="10" width="8" height="11" />
      <rect x="3" y="13" width="8" height="8" />
    </Svg>
  )
}

export function IconMachines({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="7" width="18" height="12" />
      <path d="M7 7V5h4v2M15 11h4M15 15h4M7 11h4M7 15h4" />
    </Svg>
  )
}

export function IconOrders({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 4h11l2 4v12H5V8l2-4z" />
      <path d="M5 8h16M9 12h6M9 16h8" />
    </Svg>
  )
}

export function IconDowntime({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </Svg>
  )
}

export function IconQuality({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  )
}

export function IconReports({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
    </Svg>
  )
}

export function IconAnalysis({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
    </Svg>
  )
}

export function IconAlerts({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 4l8 14H4L12 4z" />
      <path d="M12 10v4M12 16h.01" />
    </Svg>
  )
}

export function IconAdmin({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19c1.5-3 4-4.5 7-4.5S17.5 16 19 19" />
    </Svg>
  )
}

export function IconSearch({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="M15 15l4.5 4.5" />
    </Svg>
  )
}

export function IconPlant({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 20V10l4-4h8l4 4v10" />
      <path d="M9 20v-6h6v6M12 6V3" />
    </Svg>
  )
}

export function IconStaffing({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="2.5" />
      <circle cx="16" cy="8" r="2.5" />
      <path d="M3 18c.8-2.4 2.4-3.5 5-3.5S12.2 15.6 13 18" />
      <path d="M11 18c.8-2.4 2.4-3.5 5-3.5S21.2 15.6 22 18" />
    </Svg>
  )
}
