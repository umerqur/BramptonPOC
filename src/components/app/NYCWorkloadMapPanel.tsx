import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  getNYCBoroughBoundariesCached,
  getNYCCouncilDistrictBoundariesCached,
  getNYCMapMetricsByBoroughCached,
  getNYCMapMetricsByCouncilDistrictCached,
} from '../../services/municipalServiceRequests'
import { calmWorkloadCss } from './workloadColor'
import {
  DEFAULT_METRIC,
  MAP_METRICS,
  formatMetric,
  metricConfig,
  metricRawValue,
  type AreaMetricValue,
  type MapMetric,
} from './mapMetrics'

// The deck.gl 3D workload view is heavy, so it is code-split and only loaded when
// the user opens the 3D tab. The default 2D operational map never pulls deck.gl.
const NYCWorkload3DDeck = lazy(() => import('./NYCWorkload3DDeck'))

// NYC 311 workload heat map. Two geographic modes share one choropleth:
//   * Council district (default) — real NYC City Council district polygons, the
//     finer, ward-like operational unit.
//   * Borough — real NYC borough polygons, the broad executive overview.
// Both can be shaded/extruded by a SELECTED metric (total complaints, open
// backlog, average / P90 closure days, high-priority open cases) read live from
// Supabase. This is decision support only — never a risk prediction and never
// Toronto geometry. NYC has no wards: boroughs are too broad to stand in for a
// Brampton/Toronto ward, so council districts are the ward-like view. There is no
// hardcoded fallback: if the aggregate cannot be loaded the map shades nothing and
// shows a clear "Live data unavailable" notice. Each mode is shaded relative to its
// own geography level AND the selected metric, so the views are not directly
// comparable — the UI states this.

type MapMode = 'district' | 'borough'

/** A geographic area to draw: a borough or a council district. */
export type AreaUnit = { id: string; key: string; label: string; short: string; geometry: unknown }

/** Case-insensitive borough key for joining metrics to geometry. */
const boroughKey = (name: string) => name.trim().toLowerCase()

type ModeAdapter = {
  /** Short tab label. */
  toggleLabel: string
  /** Singular noun for an area in this mode, e.g. "council district". */
  unitLabel: string
  /** Short helper under the title. */
  helper: string
  /** Side-card heading for the highest area in this mode. */
  cardLabel: string
  loadUnits: () => Promise<AreaUnit[]>
  loadMetrics: () => Promise<AreaMetricValue[]>
}

// Each mode is shaded RELATIVE to its own geography level and the selected metric
// — district red means "highest district for this metric", borough red means
// "highest borough for this metric". The views are not directly comparable.
const SCALE_NOTE = 'Each map uses its own scale because districts and boroughs are different geographic levels.'

/** Map a normalized metric row from the service into an AreaMetricValue. */
function toAreaMetric(
  key: string,
  label: string,
  r: {
    total_requests: number
    open_backlog: number
    avg_closure_days: number | null
    p90_closure_days: number | null
    high_priority_open: number
  },
): AreaMetricValue {
  return {
    key,
    label,
    value: r.total_requests,
    total_requests: r.total_requests,
    open_backlog: r.open_backlog,
    avg_closure_days: r.avg_closure_days,
    p90_closure_days: r.p90_closure_days,
    high_priority_open: r.high_priority_open,
  }
}

