import type { ReactNode } from 'react'

type Props = {
  label: string
  value: ReactNode
  hint?: string
  trend?: { direction: 'up' | 'down' | 'flat'; text: string }
}

export default function StatCard({ label, value, hint, trend }: Props) {
  const trendColor =
    trend?.direction === 'up'
      ? 'text-red-700'
      : trend?.direction === 'down'
        ? 'text-accent-700'
        : 'text-ink-subtle'

  return (
    <div className="card p-5">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {(hint || trend) && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          {trend && <span className={`font-medium ${trendColor}`}>{trend.text}</span>}
          {hint && <span className="text-ink-subtle">{hint}</span>}
        </div>
      )}
    </div>
  )
}
