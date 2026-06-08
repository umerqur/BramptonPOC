import { useEffect, useMemo, useState } from 'react'
import {
  getBramptonWardBoundaries,
  getTorontoWardBoundaries,
  getTorontoWardWorkload,
  type TorontoWardBoundary,
  type TorontoWardWorkload,
  type WardBoundary,
} from '../../services/municipalServiceRequests'

// Required disclaimer for the Toronto ward workload map. This is public Toronto
// 311 benchmark data used for decision support only — never Brampton operational
// complaint data, and never a final enforcement decision.
const WORKLOAD_DISCLAIMER =
  'Toronto 311 benchmark data, not Brampton operational data. Decision support only.'

// Longer-form context kept as supporting fine print. Wording is workload
// intensity (not risk) and makes clear this Toronto data is never plotted onto
// Brampton wards.
const WORKLOAD_CONTEXT =
  'Real City of Toronto ward polygons (City Wards open data) are shaded by real Toronto 311 benchmark complaint volume aggregated per ward from the loaded municipal service request records. Wards are shaded by complaint volume to show workload intensity — higher complaint volume means higher workload intensity. This is benchmark decision support only, not a risk prediction, and this Toronto geography and volume is never plotted onto Brampton wards.'

// Authenticated Toronto ward workload context. REAL City of Toronto ward
// polygons (City Wards open data) are the base layer of a single workload map,
// shaded by REAL Toronto 311 benchmark complaint volume aggregated per ward. The
// raw geometry-only preview and the real Brampton ward boundaries (kept only as
// future local context) are collapsed into accordions so the workload view is
// the first thing the user sees.
export default function AppTorontoWardContextPage() {
  const [wards, setWards] = useState<TorontoWardBoundary[]>([])
  const [loading, setLoading] = useState(true)
  // Hold the actual error message (or null) so we can surface the real Supabase
  // error instead of a generic "could not load" string.
  const [error, setError] = useState<string | null>(null)
  // Distinguish "query has not succeeded yet" from "query succeeded with 0 rows"
  // so we never render "0 Toronto wards" unless the load genuinely returned 0.
  const [loaded, setLoaded] = useState(false)
  // Real Toronto 311 per-ward workload counts (separate query, joined by ward number).
  const [workload, setWorkload] = useState<TorontoWardWorkload[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setLoaded(false)
    getTorontoWardBoundaries()
      .then((data) => {
        if (!active) return
        setWards(data)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (!active) return
        console.error('Failed to load Toronto ward boundaries:', err)
        setError(errorMessage(err))
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    getTorontoWardWorkload()
      .then((data) => active && setWorkload(data))
      .catch((err: unknown) => {
        // The workload counts are supplementary to the geometry; a failure here
        // must not break the page.
        console.error('Failed to load Toronto ward workload:', err)
        if (active) setWorkload([])
      })
    return () => {
      active = false
    }
  }, [])

  // Only report a count once the query has actually succeeded.
  const querySucceeded = loaded && !error

  return (
    <div className="container-page py-10">
      <div className="section-eyebrow">Benchmark Context</div>
      <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
        Toronto ward workload context
      </h1>
      <p className="mt-2 text-sm text-ink-muted max-w-3xl">
        Real City of Toronto ward boundaries (City Wards open data) provide the geographic base layer, shaded by real
        Toronto 311 benchmark complaint volume aggregated per ward to show ward-level workload intensity.
      </p>

      {error && (
        <div className="mt-6 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900">
          <div className="font-semibold">Could not load Toronto ward boundaries from Supabase.</div>
          <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-xs text-rose-800">{error}</pre>
        </div>
      )}

      {/* PRIMARY SECTION — real Toronto ward boundaries shaded by real Toronto 311 workload */}
      {!error && <TorontoWardWorkloadContext wards={wards} workload={workload} loading={loading} loaded={loaded} />}

      {/* Collapsed technical validation — the raw geometry map + ward metadata table */}
      {!error && (
        <DataLayerValidation wards={wards} loading={loading} loaded={loaded} querySucceeded={querySucceeded} />
      )}

      {/* Brampton ward boundaries kept ONLY as a future local-context layer */}
      <BramptonFutureContext />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Primary section: Toronto ward workload context
// ---------------------------------------------------------------------------

/** Workload-intensity color from lower (green) → higher (red) for a normalized value t in [0,1]. */
function heatColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  const hue = 140 - clamped * 128 // 140 green → 12 red, through amber
  return `hsl(${hue.toFixed(0)}, 78%, 52%)`
}

/** Workload-intensity tier label for a normalized value t in [0,1]. */
function workloadTier(t: number): string {
  if (t < 1 / 3) return 'Lower workload'
  if (t < 2 / 3) return 'Medium workload'
  return 'Higher workload'
}

/**
 * Unified workload-context map. The REAL Toronto ward polygons are the base
 * layer; the REAL Toronto 311 benchmark complaint volume shades them by workload
 * intensity. Ward labels render on every polygon, a low→high workload legend
 * sits beneath the map, and hovering/selecting a ward populates the
 * selected-ward detail panel.
 */
function TorontoWardWorkloadContext({
  wards,
  workload,
  loading,
  loaded,
}: {
  wards: TorontoWardBoundary[]
  workload: TorontoWardWorkload[]
  loading: boolean
  loaded: boolean
}) {
  const map = useMemo(() => buildTorontoWardMap(wards), [wards])

  // Index the real workload counts by ward number (1–25) so each polygon can
  // look up its own 311 volume by area_short_code.
  const byWard = useMemo(() => {
    const m = new Map<number, TorontoWardWorkload>()
    for (const w of workload) m.set(w.ward_number, w)
    return m
  }, [workload])

  const { min, max } = useMemo(() => {
    if (workload.length === 0) return { min: 0, max: 0 }
    const vols = workload.map((w) => w.complaint_volume)
    return { min: Math.min(...vols), max: Math.max(...vols) }
  }, [workload])

  const norm = (v: number) => (max > min ? (v - min) / (max - min) : 0.5)
  const num = (v: number) => v.toLocaleString()
  const workloadFor = (code: number | null | undefined): TorontoWardWorkload | undefined =>
    code == null ? undefined : byWard.get(code)
  const colorForWard = (code: number | null): string => {
    const w = workloadFor(code)
    return w ? heatColor(norm(w.complaint_volume)) : '#e2e8f0'
  }

  // Ward selected by click; ward currently hovered. The detail panel shows the
  // hovered ward first, then the clicked ward, then defaults to the busiest ward.
  const [selectedWard, setSelectedWard] = useState<number | null>(null)
  const [hoveredWard, setHoveredWard] = useState<number | null>(null)

  const sortedWorkload = useMemo(
    () => [...workload].sort((a, b) => b.complaint_volume - a.complaint_volume),
    [workload],
  )

  const activeWardCode = hoveredWard ?? selectedWard ?? sortedWorkload[0]?.ward_number ?? null
  const activeWorkload = workloadFor(activeWardCode)
  const activeShape = map?.shapes.find((s) => s.wardCode === activeWardCode) ?? null

  const hasWorkload = workload.length > 0

  return (
    <section aria-label="Toronto ward workload context" className="mt-6 card overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-navy-900">Ward workload intensity</div>
          <div className="text-xs text-ink-subtle">
            Real Toronto City Wards boundaries · real Toronto 311 benchmark volume
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-sky-800 sm:self-auto">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />
          Toronto 311 benchmark
        </span>
      </div>

      {/* Required disclaimer */}
      <div
        role="note"
        className="flex items-start gap-2 border-b border-sky-100 bg-sky-50/50 px-5 py-2.5 text-xs text-sky-900"
      >
        <span aria-hidden className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-sky-500" />
        <span>
          <span className="font-semibold">{WORKLOAD_DISCLAIMER}</span> {WORKLOAD_CONTEXT}
        </span>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-5">
        {/* Map: real Toronto boundaries shaded by real Toronto 311 volume */}
        <div className="lg:col-span-3">
          {map ? (
            <figure className="relative rounded-lg bg-gradient-to-br from-slate-50 to-sky-50 p-4">
              {/* Subtle grid backdrop for the map feel */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-lg opacity-[0.35]"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, rgba(15,23,42,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.06) 1px, transparent 1px)',
                  backgroundSize: '28px 28px',
                }}
              />
              <svg
                role="img"
                aria-label="Toronto ward boundaries shaded by real Toronto 311 complaint volume"
                viewBox={`0 0 ${map.width} ${map.height}`}
                className="relative mx-auto block h-auto w-full"
              >
                {map.shapes.map((shape) => {
                  const w = workloadFor(shape.wardCode)
                  const isActive = activeWardCode != null && shape.wardCode === activeWardCode
                  return (
                    <path
                      key={shape.id}
                      d={shape.d}
                      fill={colorForWard(shape.wardCode)}
                      fillOpacity={hasWorkload ? (isActive ? 0.92 : 0.72) : 0.4}
                      stroke={isActive ? '#0f172a' : '#1e3a5f'}
                      strokeWidth={isActive ? 2.25 : 1}
                      strokeLinejoin="round"
                      className="cursor-pointer transition-[fill-opacity]"
                      onMouseEnter={() => setHoveredWard(shape.wardCode)}
                      onMouseLeave={() => setHoveredWard(null)}
                      onClick={() => setSelectedWard(shape.wardCode)}
                    >
                      <title>
                        {shape.label} — Toronto 311 benchmark workload (not operational data, not a risk prediction)
                        {w
                          ? `\nWorkload intensity: ${workloadTier(norm(w.complaint_volume))}` +
                            `\nComplaint volume: ${num(w.complaint_volume)}` +
                            `\nOpen cases: ${num(w.open_cases)}` +
                            `\nIn progress: ${num(w.in_progress_cases)}` +
                            `\nClosed: ${num(w.closed_cases)}` +
                            (w.top_category ? `\nTop category: ${w.top_category}` : '')
                          : '\nNo Toronto 311 workload data'}
                      </title>
                    </path>
                  )
                })}
                {/* Ward labels */}
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

              {/* Legend — lower workload → higher workload */}
              <figcaption className="relative mt-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                  Workload intensity
                </div>
                <div
                  className="mt-1 h-2 rounded-full"
                  style={{
                    background: `linear-gradient(to right, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})`,
                  }}
                />
                <div className="mt-1 flex justify-between text-[11px] text-ink-subtle">
                  <span>Lower workload</span>
                  <span>Higher workload</span>
                </div>
                {hasWorkload && (
                  <div className="mt-0.5 flex justify-between text-[10px] text-ink-subtle tabular-nums">
                    <span>{num(min)} complaints</span>
                    <span>{num(max)} complaints</span>
                  </div>
                )}
                <div className="mt-2 text-[11px] text-ink-subtle">
                  Hover or select a ward to see its Toronto 311 workload detail.
                </div>
              </figcaption>
            </figure>
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center text-sm text-ink-subtle">
              {loading
                ? 'Loading Toronto ward boundaries…'
                : loaded
                  ? 'Ward geometry unavailable for the workload map.'
                  : 'Toronto ward boundaries unavailable.'}
            </div>
          )}
        </div>

        {/* Selected ward detail panel */}
        <div className="lg:col-span-2">
          <SelectedWardPanel
            workload={activeWorkload}
            wardLabel={activeShape?.label ?? activeWorkload?.ward_or_area ?? null}
            tier={activeWorkload ? workloadTier(norm(activeWorkload.complaint_volume)) : null}
            color={activeWorkload ? heatColor(norm(activeWorkload.complaint_volume)) : '#e2e8f0'}
            interactive={selectedWard != null}
            hasWorkload={hasWorkload}
          />
        </div>
      </div>
    </section>
  )
}

/** Detail panel for the hovered/selected ward, showing the real Toronto 311 workload. */
function SelectedWardPanel({
  workload,
  wardLabel,
  tier,
  color,
  interactive,
  hasWorkload,
}: {
  workload: TorontoWardWorkload | undefined
  wardLabel: string | null
  tier: string | null
  color: string
  interactive: boolean
  hasWorkload: boolean
}) {
  const num = (v: number) => v.toLocaleString()

  if (!hasWorkload) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-ink-subtle">
        Toronto 311 ward workload data is not available.
      </div>
    )
  }

  if (!workload) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-ink-subtle">
        Hover or select a ward on the map to see its Toronto 311 workload.
      </div>
    )
  }

  return (
    <div className="h-full rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            {interactive ? 'Selected ward' : 'Busiest ward (Toronto 311)'}
          </div>
          <div className="text-base font-semibold text-navy-900">{wardLabel || workload.ward_or_area}</div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-ink-muted">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          {tier}
        </span>
      </div>

      <div className="mt-3 text-2xl font-semibold text-navy-900 tabular-nums">{num(workload.complaint_volume)}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Toronto 311 complaint volume</div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Metric label="Open cases" value={num(workload.open_cases)} />
        <Metric label="In progress" value={num(workload.in_progress_cases)} />
        <Metric label="Closed" value={num(workload.closed_cases)} />
      </dl>

      {workload.top_category && (
        <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-subtle">Top category</span>
            <span className="font-medium text-navy-900">{workload.top_category}</span>
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
        Real Toronto 311 benchmark complaint volume — decision support only, not a risk prediction and not Brampton
        operational complaint data.
      </p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-navy-900 tabular-nums">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collapsed technical validation accordion (Toronto base layer)
// ---------------------------------------------------------------------------

/**
 * Small, collapsed-by-default accordion proving the real Toronto City Wards
 * boundary layer loaded. Holds the raw geometry-only preview map and the ward
 * metadata table so they no longer push the workload view below the fold.
 */
function DataLayerValidation({
  wards,
  loading,
  loaded,
  querySucceeded,
}: {
  wards: TorontoWardBoundary[]
  loading: boolean
  loaded: boolean
  querySucceeded: boolean
}) {
  const map = useMemo(() => buildTorontoWardMap(wards), [wards])
  const count = wards.length
  const summary = loading
    ? 'Loading Toronto wards from City Wards open data…'
    : querySucceeded
      ? `${count} Toronto ward${count === 1 ? '' : 's'} loaded from City Wards open data.`
      : 'Toronto ward layer unavailable.'

  return (
    <details className="group mt-8 card overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${querySucceeded && count > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`}
          />
          <div>
            <div className="text-sm font-semibold text-navy-900">Data layer validation</div>
            <div className="text-xs text-ink-subtle">{summary}</div>
          </div>
        </div>
        <span className="text-xs text-ink-subtle transition group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>

      <div className="border-t border-slate-100 px-5 py-4">
        <p className="text-xs text-ink-muted">
          Technical validation of the real City of Toronto ward geometry that backs the workload context map above. This
          is the raw boundary layer with no workload shading.
        </p>

        {/* Raw geometry-only preview */}
        {map ? (
          <figure className="relative mt-4 rounded-lg bg-gradient-to-br from-slate-50 to-sky-50 p-4">
            <svg
              role="img"
              aria-label="Toronto ward boundary preview (raw geometry)"
              viewBox={`0 0 ${map.width} ${map.height}`}
              className="mx-auto block h-auto w-full max-w-2xl"
            >
              {map.shapes.map((shape, i) => (
                <path
                  key={shape.id}
                  d={shape.d}
                  fill={WARD_FILLS[i % WARD_FILLS.length]}
                  fillOpacity={0.55}
                  stroke="#1e3a5f"
                  strokeWidth={1}
                  strokeLinejoin="round"
                >
                  <title>{shape.label}</title>
                </path>
              ))}
              {map.shapes.map((shape) => (
                <text
                  key={`v-label-${shape.id}`}
                  x={shape.cx}
                  y={shape.cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-navy-900"
                  style={{ fontSize: map.labelSize, fontWeight: 600, paintOrder: 'stroke' }}
                  stroke="#ffffff"
                  strokeWidth={map.labelSize / 4}
                >
                  {shape.short}
                </text>
              ))}
            </svg>
            <figcaption className="mt-3 text-center text-xs text-ink-subtle">
              {map.shapes.length} polygon{map.shapes.length === 1 ? '' : 's'} rendered from City Wards GeoJSON geometry.
            </figcaption>
          </figure>
        ) : (
          <div className="mt-4 flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-ink-subtle">
            {loading
              ? 'Loading ward boundary geometry…'
              : loaded
                ? 'No GeoJSON geometry available to preview.'
                : 'Ward boundary geometry unavailable.'}
          </div>
        )}

        {/* Ward metadata table */}
        {wards.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-ink-subtle">
                  <tr className="text-left">
                    <Th>Ward</Th>
                    <Th>Ward number</Th>
                    <Th>Source city</Th>
                    <Th>Source dataset</Th>
                    <Th>Boundary geometry</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {wards.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-navy-900">{w.ward_desc || w.ward_name}</td>
                      <td className="px-4 py-3 text-ink-muted">{w.area_short_code}</td>
                      <td className="px-4 py-3 text-ink-muted">{w.source_city || '—'}</td>
                      <td className="px-4 py-3 text-ink-muted">{w.source_dataset || '—'}</td>
                      <td className="px-4 py-3 text-ink-muted">
                        {w.geojson_geometry ? 'GeoJSON available' : 'Not available'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Brampton ward boundaries — future local context only
// ---------------------------------------------------------------------------

/**
 * Real Brampton GeoHub ward boundaries, kept ONLY as a future local-context
 * layer. This renders Brampton geometry alone — no Toronto 311 complaint volume
 * is ever plotted onto Brampton wards. It loads lazily when the accordion is
 * opened so it never competes with the primary Toronto workload view.
 */
function BramptonFutureContext() {
  const [open, setOpen] = useState(false)
  const [wards, setWards] = useState<WardBoundary[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || loaded || loading) return
    let active = true
    setLoading(true)
    setError(null)
    getBramptonWardBoundaries()
      .then((data) => {
        if (!active) return
        setWards(data)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (!active) return
        console.error('Failed to load Brampton ward boundaries:', err)
        setError(errorMessage(err))
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [open, loaded, loading])

  const map = useMemo(() => buildBramptonWardMap(wards), [wards])

  return (
    <details
      className="group mt-4 card overflow-hidden"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-slate-300" />
          <div>
            <div className="text-sm font-semibold text-navy-900">Brampton ward boundaries (future local context)</div>
            <div className="text-xs text-ink-subtle">
              Geometry only · no Toronto 311 data is plotted onto Brampton wards
            </div>
          </div>
        </div>
        <span className="text-xs text-ink-subtle transition group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>

      <div className="border-t border-slate-100 px-5 py-4">
        <p className="text-xs text-ink-muted">
          Real Brampton GeoHub electoral ward geometry, retained only as a future local-context layer for when Brampton
          provides its own operational complaint data. It is not part of the Toronto 311 benchmark workload view above,
          and Toronto complaint volume is never plotted onto these Brampton wards.
        </p>

        {error && (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900">
            <div className="font-semibold">Could not load Brampton ward boundaries.</div>
            <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-xs text-rose-800">{error}</pre>
          </div>
        )}

        {!error && map ? (
          <figure className="relative mt-4 rounded-lg bg-gradient-to-br from-slate-50 to-sky-50 p-4">
            <svg
              role="img"
              aria-label="Brampton ward boundary preview (geometry only, future local context)"
              viewBox={`0 0 ${map.width} ${map.height}`}
              className="mx-auto block h-auto w-full max-w-2xl"
            >
              {map.shapes.map((shape, i) => (
                <path
                  key={shape.id}
                  d={shape.d}
                  fill={WARD_FILLS[i % WARD_FILLS.length]}
                  fillOpacity={0.45}
                  stroke="#1e3a5f"
                  strokeWidth={1}
                  strokeLinejoin="round"
                >
                  <title>{shape.label}</title>
                </path>
              ))}
              {map.shapes.map((shape) => (
                <text
                  key={`b-label-${shape.id}`}
                  x={shape.cx}
                  y={shape.cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-navy-900"
                  style={{ fontSize: map.labelSize, fontWeight: 600, paintOrder: 'stroke' }}
                  stroke="#ffffff"
                  strokeWidth={map.labelSize / 4}
                >
                  {shape.short}
                </text>
              ))}
            </svg>
            <figcaption className="mt-3 text-center text-xs text-ink-subtle">
              {map.shapes.length} Brampton polygon{map.shapes.length === 1 ? '' : 's'} (future local context only).
            </figcaption>
          </figure>
        ) : (
          !error && (
            <div className="mt-4 flex min-h-[140px] items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-ink-subtle">
              {loading
                ? 'Loading Brampton ward geometry…'
                : loaded
                  ? 'No Brampton GeoJSON geometry available to preview.'
                  : 'Open to load Brampton ward geometry.'}
            </div>
          )
        )}
      </div>
    </details>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">{children}</th>
}

// ---------------------------------------------------------------------------
// GeoJSON → SVG helpers
// ---------------------------------------------------------------------------

const WARD_FILLS = [
  '#bfdbfe',
  '#bbf7d0',
  '#fde68a',
  '#fbcfe8',
  '#c7d2fe',
  '#a5f3fc',
  '#fed7aa',
  '#ddd6fe',
  '#bef264',
  '#fecaca',
]

type LngLat = [number, number]

type WardShape = {
  id: string
  label: string
  short: string
  /** Ward number (1–25) used to join real Toronto 311 workload counts. */
  wardCode: number | null
  d: string
  cx: number
  cy: number
}

type WardMap = {
  width: number
  height: number
  labelSize: number
  shapes: WardShape[]
}

/** A geometry-bearing entry ready to be projected into the shared SVG space. */
type MapEntry = {
  id: string
  label: string
  short: string
  wardCode: number | null
  rings: LngLat[][]
}

/**
 * Extracts polygon rings ([[lng,lat], ...]) from a value that may be a GeoJSON
 * geometry, Feature, FeatureCollection, or a JSON string of any of those.
 */
function extractRings(geometry: unknown): LngLat[][] {
  if (!geometry) return []
  let geo: any = geometry
  if (typeof geo === 'string') {
    try {
      geo = JSON.parse(geo)
    } catch {
      return []
    }
  }
  if (!geo || typeof geo !== 'object') return []
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

/**
 * Projects a set of geometry-bearing entries into a shared SVG coordinate space,
 * returning null when no usable geometry exists (so the caller can fall back to
 * the map placeholder). Shared by the Toronto and Brampton ward maps.
 */
function buildMap(entries: MapEntry[]): WardMap | null {
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

  // Correct longitude compression at this latitude so shapes aren't horizontally
  // stretched.
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

  const shapes: WardShape[] = usable.map((entry) => {
    const d = entry.rings
      .map((ring) => {
        const segs = ring.map(([lng, lat], i) => {
          const [x, y] = project(lng, lat)
          return `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`
        })
        return `${segs.join(' ')} Z`
      })
      .join(' ')

    // Label at the centroid of the largest ring.
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

    return {
      id: entry.id,
      label: entry.label,
      short: entry.short,
      wardCode: entry.wardCode,
      d,
      cx: fmt(cx),
      cy: fmt(cy),
    }
  })

  const labelSize = Math.max(9, Math.min(16, width / 48))
  return { width: fmt(width), height: fmt(height), labelSize, shapes }
}

/** Projects the real Toronto City Wards polygons into the shared SVG space. */
function buildTorontoWardMap(wards: TorontoWardBoundary[]): WardMap | null {
  const entries: MapEntry[] = wards.map((w, idx) => ({
    id: String(w.id ?? w.area_short_code ?? idx),
    label: w.ward_desc || w.ward_name || `Ward ${w.area_short_code}`,
    short: String(w.area_short_code),
    wardCode: Number.isFinite(w.area_short_code) ? w.area_short_code : null,
    rings: extractRings(w.geojson_geometry),
  }))
  return buildMap(entries)
}

/** Projects the real Brampton GeoHub ward polygons (future local context). */
function buildBramptonWardMap(wards: WardBoundary[]): WardMap | null {
  const entries: MapEntry[] = wards.map((w, idx) => ({
    id: String(w.id ?? idx),
    label: w.ward || `Ward ${w.objectid ?? w.id}`,
    short: shortBramptonLabel(w),
    wardCode: null,
    rings: extractRings(w.geojson_geometry),
  }))
  return buildMap(entries)
}

function shortBramptonLabel(ward: WardBoundary): string {
  if (ward.ward) {
    const digits = ward.ward.match(/\d+/)
    if (digits) return digits[0]
    return ward.ward.length > 6 ? ward.ward.slice(0, 6) : ward.ward
  }
  if (ward.objectid != null) return String(ward.objectid)
  return String(ward.id)
}

function errorMessage(err: unknown): string {
  if (err == null) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    const parts = [e.message, e.details, e.hint, e.code].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    if (parts.length > 0) return parts.join(' — ')
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}