const ADAPTERS: Record<MapMode, ModeAdapter> = {
  district: {
    toggleLabel: 'Council districts',
    unitLabel: 'council district',
    helper: 'Operational view by NYC council district.',
    cardLabel: 'Highest council district',
    async loadUnits() {
      const districts = await getNYCCouncilDistrictBoundariesCached()
      return districts.map((d) => ({
        id: String(d.id),
        key: String(d.council_district),
        label: `District ${d.council_district}`,
        short: d.short_label,
        geometry: d.geojson_geometry,
      }))
    },
    async loadMetrics() {
      const rows = await getNYCMapMetricsByCouncilDistrictCached()
      return rows.map((r) => toAreaMetric(r.area, `District ${r.area}`, r))
    },
  },
  borough: {
    toggleLabel: 'Boroughs',
    unitLabel: 'borough',
    helper: 'Executive overview by NYC borough.',
    cardLabel: 'Highest borough',
    async loadUnits() {
      const boroughs = await getNYCBoroughBoundariesCached()
      return boroughs.map((b, idx) => ({
        id: String(b.id ?? idx),
        key: boroughKey(b.borough_name),
        label: b.borough_name,
        short: b.short_label || b.borough_name,
        geometry: b.geojson_geometry,
      }))
    },
    async loadMetrics() {
      const rows = await getNYCMapMetricsByBoroughCached()
      return rows.map((r) => toAreaMetric(boroughKey(r.area), r.area, r))
    },
  },
}

/**
 * The NYC 311 workload heat map. Defaults to the ward-like council district view
 * and the Total complaints metric. Offers a geography toggle (district/borough)
 * and a metric toggle. Loads the bundled geometry for the active mode plus the
 * per-area metric aggregates, then renders an interactive choropleth shaded by the
 * selected metric.
 */
export default function NYCWorkloadMapPanel({
  onSelectArea,
}: {
  /** Fired when an area is clicked: district number (district mode) or borough
   *  label (borough mode), for case drilldown into the Case Explorer. */
  onSelectArea?: (mode: MapMode, value: string) => void
} = {}) {
  const [mode, setMode] = useState<MapMode>('district')
  // Selected metric persists across geography toggles. Total complaints default.
  const [metric, setMetric] = useState<MapMetric>(DEFAULT_METRIC)
  // Guard: a metric whose backing view is not populated yet ("Coming soon") can
  // never become the selected metric, even if a stale call slips through.
  const selectMetric = (next: MapMetric) => {
    if (metricConfig(next).available) setMetric(next)
  }
  const [units, setUnits] = useState<AreaUnit[]>([])
  const [rows, setRows] = useState<AreaMetricValue[]>([])
  // Set when the live aggregate cannot be loaded from Supabase. No hardcoded
  // sample is ever substituted — the map shows a clear notice instead.
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let active = true
    const adapter = ADAPTERS[mode]
    setUnits([])
    setRows([])
    setUnavailable(false)

    // Load geometry + metric aggregates together so a mode switch is one combined
    // load instead of two separate chains. Both are cached for the session, so
    // repeat visits resolve instantly. The geometry loader catches its own error
    // (bundled data — should not fail) so a metrics failure never blanks the map
    // geometry, and a metrics failure still surfaces the unavailable state. No fake
    // fallback is ever substituted.
    Promise.all([
      adapter.loadUnits().catch((err: unknown) => {
        console.error('Failed to load NYC area boundaries:', err)
        return [] as AreaUnit[]
      }),
      adapter.loadMetrics().then(
        (data) => ({ ok: true as const, data }),
        (err: unknown) => {
          console.error('Failed to load NYC map metrics from Supabase:', err)
          return { ok: false as const, data: [] as AreaMetricValue[] }
        },
      ),
    ]).then(([unitData, metrics]) => {
      if (!active) return
      setUnits(unitData)
      setRows(metrics.data)
      setUnavailable(!metrics.ok || metrics.data.length === 0)
    })

    return () => {
      active = false
    }
  }, [mode])

  return (
    <NYCWorkloadHeatMap
      key={mode}
      mode={mode}
      onModeChange={setMode}
      metric={metric}
      onMetricChange={selectMetric}
      units={units}
      rows={rows}
      unavailable={unavailable}
      onSelectArea={onSelectArea}
    />
  )
}

// ---------------------------------------------------------------------------
// Heat map
// ---------------------------------------------------------------------------

