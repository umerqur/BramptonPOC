import { useEffect, useMemo, useState } from 'react'
import {
  getNYCBoroughBoundaries,
  getNYCWorkloadByBorough,
  mockNYCWorkloadByBorough,
  type NYCBoroughBoundary,
  type NYCBoroughWorkload,
} from '../../services/municipalServiceRequests'

// NYC 311 workload heat map. Real NYC borough polygons (NYC Open Data — Borough
// Boundaries) are the geographic base layer, shaded by real NYC 311 benchmark
// complaint volume aggregated per borough. This is decision support only — never
// Brampton operational data, never a risk prediction, and never Toronto geometry.
// The map is the whole panel: no AI workflow content lives here.

// Required disclaimer for the NYC 311 workload map.
const WORKLOAD_DISCLAIMER =
  'NYC 311 benchmark data, not Brampton operational data. Decision support only.'

// Supporting fine print. Wording is workload intensity (not risk), and it makes
// clear this NYC data is never plotted onto Brampton geography.
const WORKLOAD_CONTEXT =
  'Real NYC borough boundaries are shaded by real NYC 311 benchmark complaint volume aggregated per borough. Boroughs with higher complaint volume show higher workload intensity. This is benchmark decision support only — not a risk prediction — and this NYC geography and volume is never plotted onto Brampton wards.'

/**
 * The NYC 311 workload heat map. Loads the bundled NYC borough geometry and the
 * per-borough NYC 311 workload counts, then renders an interactive choropleth
 * shaded by workload intensity with a borough detail panel.
 */
