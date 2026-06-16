import { useEffect, useMemo, useState } from 'react'
import {
  getNYCBoroughBoundaries,
  getNYCWorkloadByBorough,
  mockNYCWorkloadByBorough,
  getNYCCouncilDistrictBoundaries,
  getNYCWorkloadByCouncilDistrict,
  mockNYCWorkloadByCouncilDistrict,
} from '../../services/municipalServiceRequests'

// NYC 311 workload heat map. Two geographic modes share one choropleth:
//   * Council district workload (default) — real NYC City Council district
//     polygons, the finer, ward-like operational unit.
//   * Borough overview — real NYC borough polygons, the broad executive overview.
// Both are shaded by real NYC 311 benchmark complaint volume. This is decision
// support only — never Brampton operational data, never a risk prediction, and
// never Toronto geometry. NYC has no wards: boroughs are too broad to stand in for
// a Brampton/Toronto ward, so council districts are the ward-like operational view.

// Required disclaimer for the NYC 311 workload map (both modes).
const WORKLOAD_DISCLAIMER =
  'NYC 311 benchmark data, not Brampton operational data. Decision support only.'

type MapMode = 'district' | 'borough'

/** A geographic area to draw: a borough or a council district. */
type AreaUnit = { id: string; key: string; label: string; short: string; geometry: unknown }
/** NYC 311 workload for one area, joined to AreaUnit by `key`. */
type AreaVolume = { key: string; label: string; volume: number }

/** Case-insensitive borough key for joining workload counts to geometry. */
const boroughKey = (name: string) => name.trim().toLowerCase()

type ModeAdapter = {
  /** Label shown on the mode toggle. */
  toggleLabel: string
  /** Singular noun for an area in this mode, e.g. "council district". */
  unitLabel: string
  headerSubtitle: string
  /** Fine-print context, kept distinct per mode (operational vs executive). */
  context: string
  /** Shown when the live Supabase view is unavailable or empty. */
  fallbackMessage: string
  loadUnits: () => Promise<AreaUnit[]>
  loadVolumes: () => Promise<AreaVolume[]>
  sample: () => AreaVolume[]
}

const ADAPTERS: Record<MapMode, ModeAdapter> = {
  district: {
    toggleLabel: 'Council district workload',
    unitLabel: 'council district',
    headerSubtitle: 'Ward like operational view of NYC 311 workload by council district.',
    context:
      'Real NYC City Council district boundaries — the ward-like operational unit — are shaded by real NYC 311 benchmark complaint volume per district. Districts with higher complaint volume show higher workload intensity. Workload patterns may help supervisors review staffing, patrol coverage, and service response pressure. This is supervisor decision support only — not a risk prediction, not where to enforce, and this NYC geography and volume is never plotted onto Brampton wards.',
    fallbackMessage:
      'Showing benchmark sample volume. Live NYC 311 council district aggregation is not loaded yet.',
    async loadUnits() {
      const districts = await getNYCCouncilDistrictBoundaries()
      return districts.map((d) => ({
        id: String(d.id),
        key: String(d.council_district),
        label: `District ${d.council_district}`,
        short: d.short_label,
        geometry: d.geojson_geometry,
      }))
    },
    async loadVolumes() {
      const rows = await getNYCWorkloadByCouncilDistrict()
      return rows.map((r) => ({ key: r.area, label: `District ${r.area}`, volume: r.complaint_volume }))
    },
    sample() {
      return mockNYCWorkloadByCouncilDistrict().map((r) => ({
        key: r.area,
        label: `District ${r.area}`,
        volume: r.complaint_volume,
      }))
    },
  },
  borough: {
    toggleLabel: 'Borough overview',
    unitLabel: 'borough',
    headerSubtitle: 'High level NYC borough workload overview.',
    context:
      'Real NYC borough boundaries give the high-level executive overview, shaded by real NYC 311 benchmark complaint volume per borough. Boroughs are broad geographic areas — not a ward-like unit — so use the council district view for the operational equivalent of a Brampton/Toronto ward. Workload patterns may help supervisors review staffing, patrol coverage, and service response pressure. Supervisor decision support only — not a risk prediction — and this NYC geography and volume is never plotted onto Brampton wards.',
    fallbackMessage: 'Showing benchmark sample volume — live NYC 311 borough aggregation unavailable.',
    async loadUnits() {
      const boroughs = await getNYCBoroughBoundaries()
      return boroughs.map((b, idx) => ({
        id: String(b.id ?? idx),
        key: boroughKey(b.borough_name),
        label: b.borough_name,
        short: b.short_label || b.borough_name,
        geometry: b.geojson_geometry,
      }))
    },
    async loadVolumes() {
      const rows = await getNYCWorkloadByBorough()
      return rows.map((r) => ({ key: boroughKey(r.borough), label: r.borough, volume: r.complaint_volume }))
    },
    sample() {
      return mockNYCWorkloadByBorough().map((r) => ({
        key: boroughKey(r.borough),
        label: r.borough,
        volume: r.complaint_volume,
      }))
    },
  },
}