/** Intensity color from lower (green) → higher (red) for t in [0,1]. */
function heatColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  const hue = 140 - clamped * 128 // 140 green → 12 red, through amber
  return `hsl(${hue.toFixed(0)}, 78%, 52%)`
}

/** Intensity tier label for a normalized value t in [0,1]. */
function intensityTier(t: number): string {
  if (t < 1 / 3) return 'Low'
  if (t < 2 / 3) return 'Medium'
  return 'High'
}

/** No-data grey for areas with no value for the selected metric. */
const NO_DATA_FILL = '#e2e8f0'

/** Supporting-context lines for a row, excluding the selected metric. */
function supportingContext(row: AreaMetricValue | undefined, metric: MapMetric): string[] {
  if (!row) return []
  const lines: string[] = []
  if (metric !== 'total_requests' && row.total_requests != null) {
    lines.push(`Total requests: ${row.total_requests.toLocaleString()}`)
  }
  if (metric !== 'open_backlog' && row.open_backlog != null) {
    lines.push(`Open backlog: ${row.open_backlog.toLocaleString()}`)
  }
  return lines
}

// A small segmented toggle: visible cards (not a native select), full label text
// kept on one line and wrapping to a new row on mobile rather than truncating.
// Options can be `disabled` — rendered non-interactive with a small "Coming soon"
// note — for metrics whose backing view is not populated yet.
function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string; disabled?: boolean }>
  onChange: (value: T) => void
}) {
  const hasComingSoon = options.some((o) => o.disabled)
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const selected = o.value === value
          if (o.disabled) {
            return (
              <span
                key={o.value}
                aria-disabled
                title="Coming soon"
                className="inline-flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-400"
              >
                {o.label}
                <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                  Soon
                </span>
              </span>
            )
          }
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition ${
                selected
                  ? 'border-teal-500 bg-teal-50 text-navy-900 ring-1 ring-teal-500'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-navy-900'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {hasComingSoon && (
        <span className="text-[10px] text-ink-subtle">
          Coming soon — total complaints is live now. Backlog and closure metrics require the next aggregate refresh.
        </span>
      )}
    </div>
  )
}

