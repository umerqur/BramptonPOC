// Generic map-metric model for the NYC 311 workload map. The map used to shade
// and extrude geography by complaint volume only; this module makes the metric
// selectable, so the same polygons can be coloured and 3D-extruded by any of
// several operational metrics without the rendering code assuming "volume".
//
// This is NYC 311 public benchmark data — decision support only, never a risk
// prediction and never Brampton operational complaint data.

/** The selectable map metrics. Total complaints is the default. */
export type MapMetric =
  | 'total_requests'
  | 'open_backlog'
  | 'avg_closure_days'
  | 'p90_closure_days'
  | 'high_priority_open'

/**
 * One geography's metrics, joined to its polygon by `key`. `value` carries the
 * currently-selected metric's number for convenience; the individual fields are
 * kept so tooltips can show supporting context (e.g. total requests + backlog).
 * Closure-day fields are nullable: null means "no closed cases" → no-data grey.
 */
export type AreaMetricValue = {
  key: string
  label: string
  value: number
  total_requests?: number
  open_backlog?: number
  avg_closure_days?: number | null
  p90_closure_days?: number | null
  high_priority_open?: number
}

export type MetricConfig = {
  key: MapMetric
  /** Full control label, kept visible on mobile (no truncation). */
  label: string
  /** Heading used in the legend / detail panel. */
  title: string
  /** Unit noun appended to a formatted value, e.g. "complaints", "days". */
  unit: string
  /** Closure-day metrics can be null (no closed cases) → rendered as no data. */
  nullable: boolean
  /** Additive count metrics support a "share of total" line; rates do not. */
  additive: boolean
  /** Format a non-null value for display. */
  format: (v: number) => string
}

const int = (v: number) => Math.round(v).toLocaleString()
const days = (v: number) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} days`

export const DEFAULT_METRIC: MapMetric = 'total_requests'

export const MAP_METRICS: MetricConfig[] = [
  {
    key: 'total_requests',
    label: 'Total complaints',
    title: 'Total complaints',
    unit: 'complaints',
    nullable: false,
    additive: true,
    format: int,
  },
  {
    key: 'open_backlog',
    label: 'Open backlog',
    title: 'Open backlog',
    unit: 'open cases',
    nullable: false,
    additive: true,
    format: int,
  },
  {
    key: 'avg_closure_days',
    label: 'Avg closure days',
    title: 'Average closure days',
    unit: 'days',
    nullable: true,
    additive: false,
    format: days,
  },
  {
    key: 'p90_closure_days',
    label: 'P90 closure days',
    title: 'P90 closure days',
    unit: 'days',
    nullable: true,
    additive: false,
    format: days,
  },
  {
    key: 'high_priority_open',
    label: 'High priority open cases',
    title: 'High-priority open cases',
    unit: 'high-priority open cases',
    nullable: false,
    additive: true,
    format: int,
  },
]

const BY_KEY = new Map(MAP_METRICS.map((m) => [m.key, m]))

export function metricConfig(metric: MapMetric): MetricConfig {
  return BY_KEY.get(metric) ?? MAP_METRICS[0]
}

/**
 * The raw numeric value of a metric for one area, or null when the metric does
 * not apply (closure-day metrics with no closed cases) so the renderer can show
 * no-data grey instead of a misleading zero.
 */
export function metricRawValue(row: AreaMetricValue | undefined, metric: MapMetric): number | null {
  if (!row) return null
  switch (metric) {
    case 'total_requests':
      return row.total_requests ?? null
    case 'open_backlog':
      return row.open_backlog ?? null
    case 'avg_closure_days':
      return row.avg_closure_days ?? null
    case 'p90_closure_days':
      return row.p90_closure_days ?? null
    case 'high_priority_open':
      return row.high_priority_open ?? null
    default:
      return null
  }
}

/** Format a metric value with its unit, or a "no data" label when null. */
export function formatMetric(value: number | null, metric: MapMetric): string {
  if (value == null) return 'No data'
  const cfg = metricConfig(metric)
  return `${cfg.format(value)} ${cfg.unit}`.trim()
}