export default function NYCWorkloadMapPanel() {
  const [boroughs, setBoroughs] = useState<NYCBoroughBoundary[]>([])
  const [workload, setWorkload] = useState<NYCBoroughWorkload[]>([])
  // Whether the per-borough volume came from the benchmark sample (Supabase view
  // unavailable) rather than the live aggregation.
  const [workloadFallback, setWorkloadFallback] = useState(false)

  useEffect(() => {
    let active = true
    getNYCBoroughBoundaries()
      .then((data) => active && setBoroughs(data))
      .catch((err: unknown) => {
        // The geometry is bundled, so this should not fail; log and continue.
        console.error('Failed to load NYC borough boundaries:', err)
        if (active) setBoroughs([])
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    getNYCWorkloadByBorough()
      .then((data) => {
        if (!active) return
        if (data.length === 0) {
          setWorkload(mockNYCWorkloadByBorough())
          setWorkloadFallback(true)
        } else {
          setWorkload(data)
          setWorkloadFallback(false)
        }
      })
      .catch((err: unknown) => {
        // Fall back to the benchmark sample so the heat map still renders.
        console.error('Failed to load NYC borough workload, using benchmark sample:', err)
        if (active) {
          setWorkload(mockNYCWorkloadByBorough())
          setWorkloadFallback(true)
        }
      })
    return () => {
      active = false
    }
  }, [])

  return <NYCWorkloadHeatMap boroughs={boroughs} workload={workload} fallback={workloadFallback} />
}

// ---------------------------------------------------------------------------
// Heat map
// ---------------------------------------------------------------------------

/** Workload-intensity color from lower (green) → higher (red) for t in [0,1]. */
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

/** Case-insensitive borough key for joining workload counts to geometry. */
const boroughKey = (name: string) => name.trim().toLowerCase()

function NYCWorkloadHeatMap({
  boroughs,
  workload,
  fallback,
}: {
  boroughs: NYCBoroughBoundary[]
  workload: NYCBoroughWorkload[]
  fallback: boolean
}) {
  const map = useMemo(() => buildBoroughMap(boroughs), [boroughs])

  // Index workload counts by borough name.
  const byBorough = useMemo(() => {
    const m = new Map<string, NYCBoroughWorkload>()
    for (const w of workload) m.set(boroughKey(w.borough), w)
    return m
  }, [workload])

  const { min, max } = useMemo(() => {
    if (workload.length === 0) return { min: 0, max: 0 }
    const vols = workload.map((w) => w.complaint_volume)
    return { min: Math.min(...vols), max: Math.max(...vols) }
  }, [workload])

  const norm = (v: number) => (max > min ? (v - min) / (max - min) : 0.5)
  const num = (v: number) => v.toLocaleString()
  const workloadForKey = (key: string | null): NYCBoroughWorkload | undefined =>
    key == null ? undefined : byBorough.get(key)
  const colorForKey = (key: string | null): string => {
    const w = workloadForKey(key)
    return w ? heatColor(norm(w.complaint_volume)) : '#e2e8f0'
  }

  // Borough selected by click; borough currently hovered. The detail panel shows
  // the hovered borough first, then the clicked borough, then the busiest.
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const sortedWorkload = useMemo(
    () => [...workload].sort((a, b) => b.complaint_volume - a.complaint_volume),
    [workload],
  )

  const busiestKey = sortedWorkload[0] ? boroughKey(sortedWorkload[0].borough) : null
  const activeKey = hovered ?? selected ?? busiestKey
  const activeWorkload = workloadForKey(activeKey)
  const activeShape = map?.shapes.find((s) => s.key === activeKey) ?? null

  const hasWorkload = workload.length > 0

  return (
    <section aria-label="NYC 311 workload heat map" className="mt-6 card overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-navy-900">Service request workload intensity</div>
          <div className="text-xs text-ink-subtle">Real NYC borough boundaries · NYC 311 benchmark volume by borough</div>
        </div>
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-sky-800 sm:self-auto">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />
          NYC 311 benchmark
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

      {fallback && (
        <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-5 py-2 text-[11px] text-amber-900">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          Showing benchmark sample volume — live NYC 311 aggregation unavailable.
        </div>
      )}

      <div className="grid gap-6 p-5 lg:grid-cols-5">
        {/* Map: real NYC borough polygons shaded by NYC 311 volume */}
        <div className="lg:col-span-3">
          {map ? (
            <figure className="relative rounded-lg bg-gradient-to-br from-slate-50 to-sky-50 p-4">
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
                aria-label="NYC borough boundaries shaded by NYC 311 complaint volume"
                viewBox={`0 0 ${map.width} ${map.height}`}
                className="relative mx-auto block h-auto w-full"
              >
                {map.shapes.map((shape) => {
                  const w = workloadForKey(shape.key)
                  const isActive = activeKey != null && shape.key === activeKey
                  return (
                    <path
                      key={shape.id}
                      d={shape.d}
                      fill={colorForKey(shape.key)}
                      fillOpacity={hasWorkload ? (isActive ? 0.92 : 0.72) : 0.4}
                      stroke={isActive ? '#0f172a' : '#1e3a5f'}
                      strokeWidth={isActive ? 2.25 : 1}
                      strokeLinejoin="round"
                      className="cursor-pointer transition-[fill-opacity]"
                      onMouseEnter={() => setHovered(shape.key)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => setSelected(shape.key)}
                    >
                      <title>
                        {shape.label} — NYC 311 benchmark workload (not operational data, not a risk prediction)
                        {w
                          ? `\nWorkload intensity: ${workloadTier(norm(w.complaint_volume))}` +
                            `\nComplaint volume: ${num(w.complaint_volume)}`
                          : '\nNo NYC 311 workload data'}
                      </title>
                    </path>
                  )
                })}
                {/* Borough labels */}
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
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Workload intensity</div>
                <div
                  className="mt-1 h-2 rounded-full"
                  style={{ background: `linear-gradient(to right, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})` }}
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
                  Hover or select a borough to see its NYC 311 workload detail.
                </div>
              </figcaption>
            </figure>
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center text-sm text-ink-subtle">
              Loading NYC borough boundaries…
            </div>
          )}
        </div>

        {/* Selected borough detail panel */}
        <div className="lg:col-span-2">
          <SelectedBoroughPanel
            workload={activeWorkload}
            boroughLabel={activeShape?.label ?? activeWorkload?.borough ?? null}
            tier={activeWorkload ? workloadTier(norm(activeWorkload.complaint_volume)) : null}
            color={activeWorkload ? heatColor(norm(activeWorkload.complaint_volume)) : '#e2e8f0'}
            interactive={selected != null || hovered != null}
            hasWorkload={hasWorkload}
          />
        </div>
      </div>
    </section>
  )
}

/** Detail panel for the hovered/selected borough, showing its NYC 311 workload. */
function SelectedBoroughPanel({
  workload,
  boroughLabel,
  tier,
  color,
  interactive,
  hasWorkload,
}: {
  workload: NYCBoroughWorkload | undefined
  boroughLabel: string | null
  tier: string | null
  color: string
  interactive: boolean
  hasWorkload: boolean
}) {
  const num = (v: number) => v.toLocaleString()

  if (!hasWorkload) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-ink-subtle">
        NYC 311 service request workload data is not available.
      </div>
    )
  }

  if (!workload) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-ink-subtle">
        Hover or select a borough on the map to see its NYC 311 workload.
      </div>
    )
  }

  return (
    <div className="h-full rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            {interactive ? 'Selected borough' : 'Busiest borough (NYC 311)'}
          </div>
          <div className="text-base font-semibold text-navy-900">{boroughLabel || workload.borough}</div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-ink-muted">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          {tier}
        </span>
      </div>

      <div className="mt-3 text-2xl font-semibold text-navy-900 tabular-nums">{num(workload.complaint_volume)}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink-subtle">NYC 311 complaint volume</div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
        Real NYC 311 benchmark complaint volume — decision support only, not a risk prediction and not Brampton
        operational complaint data.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GeoJSON → SVG helpers
// ---------------------------------------------------------------------------

type LngLat = [number, number]

type BoroughShape = {
  id: string
  label: string
  short: string
  /** Lower-cased borough name used to join NYC 311 workload counts. */
  key: string
  d: string
  cx: number
  cy: number
}

type BoroughMap = {
  width: number
  height: number
  labelSize: number
  shapes: BoroughShape[]
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
function buildMap(entries: MapEntry[]): BoroughMap | null {
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

  const shapes: BoroughShape[] = usable.map((entry) => {
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

    return { id: entry.id, label: entry.label, short: entry.short, key: entry.key, d, cx: fmt(cx), cy: fmt(cy) }
  })

  const labelSize = Math.max(9, Math.min(16, width / 48))
  return { width: fmt(width), height: fmt(height), labelSize, shapes }
}

/** Projects the real NYC borough polygons into the shared SVG space. */
function buildBoroughMap(boroughs: NYCBoroughBoundary[]): BoroughMap | null {
  const entries: MapEntry[] = boroughs.map((b, idx) => ({
    id: String(b.id ?? idx),
    label: b.borough_name,
    short: b.short_label || b.borough_name,
    key: boroughKey(b.borough_name),
    rings: extractRings(b.geojson_geometry),
  }))
  return buildMap(entries)
}
