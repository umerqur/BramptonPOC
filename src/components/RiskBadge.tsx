import type { Risk } from '../data/types'

const classes: Record<Risk, string> = {
  Low: 'badge-low',
  Medium: 'badge-medium',
  High: 'badge-high',
  Critical: 'badge-critical',
}

export default function RiskBadge({ risk }: { risk: Risk }) {
  return <span className={classes[risk]}>{risk}</span>
}