function NYCWorkloadHeatMap({
  mode,
  onModeChange,
  metric,
  onMetricChange,
  units,
  rows,
  unavailable,
  onSelectArea,
}: {
  mode: MapMode
  onModeChange: (mode: MapMode) => void
  metric: MapMetric
  onMetricChange: (metric: MapMetric) => void
  units: AreaUnit[]
  rows: AreaMetricValue[]
  unavailable: boolean
  onSelectArea?: (mode: MapMode, value: string) => void
}) {
  const adapter = ADAPTERS[mode]
  const cfg = metricConfig(metric)
  const map = useMemo(() => buildAreaMap(units), [units])

  // Index metric rows by area key.
  const byArea = useMemo(() => {
    const m = new Map<string, AreaMetricValue>()
    for (const r of rows) m.set(r.key, r)
    return m
  }, [rows])

  const rowForKey = (key: string | null): AreaMetricValue | undefined =>
    key == null ? undefined : byArea.get(key)
  const valueForKey = (key: string | null): number | null => metricRawValue(rowForKey(key), metric)

  // Min/max over the selected metric's non-null values, for relative shading.
  const { min, max } = useMemo(() => {
    const vals = rows.map((r) => metricRawValue(r, metric)).filter((v): v is number => v != null)
    if (vals.length === 0) return { min: 0, max: 0 }
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }, [rows, metric])

  const norm = (v: number) => (max > min ? (v - min) / (max - min) : 0.5)
  const colorForKey = (key: string | null): string => {
    const v = valueForKey(key)
    return v == null ? NO_DATA_FILL : heatColor(norm(v))
  }

  // Area selected by click; area currently hovered. The detail panel shows the
  // hovered area first, then the clicked area, then the highest.
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  // Visual mode: the 2D choropleth is the default operational view; the 3D view
  // is a secondary, exploratory extrusion. Independent of geography + metric.
  const [view, setView] = useState<'2d' | '3d'>('2d')

  // Highest area for the selected metric (nulls last) — the default focus.
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = metricRawValue(a, metric)
      const bv = metricRawValue(b, metric)
      if (av == null) return bv == null ? 0 : 1
      if (bv == null) return -1
      return bv - av
    })
  }, [rows, metric])

  const busiestKey = sortedRows.find((r) => metricRawValue(r, metric) != null)?.key ?? null
  const activeKey = hovered ?? selected ?? busiestKey
  const activeRow = rowForKey(activeKey)
  const activeValue = valueForKey(activeKey)
  const activeShape = map?.shapes.find((s) => s.key === activeKey) ?? null
  const activeLabel = activeShape?.label ?? activeRow?.label ?? null

  const hasRows = rows.length > 0
  const hasMetricValues = max > 0 || min > 0 || rows.some((r) => metricRawValue(r, metric) != null)
  const banner =
    mode === 'district'
      ? `Operational view. Shows live ${cfg.title.toLowerCase()} by NYC council district.`
      : `Executive view. Shows live ${cfg.title.toLowerCase()} by NYC borough.`

  return (
    <section aria-label="NYC 311 workload map" className="mt-6 card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-navy-900">Service request workload map</div>
          <div className="text-xs text-ink-subtle">{adapter.helper}</div>
        </div>
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-sky-800 sm:self-auto">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />
          {unavailable ? 'Live data unavailable' : 'Live data'}
        </span>
      </div>

      {/* Controls: visible segmented cards for Geography + Metric, plus the 2D/3D
          switch. Stacks on mobile with full labels kept readable. */}
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-3.5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:gap-6">
            <SegmentedControl
              label="Geography"
              value={mode}
              onChange={onModeChange}
              options={[
                { value: 'district', label: 'Council districts' },
                { value: 'borough', label: 'Boroughs' },
              ]}
            />
            <SegmentedControl
              label="Metric"
              value={metric}
              onChange={onMetricChange}
              options={MAP_METRICS.map((m) => ({ value: m.key, label: m.label, disabled: !m.available }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">View</span>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
              <button
                type="button"
                onClick={() => setView('2d')}
                className={view === '2d' ? 'text-navy-900' : 'text-slate-500'}
              >
                2D map
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={view === '3d'}
                aria-label="Toggle 3D workload view"
                onClick={() => setView(view === '2d' ? '3d' : '2d')}
                className={`relative h-6 w-11 rounded-full transition ${
                  view === '3d' ? 'bg-teal-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                    view === '3d' ? 'left-5' : 'left-0.5'
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={() => setView('3d')}
                className={view === '3d' ? 'text-navy-900' : 'text-slate-500'}
              >
                3D
              </button>
            </div>
          </div>
        </div>
        <span className="text-[11px] leading-relaxed text-ink-subtle">{SCALE_NOTE}</span>
      </div>

      {/* Short mode banner */}
      <div className="flex items-center gap-2 border-b border-sky-100 bg-sky-50/50 px-5 py-2.5 text-xs text-sky-900">
        <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-sky-500" />
        {banner}
      </div>

      {unavailable && (
        <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-5 py-2 text-[11px] text-amber-900">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          Live data unavailable. Unable to load the {adapter.unitLabel} metric aggregate.
        </div>
      )}

      <div className="grid gap-6 p-5 lg:grid-cols-5">
        {/* Map: real NYC polygons shaded by the selected metric */}
        <div className="lg:col-span-3">
          {map ? (
            <figure className="relative rounded-lg bg-gradient-to-br from-slate-50 to-sky-50 p-4">
              {view === '2d' && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-lg opacity-[0.35]"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, rgba(15,23,42,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.06) 1px, transparent 1px)',
                    backgroundSize: '28px 28px',
                  }}
                />
              )}

              {view === '2d' ? (
                <svg
                  role="img"
                  aria-label={`NYC ${adapter.unitLabel} boundaries shaded by ${cfg.title}`}
                  viewBox={`0 0 ${map.width} ${map.height}`}
                  className="relative mx-auto block h-auto w-full"
                >
                  {map.shapes.map((shape) => {
                    const v = valueForKey(shape.key)
                    const row = rowForKey(shape.key)
                    const isActive = activeKey != null && shape.key === activeKey
                    const context = supportingContext(row, metric)
                    return (
                      <path
                        key={shape.id}
                        d={shape.d}
                        fill={colorForKey(shape.key)}
                        fillOpacity={hasRows ? (isActive ? 0.92 : 0.72) : 0.4}
                        stroke={isActive ? '#0f172a' : '#1e3a5f'}
                        strokeWidth={isActive ? 2.25 : map.shapes.length > 20 ? 0.6 : 1}
                        strokeLinejoin="round"
                        className="cursor-pointer transition-[fill-opacity]"
                        onMouseEnter={() => setHovered(shape.key)}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => {
                          setSelected(shape.key)
                          // A click also opens the Case Explorer for that area:
                          // district number in district mode, borough label in borough mode.
                          onSelectArea?.(mode, mode === 'district' ? shape.key : shape.label)
                        }}
                      >
                        <title>
                          {shape.label} — New York City 311 public benchmark (not a risk prediction)
                          {row
                            ? `\n${cfg.title}: ${formatMetric(v, metric)}` +
                              (v != null ? `\nIntensity: ${intensityTier(norm(v))}` : '') +
                              (context.length ? `\n${context.join('\n')}` : '')
                            : '\nNo NYC 311 data for this area'}
                        </title>
                      </path>
                    )
                  })}
                  {/* Area labels */}
                  {map.shapes.map((shape) => (
                    <text
                      key={`label-${shape.id}`}
                      x={shape.cx}
                      y={shape.cy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="pointer-events-none fill-navy-900"
                      style={{ fontSize: map.labelSize, fontWeight: 700, paintOrder: 'stroke' }}
                      stroke="#ffffff"
                      strokeWidth={map.labelSize / 3.5}
                    >
                      {shape.short}
                    </text>
                  ))}
                </svg>
              ) : (
                <Suspense
                  fallback={
                    <div className="relative flex h-[320px] w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/60 text-sm text-ink-subtle sm:h-[440px]">
                      Loading 3D workload view…
                    </div>
                  }
                >
                  <NYCWorkload3DDeck
                    units={units}
                    values={rows}
                    metric={metric}
                    min={min}
                    max={max}
                    unitLabel={adapter.unitLabel}
                    activeKey={activeKey}
                    mode={mode}
                    onHover={setHovered}
                    onSelect={(key, label) => {
                      setSelected(key)
                      onSelectArea?.(mode, mode === 'district' ? key : label)
                    }}
                  />
                </Suspense>
              )}

              {/* Legend — shared by both views, relative to the geography level and metric */}
              <figcaption className="relative mt-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                    {cfg.title}
                  </span>
                  <span className="text-[10px] text-ink-subtle">Low to High for the selected metric</span>
                </div>
                <div
                  className="mt-1 h-2 rounded-full"
                  style={{
                    background:
                      view === '3d'
                        ? `linear-gradient(to right, ${calmWorkloadCss(0)}, ${calmWorkloadCss(0.4)}, ${calmWorkloadCss(0.72)}, ${calmWorkloadCss(1)})`
                        : `linear-gradient(to right, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})`,
                  }}
                />
                <div className="mt-1 flex justify-between text-[11px] text-ink-subtle">
                  <span>Low</span>
                  <span>Medium</span>
                  <span>High</span>
                  {view === '3d' && <span>Highest</span>}
                </div>
                {hasMetricValues && (
                  <div className="mt-0.5 text-center text-[10px] text-ink-subtle tabular-nums">
                    {cfg.format(min)} to {cfg.format(max)} {cfg.unit}
                  </div>
                )}
                <div className="mt-2 text-[11px] text-ink-subtle">
                  Height and color are relative to the selected geography and selected metric.
                  {view === '3d'
                    ? ' Heights are scaled for readability and are not physical measurements.'
                    : ` Hover or select a ${adapter.unitLabel} to see its detail.`}
                </div>
              </figcaption>
            </figure>
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center text-sm text-ink-subtle">
              Loading NYC {adapter.unitLabel} boundaries…
            </div>
          )}
        </div>

        {/* Selected area detail panel */}
        <div className="lg:col-span-2">
          <SelectedAreaPanel
            unitLabel={adapter.unitLabel}
            cardLabel={adapter.cardLabel}
            metric={metric}
            row={activeRow}
            value={activeValue}
            areaLabel={activeLabel}
            tier={activeValue != null ? intensityTier(norm(activeValue)) : null}
            color={activeValue != null ? heatColor(norm(activeValue)) : NO_DATA_FILL}
            interactive={selected != null || hovered != null}
            hasRows={hasRows}
          />
        </div>
      </div>

      <div className="border-t border-slate-100 px-5 py-3 text-[11px] text-ink-subtle">
        <span className="font-semibold text-ink-muted">Supervisor decision support.</span> Where{' '}
        {cfg.title.toLowerCase()} is concentrated by {adapter.unitLabel} — input for staffing and routing review. Not a
        risk prediction.
      </div>
    </section>
  )
}

/** Detail panel for the hovered/selected area, or the highest area by default. */
function SelectedAreaPanel({
  unitLabel,
  cardLabel,
  metric,
  row,
  value,
  areaLabel,
  tier,
  color,
  interactive,
  hasRows,
}: {
  unitLabel: string
  cardLabel: string
  metric: MapMetric
  row: AreaMetricValue | undefined
  value: number | null
  areaLabel: string | null
  tier: string | null
  color: string
  interactive: boolean
  hasRows: boolean
}) {
  const cfg = metricConfig(metric)

  if (!hasRows) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-ink-subtle">
        Metric data is not available.
      </div>
    )
  }

  if (!row) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-ink-subtle">
        Hover or select a {unitLabel} on the map to see its {cfg.title.toLowerCase()}.
      </div>
    )
  }

  const context = supportingContext(row, metric)

  return (
    <div className="h-full rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            {interactive ? `Selected ${unitLabel}` : cardLabel}
          </div>
          <div className="text-2xl font-semibold text-navy-900">{areaLabel || row.label}</div>
        </div>
        {tier && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-ink-muted">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            {tier}
          </span>
        )}
      </div>

      <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{cfg.title}</div>
      <div className="text-base font-semibold text-navy-900 tabular-nums">{formatMetric(value, metric)}</div>

      {context.length > 0 && (
        <dl className="mt-3 space-y-1 text-[11px] text-ink-subtle">
          {context.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </dl>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
        Live NYC 311 benchmark data — relative to the selected geography level and metric.
      </p>
    </div>
  )
}


// ---------------------------------------------------------------------------
// GeoJSON → SVG helpers
// ---------------------------------------------------------------------------

type LngLat = [number, number]

type AreaShape = {
  id: string
  label: string
  short: string
  /** Area key used to join the metric rows. */
  key: string
  d: string
  cx: number
  cy: number
}

type AreaMap = {
  width: number
  height: number
  labelSize: number
  shapes: AreaShape[]
}

type MapEntry = {
  id: string
  label: string
  short: string
  key: string
  rings: LngLat[][]
}

/**
 * Extracts polygon rings ([[lng,lat], ...]) from a value that may be a GeoJSON
 * geometry, Feature, FeatureCollection, or a JSON string of any of those.
 */
function extractRings(geometry: unknown): LngLat[][] {
  if (!geometry) return []
  let parsed: unknown = geometry
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return []
    }
  }
  if (!parsed || typeof parsed !== 'object') return []
  const geo = parsed as { type?: string; geometry?: unknown; features?: unknown; coordinates?: unknown }
  if (geo.type === 'Feature') return extractRings(geo.geometry)
  if (geo.type === 'FeatureCollection' && Array.isArray(geo.features)) {
    return geo.features.flatMap((f: unknown) => extractRings(f))
  }

  const rings: LngLat[][] = []
  const pushPolygon = (coords: unknown) => {
    if (!Array.isArray(coords)) return
    for (const ring of coords) {
      if (Array.isArray(ring) && ring.length > 0 && Array.isArray(ring[0])) {
        const pts = (ring as unknown[])
          .map((p) => {
            const pair = p as unknown[]
            return [Number(pair[0]), Number(pair[1])] as LngLat
          })
          .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
        if (pts.length > 2) rings.push(pts)
      }
    }
  }

  if (geo.type === 'Polygon') {
    pushPolygon(geo.coordinates)
  } else if (geo.type === 'MultiPolygon' && Array.isArray(geo.coordinates)) {
    for (const poly of geo.coordinates) pushPolygon(poly)
  }
  return rings
}

/** Projects geometry-bearing entries into a shared SVG coordinate space. */
function buildMap(entries: MapEntry[]): AreaMap | null {
  const usable = entries.filter((e) => e.rings.length > 0)
  if (usable.length === 0) return null

  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const { rings } of usable) {
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }
  }

  // Correct longitude compression at this latitude so shapes aren't stretched.
  const latMid = (minLat + maxLat) / 2
  const cos = Math.cos((latMid * Math.PI) / 180) || 1
  const spanX = Math.max((maxLng - minLng) * cos, 1e-9)
  const spanY = Math.max(maxLat - minLat, 1e-9)

  const pad = 14
  const targetW = 760
  const scale = targetW / spanX
  const width = spanX * scale + pad * 2
  const height = spanY * scale + pad * 2

  const project = (lng: number, lat: number): LngLat => [
    (lng - minLng) * cos * scale + pad,
    (maxLat - lat) * scale + pad,
  ]

  const fmt = (n: number) => Math.round(n * 100) / 100

  const shapes: AreaShape[] = usable.map((entry) => {
    const d = entry.rings
      .map((ring) => {
        const segs = ring.map(([lng, lat], i) => {
          const [x, y] = project(lng, lat)
          return `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`
        })
        return `${segs.join(' ')} Z`
      })
      .join(' ')

    // Label centroid from the largest ring (mean of its projected vertices).
    const largest = entry.rings.reduce((a, b) => (b.length > a.length ? b : a), entry.rings[0])
    let sx = 0
    let sy = 0
    for (const [lng, lat] of largest) {
      const [x, y] = project(lng, lat)
      sx += x
      sy += y
    }
    const cx = sx / largest.length
    const cy = sy / largest.length

    return { id: entry.id, label: entry.label, short: entry.short, key: entry.key, d, cx: fmt(cx), cy: fmt(cy) }
  })

  // Smaller labels when there are many areas (e.g. 51 council districts).
  const baseLabel = Math.max(9, Math.min(16, width / 48))
  const labelSize = shapes.length > 20 ? Math.max(6.5, baseLabel * 0.62) : baseLabel
  return { width: fmt(width), height: fmt(height), labelSize, shapes }
}

/** Projects the real NYC area polygons into the shared SVG space. */
function buildAreaMap(units: AreaUnit[]): AreaMap | null {
  const entries: MapEntry[] = units.map((u, idx) => ({
    id: u.id || String(idx),
    label: u.label,
    short: u.short || u.label,
    key: u.key,
    rings: extractRings(u.geometry),
  }))
  return buildMap(entries)
}