/**
 * The NYC 311 workload heat map. Defaults to the ward-like council district view
 * and offers a toggle to the broad borough executive overview. Loads the bundled
 * geometry for the active mode plus the per-area NYC 311 workload counts, then
 * renders an interactive choropleth shaded by workload intensity.
 */
export default function NYCWorkloadMapPanel({
  onSelectDistrict,
}: {
  /** Fired when a council district is clicked (district mode), for case drilldown. */
  onSelectDistrict?: (district: string) => void
} = {}) {
  const [mode, setMode] = useState<MapMode>('district')
  const [units, setUnits] = useState<AreaUnit[]>([])
  const [volumes, setVolumes] = useState<AreaVolume[]>([])
  // Whether the per-area volume came from the benchmark sample (Supabase view
  // unavailable) rather than the live aggregation.
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    let active = true
    const adapter = ADAPTERS[mode]
    setUnits([])
    setVolumes([])

    adapter
      .loadUnits()
      .then((data) => active && setUnits(data))
      .catch((err: unknown) => {
        // The geometry is bundled, so this should not fail; log and continue.
        console.error('Failed to load NYC area boundaries:', err)
        if (active) setUnits([])
      })

    adapter
      .loadVolumes()
      .then((data) => {
        if (!active) return
        if (data.length === 0) {
          setVolumes(adapter.sample())
          setFallback(true)
        } else {
          setVolumes(data)
          setFallback(false)
        }
      })
      .catch((err: unknown) => {
        // Fall back to the benchmark sample so the heat map still renders.
        console.error('Failed to load NYC workload, using benchmark sample:', err)
        if (active) {
          setVolumes(adapter.sample())
          setFallback(true)
        }
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
      units={units}
      volumes={volumes}
      fallback={fallback}
      onSelectDistrict={onSelectDistrict}
    />
  )
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

function NYCWorkloadHeatMap({
  mode,
  onModeChange,
  units,
  volumes,
  fallback,
  onSelectDistrict,
}: {
  mode: MapMode
  onModeChange: (mode: MapMode) => void
  units: AreaUnit[]
  volumes: AreaVolume[]
  fallback: boolean
  onSelectDistrict?: (district: string) => void
}) {
  const adapter = ADAPTERS[mode]
  const map = useMemo(() => buildAreaMap(units), [units])

  // Index workload counts by area key.
  const byArea = useMemo(() => {
    const m = new Map<string, AreaVolume>()
    for (const w of volumes) m.set(w.key, w)
    return m
  }, [volumes])

  const { min, max } = useMemo(() => {
    if (volumes.length === 0) return { min: 0, max: 0 }
    const vols = volumes.map((w) => w.volume)
    return { min: Math.min(...vols), max: Math.max(...vols) }
  }, [volumes])

  const norm = (v: number) => (max > min ? (v - min) / (max - min) : 0.5)
  const num = (v: number) => v.toLocaleString()
  const volumeForKey = (key: string | null): AreaVolume | undefined =>
    key == null ? undefined : byArea.get(key)
  const colorForKey = (key: string | null): string => {
    const w = volumeForKey(key)
    return w ? heatColor(norm(w.volume)) : '#e2e8f0'
  }

  // Area selected by click; area currently hovered. The detail panel shows the
  // hovered area first, then the clicked area, then the busiest.
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const sortedVolumes = useMemo(() => [...volumes].sort((a, b) => b.volume - a.volume), [volumes])

  const busiestKey = sortedVolumes[0]?.key ?? null
  const activeKey = hovered ?? selected ?? busiestKey
  const activeVolume = volumeForKey(activeKey)
  const activeShape = map?.shapes.find((s) => s.key === activeKey) ?? null
  const activeLabel = activeShape?.label ?? activeVolume?.label ?? null

  const hasWorkload = volumes.length > 0

  return (
    <section aria-label="NYC 311 workload heat map" className="mt-6 card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-navy-900">Service request workload intensity</div>
          <div className="text-xs text-ink-subtle">{adapter.headerSubtitle}</div>
        </div>
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-sky-800 sm:self-auto">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />
          NYC 311 benchmark
        </span>
      </div>

      {/* Map mode toggle: ward-like council districts (default) vs broad boroughs. */}
      <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Map detail level"
          className="inline-flex items-center gap-1 rounded-2xl bg-slate-100 p-1.5 shadow-inner ring-1 ring-slate-200"
        >
          <ModeTab
            label="Council district workload"
            active={mode === 'district'}
            onClick={() => onModeChange('district')}
          />
          <ModeTab label="Borough overview" active={mode === 'borough'} onClick={() => onModeChange('borough')} />
        </div>
        <span className="text-xs font-medium text-ink-muted">
          {mode === 'district' ? 'Operational map view' : 'Executive overview'}
        </span>
      </div>

      {/* Required disclaimer */}
      <div
        role="note"
        className="flex items-start gap-2 border-b border-sky-100 bg-sky-50/50 px-5 py-2.5 text-xs text-sky-900"
      >
        <span aria-hidden className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-sky-500" />
        <span>
          <span className="font-semibold">{WORKLOAD_DISCLAIMER}</span> {adapter.context}
        </span>
      </div>

      {fallback && (
        <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-5 py-2 text-[11px] text-amber-900">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          {adapter.fallbackMessage}
        </div>
      )}

      <div className="grid gap-6 p-5 lg:grid-cols-5">
        {/* Map: real NYC polygons shaded by NYC 311 volume */}
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
                aria-label={`NYC ${adapter.unitLabel} boundaries shaded by NYC 311 complaint volume`}
                viewBox={`0 0 ${map.width} ${map.height}`}
                className="relative mx-auto block h-auto w-full"
              >
                {map.shapes.map((shape) => {
                  const w = volumeForKey(shape.key)
                  const isActive = activeKey != null && shape.key === activeKey
                  return (
                    <path
                      key={shape.id}
                      d={shape.d}
                      fill={colorForKey(shape.key)}
                      fillOpacity={hasWorkload ? (isActive ? 0.92 : 0.72) : 0.4}
                      stroke={isActive ? '#0f172a' : '#1e3a5f'}
                      strokeWidth={isActive ? 2.25 : map.shapes.length > 20 ? 0.6 : 1}
                      strokeLinejoin="round"
                      className="cursor-pointer transition-[fill-opacity]"
                      onMouseEnter={() => setHovered(shape.key)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => {
                        setSelected(shape.key)
                        // In the ward-like district view, a click also opens the
                        // case drilldown for that council district.
                        if (mode === 'district') onSelectDistrict?.(shape.key)
                      }}
                    >
                      <title>
                        {shape.label} — NYC 311 benchmark workload (not operational data, not a risk prediction)
                        {w
                          ? `\nWorkload intensity: ${workloadTier(norm(w.volume))}` +
                            `\nComplaint volume: ${num(w.volume)}`
                          : '\nNo NYC 311 workload data'}
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
                  Hover or select a {adapter.unitLabel} to see its NYC 311 workload detail.
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
            volume={activeVolume}
            areaLabel={activeLabel}
            tier={activeVolume ? workloadTier(norm(activeVolume.volume)) : null}
            color={activeVolume ? heatColor(norm(activeVolume.volume)) : '#e2e8f0'}
            interactive={selected != null || hovered != null}
            hasWorkload={hasWorkload}
          />
        </div>
      </div>

      {/* Supervisor decision-support framing. Deliberately not an enforcement
          decision, does not direct officers, and is not a risk prediction. */}
      <div className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-ink-subtle">
        <span className="font-semibold text-ink-muted">Supervisor decision support.</span> These workload patterns help
        supervisors see where complaint volume is concentrated, which {adapter.unitLabel}s are repeatedly busy, and where
        service response pressure may be forming — input for reviewing staffing, patrol coverage, and supervisor review.
        It does not tell staff where to enforce, does not decide where officers go, and is not a risk prediction.
      </div>
    </section>
  )
}

function ModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-100 ${
        active
          ? 'bg-white text-navy-900 shadow-md ring-1 ring-slate-200'
          : 'text-ink-muted hover:bg-white/70 hover:text-navy-900'
      }`}
    >
      {/* Selected indicator — a small checkmark dot inside the active tab. */}
      <span
        aria-hidden
        className={`flex h-4 w-4 items-center justify-center rounded-full transition-all duration-200 ${
          active ? 'scale-100 bg-accent-500 text-white' : 'scale-0 opacity-0'
        }`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      {label}
    </button>
  )
}

/** Detail panel for the hovered/selected area, showing its NYC 311 workload. */
function SelectedAreaPanel({
  unitLabel,
  volume,
  areaLabel,
  tier,
  color,
  interactive,
  hasWorkload,
}: {
  unitLabel: string
  volume: AreaVolume | undefined
  areaLabel: string | null
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

  if (!volume) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-ink-subtle">
        Hover or select a {unitLabel} on the map to see its NYC 311 workload.
      </div>
    )
  }

  return (
    <div className="h-full rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            {interactive ? `Selected ${unitLabel}` : `Busiest ${unitLabel} (NYC 311)`}
          </div>
          <div className="text-base font-semibold text-navy-900">{areaLabel || volume.label}</div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-ink-muted">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          {tier}
        </span>
      </div>

      <div className="mt-3 text-2xl font-semibold text-navy-900 tabular-nums">{num(volume.volume)}</div>
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

type AreaShape = {
  id: string
  label: string
  short: string
  /** Area key used to join NYC 311 workload counts. */
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
