import { useMemo, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers'
import { MapView, WebMercatorViewport } from '@deck.gl/core'
import type { Color, MapViewState, PickingInfo } from '@deck.gl/core'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'
import { calmWorkloadRgb } from './workloadColor'
import type { AreaUnit } from './NYCWorkloadMapPanel'
import { formatMetric, metricConfig, metricRawValue, type AreaMetricValue, type MapMetric } from './mapMetrics'
import { NYC_BOROUGH_BOUNDARIES } from '../../data/nycBoroughBoundaries'

// Optional metric adapter. By default the deck reads its value + display from the
// selected MapMetric in mapMetrics. An adapter lets a different caller (e.g. the
// ABM simulation pressure map) drive the same extruded view with its own metric
// semantics — case load, backlog, stale risk, supervisor queue — without leaking
// those non-311 concepts into mapMetrics. When supplied, the adapter overrides how
// each area's value is read, formatted, and titled.
export type DeckMetricAdapter = {
  /** Heading shown in the tooltip headline. */
  title: string
  /** Unit noun appended to a formatted value, e.g. "cases". */
  unit: string
  /** Whether a "share of total" line makes sense (additive counts only). */
  additive: boolean
  /** Read this area's value, or null for no data. */
  rawValue: (row: AreaMetricValue | undefined) => number | null
  /** Format a non-null value (without the unit). */
  format: (value: number) => string
}

// Professional 3D workload view built on deck.gl's GeoJsonLayer (extruded
// polygons). It renders the real NYC borough / council-district GeoJSON, extruded
// by a CONTROLLED, relative height (sqrt scaling, hard-capped) and shaded with the
// municipal green→amber→orange→red ramp. The selected metric (not just complaint
// volume) drives both the colour and the 3D height. This is a relative operational
// visualization: heights are scaled for readability and are not physical
// measurements.

// Height is intentionally NOT the raw metric value. A literal sqrt-of-volume
// formula pegs almost every NYC area to the cap once values reach a few hundred,
// which flattens the low/medium/high contrast. Instead we keep sqrt scaling but
// normalize it against the current geography level's [min, max] for the SELECTED
// metric and map it onto a capped height band — so differences stay visible
// without skyscraper exaggeration, consistent with the rest of the map being
// "relative to the selected geography level and metric".
const MAX_HEIGHT = 11000
const MIN_HEIGHT = 250
const NO_DATA_HEIGHT = 60
const NO_DATA_COLOR: Color = [203, 213, 225, 235]

const DEFAULT_PITCH = 45
const DEFAULT_BEARING = 0
// Fallback camera over NYC if bounds can't be derived from the geometry.
const NYC_FALLBACK: MapViewState = {
  longitude: -73.95,
  latitude: 40.7,
  zoom: 8.9,
  pitch: DEFAULT_PITCH,
  bearing: DEFAULT_BEARING,
}

type PolyGeom = Polygon | MultiPolygon

/** Properties carried on each extruded feature, used by the accessors + tooltip. */
type MetricProps = {
  key: string
  label: string
  short: string
  /** Selected-metric value for this area, or null when no data. */
  value: number | null
  /** Supporting context for the tooltip. */
  total_requests: number | null
  open_backlog: number | null
  /** Share of the geography-level total, 0..1 — only for additive metrics. */
  share: number | null
  /** Linear min–max normalization used only for the color ramp. */
  colorT: number
  /** Capped, sqrt-scaled extrusion height in meters. */
  elevation: number
}

// deck.gl's GeoJsonLayer widens feature geometry to the general Geometry union,
// so accessors receive this type (we only ever build Polygon/MultiPolygon).
type MetricFeature = Feature<Geometry, MetricProps>

/** Parse the bundled geometry (object | JSON string | Feature | FC) to a
 *  Polygon / MultiPolygon usable by deck.gl. */
function toGeometry(geometry: unknown): PolyGeom | null {
  let g: unknown = geometry
  if (typeof g === 'string') {
    try {
      g = JSON.parse(g)
    } catch {
      return null
    }
  }
  if (!g || typeof g !== 'object') return null
  const obj = g as { type?: string; geometry?: unknown; coordinates?: unknown; features?: unknown }
  if (obj.type === 'Feature') return toGeometry(obj.geometry)
  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    const polys: Polygon['coordinates'][] = []
    for (const f of obj.features) {
      const sub = toGeometry(f)
      if (sub?.type === 'Polygon') polys.push(sub.coordinates)
      else if (sub?.type === 'MultiPolygon') polys.push(...sub.coordinates)
    }
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null
  }
  if (obj.type === 'Polygon' && Array.isArray(obj.coordinates)) {
    return { type: 'Polygon', coordinates: obj.coordinates as Polygon['coordinates'] }
  }
  if (obj.type === 'MultiPolygon' && Array.isArray(obj.coordinates)) {
    return { type: 'MultiPolygon', coordinates: obj.coordinates as MultiPolygon['coordinates'] }
  }
  return null
}

/** Controlled, relative, capped extrusion height — never the raw metric value. */
function elevationFor(value: number | null, min: number, max: number): number {
  if (value == null) return NO_DATA_HEIGHT
  const lo = Math.sqrt(Math.max(0, min))
  const hi = Math.sqrt(Math.max(0, max))
  const t = hi > lo ? (Math.sqrt(Math.max(0, value)) - lo) / (hi - lo) : 0.5
  const clamped = Math.max(0, Math.min(1, t))
  return Math.min(MIN_HEIGHT + clamped * (MAX_HEIGHT - MIN_HEIGHT), MAX_HEIGHT)
}

function eachCoord(geom: PolyGeom, cb: (lng: number, lat: number) => void): void {
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat()
  for (const ring of rings) for (const pos of ring) cb(pos[0], pos[1])
}

type Bounds = [[number, number], [number, number]]

/** Build the extruded FeatureCollection and the geographic bounds in one pass. */
function buildScene(
  units: AreaUnit[],
  values: AreaMetricValue[],
  rawValue: (row: AreaMetricValue | undefined) => number | null,
  additive: boolean,
  min: number,
  max: number,
): { fc: FeatureCollection<Geometry, MetricProps>; bounds: Bounds | null } {
  const byKey = new Map<string, AreaMetricValue>()
  for (const v of values) byKey.set(v.key, v)
  // Share only makes sense for additive count metrics, never closure-day rates.
  const total = additive
    ? values.reduce((s, v) => s + (rawValue(v) ?? 0), 0)
    : 0

  const features: MetricFeature[] = []
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity

  for (const u of units) {
    const geometry = toGeometry(u.geometry)
    if (!geometry) continue
    const row = byKey.get(u.key)
    const value = rawValue(row)
    const colorT = max > min && value != null ? (value - min) / (max - min) : 0
    const share = additive && value != null && total > 0 ? value / total : null
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        key: u.key,
        label: u.label,
        short: u.short,
        value,
        total_requests: row?.total_requests ?? null,
        open_backlog: row?.open_backlog ?? null,
        share,
        colorT,
        elevation: elevationFor(value, min, max),
      },
    })
    eachCoord(geometry, (lng, lat) => {
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    })
  }

  const bounds: Bounds | null = Number.isFinite(minLng)
    ? [
        [minLng, minLat],
        [maxLng, maxLat],
      ]
    : null
  return { fc: { type: 'FeatureCollection', features }, bounds }
}

function fillFor(p: MetricProps): Color {
  if (p.value == null) return NO_DATA_COLOR
  const [r, g, b] = calmWorkloadRgb(p.colorT)
  return [r, g, b, 235]
}

// --- District / borough labels --------------------------------------------

/** One TextLayer label: a centroid position (with z lift) and its short text. */
type LabelDatum = { position: [number, number, number]; text: string }

// Meters added above a feature's extruded height so its label floats just over
// the top of the column rather than being buried inside it.
const LABEL_Z_OFFSET = 400

/** Signed shoelace area of a ring (lng/lat units — only relative size matters). */
function ringArea(ring: number[][]): number {
  let area = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

/** Area-weighted centroid of a ring, falling back to the vertex average. */
function ringCentroid(ring: number[][]): [number, number] {
  let cx = 0
  let cy = 0
  let a = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    const cross = x1 * y2 - x2 * y1
    a += cross
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  a *= 0.5
  if (Math.abs(a) < 1e-12) {
    let sx = 0
    let sy = 0
    for (const [x, y] of ring) {
      sx += x
      sy += y
    }
    const k = ring.length || 1
    return [sx / k, sy / k]
  }
  return [cx / (6 * a), cy / (6 * a)]
}

/** Centroid of the largest exterior ring of a Polygon/MultiPolygon. */
function polygonCentroid(geom: PolyGeom): [number, number] {
  const rings = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((p) => p[0])
  let best: number[][] | null = null
  let bestArea = -Infinity
  for (const ring of rings) {
    if (!ring || ring.length < 3) continue
    const area = Math.abs(ringArea(ring))
    if (area > bestArea) {
      bestArea = area
      best = ring
    }
  }
  return best ? ringCentroid(best) : [NaN, NaN]
}

// Borough outline overlay — apparent (but not heavy black) division lines that
// trace the borough boundaries on the ground plane, so borough divisions stay
// readable without bold text labels sitting over the map. Built once.
const BOROUGH_BOUNDARY_FC: FeatureCollection<Geometry, { name: string }> = {
  type: 'FeatureCollection',
  features: NYC_BOROUGH_BOUNDARIES.map((b) => ({
    type: 'Feature',
    geometry: b.geojson_geometry,
    properties: { name: b.borough_name },
  })),
}

/** A label for one feature, at its centroid, lifted to the top of its column. */
function featureLabel(f: Feature<Geometry, MetricProps>): LabelDatum | null {
  if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') return null
  const text = (f.properties.short || f.properties.label || '').trim()
  if (!text) return null
  const [lng, lat] = polygonCentroid(f.geometry as PolyGeom)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return { position: [lng, lat, f.properties.elevation + LABEL_Z_OFFSET], text }
}

/**
 * District labels, decluttered: instead of labelling all ~51 council districts,
 * label only the top few by metric (the operational headline) plus the
 * hovered/selected district. Each sits at the top of its own extruded column.
 */
function buildDistrictLabels(
  fc: FeatureCollection<Geometry, MetricProps>,
  activeKey: string | null,
  topN = 3,
): LabelDatum[] {
  const wanted = new Map<string, Feature<Geometry, MetricProps>>()

  // Top N rendered districts by value.
  const ranked = fc.features
    .filter((f) => f.properties.value != null)
    .sort((a, b) => (b.properties.value ?? -Infinity) - (a.properties.value ?? -Infinity))
  for (const f of ranked.slice(0, Math.max(0, topN))) wanted.set(f.properties.key, f)

  // Hovered / selected district, if any (activeKey already folds in the busiest).
  if (activeKey) {
    const active = fc.features.find((f) => f.properties.key === activeKey)
    if (active) wanted.set(activeKey, active)
  }

  const out: LabelDatum[] = []
  for (const f of wanted.values()) {
    const label = featureLabel(f)
    if (label) out.push(label)
  }
  return out
}

/** Label every rendered feature — used in borough mode (only ~5 boroughs). */
function buildAllLabels(fc: FeatureCollection<Geometry, MetricProps>): LabelDatum[] {
  const out: LabelDatum[] = []
  for (const f of fc.features) {
    const label = featureLabel(f)
    if (label) out.push(label)
  }
  return out
}

export default function NYCWorkload3DDeck({
  units,
  values,
  metric,
  min,
  max,
  unitLabel,
  activeKey,
  mode = 'district',
  onHover,
  onSelect,
  adapter,
}: {
  units: AreaUnit[]
  values: AreaMetricValue[]
  metric: MapMetric
  min: number
  max: number
  unitLabel: string
  activeKey: string | null
  /** Geography level in view — district mode adds the decluttered district labels. */
  mode?: 'district' | 'borough'
  onHover: (key: string | null) => void
  onSelect: (key: string, label: string) => void
  /** Optional metric adapter. When supplied, it overrides how each area's value is
   *  read, formatted, and titled — used by the ABM simulation pressure map so the
   *  same deck can render case load / backlog / stale risk / supervisor queue. */
  adapter?: DeckMetricAdapter
}) {
  // Bumping this remounts DeckGL, which re-reads initialViewState (i.e. resets).
  const [resetCount, setResetCount] = useState(0)
  const cfg = metricConfig(metric)

  // Value extraction + display come from the adapter when present, otherwise from
  // the selected MapMetric. Everything downstream (scene, tooltip, labels) reads
  // these so the two paths share one render.
  const rawValueOf = useMemo<(row: AreaMetricValue | undefined) => number | null>(
    () => (adapter ? adapter.rawValue : (row) => metricRawValue(row, metric)),
    [adapter, metric],
  )
  const additive = adapter ? adapter.additive : cfg.additive
  const displayTitle = adapter ? adapter.title : cfg.title
  const formatValue = (v: number | null): string =>
    adapter ? (v == null ? 'No data' : `${adapter.format(v)} ${adapter.unit}`.trim()) : formatMetric(v, metric)

  const { fc, bounds } = useMemo(
    () => buildScene(units, values, rawValueOf, additive, min, max),
    [units, values, rawValueOf, additive, min, max],
  )

  const initialViewState = useMemo<MapViewState>(() => {
    if (!bounds) return NYC_FALLBACK
    try {
      const fitted = new WebMercatorViewport({ width: 640, height: 440 }).fitBounds(bounds, { padding: 36 })
      return {
        longitude: fitted.longitude,
        latitude: fitted.latitude,
        zoom: Math.max(7.5, fitted.zoom - 0.15),
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
      }
    } catch {
      return NYC_FALLBACK
    }
  }, [bounds])

  const layer = useMemo(
    () =>
      new GeoJsonLayer<MetricProps>({
        id: 'nyc-workload-3d',
        data: fc,
        pickable: true,
        extruded: true,
        filled: true,
        stroked: true,
        wireframe: false,
        elevationScale: 1,
        getElevation: (f: MetricFeature) => f.properties.elevation,
        getFillColor: (f: MetricFeature) => fillFor(f.properties),
        // Thin, subtle slate division lines for local separation between areas.
        // The selected area gets a stronger line; the borough overlay layer below
        // supplies the geographic-context lines on top in district mode.
        getLineColor: (f: MetricFeature): Color =>
          f.properties.key === activeKey ? [15, 23, 42, 255] : [30, 41, 59, 110],
        getLineWidth: (f: MetricFeature) => (f.properties.key === activeKey ? 2 : 1),
        lineWidthUnits: 'pixels',
        // Soft lighting so the calm colors read with depth, not as flat blocks.
        material: { ambient: 0.62, diffuse: 0.55, shininess: 24, specularColor: [30, 30, 30] },
        autoHighlight: true,
        highlightColor: [255, 255, 255, 60],
        onClick: (info: PickingInfo<MetricFeature>) => {
          const p = info.object?.properties
          if (p) onSelect(p.key, p.label)
        },
        onHover: (info: PickingInfo<MetricFeature>) => onHover(info.object?.properties.key ?? null),
        updateTriggers: {
          getFillColor: [min, max, metric, activeKey],
          getElevation: [min, max, metric],
          getLineColor: [activeKey],
          getLineWidth: [activeKey],
        },
      }),
    [fc, min, max, metric, activeKey, onHover, onSelect],
  )

  // Borough boundary overlay — drawn ONLY in district mode, so the user sees
  // which borough the districts belong to (district detail inside borough
  // context). Slightly stronger than the thin internal district lines, but still
  // a subtle slate, never a heavy black outer shell. Stroked only, never filled
  // or extruded, and non-pickable so it can't intercept hover/click/rotation. In
  // borough mode the main layer already outlines boroughs, so this is omitted.
  const boroughOutlineLayer = useMemo(
    () =>
      new GeoJsonLayer({
        id: 'nyc-workload-3d-borough-outline',
        data: BOROUGH_BOUNDARY_FC,
        stroked: true,
        filled: false,
        extruded: false,
        pickable: false,
        getLineColor: [15, 23, 42, 150],
        getLineWidth: 1.8,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1.2,
        lineWidthMaxPixels: 2.5,
      }),
    [],
  )

  // Labels: in district mode, only the top few districts by metric plus the
  // hovered/selected one; in borough mode, label all (≈5) boroughs. White text
  // with a dark outline for legibility over the green/amber/red ramp.
  const districtLabelData = useMemo<LabelDatum[]>(
    () => (mode === 'borough' ? buildAllLabels(fc) : buildDistrictLabels(fc, activeKey, 3)),
    [fc, activeKey, mode],
  )

  const districtLabelLayer = useMemo(
    () =>
      new TextLayer<LabelDatum>({
        id: 'nyc-workload-3d-district-labels',
        data: districtLabelData,
        pickable: false,
        // [lng, lat, z] — z lifts the label just above the extruded column top.
        getPosition: (d: LabelDatum) => d.position,
        getText: (d: LabelDatum) => d.text,
        getSize: 13,
        sizeUnits: 'pixels',
        getColor: [255, 255, 255, 255],
        outlineWidth: 2,
        outlineColor: [15, 23, 42, 255],
        fontSettings: { sdf: true },
        fontWeight: 700,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        billboard: true,
        characterSet: 'auto',
        parameters: { depthCompare: 'always' },
      }),
    [districtLabelData],
  )

  const getTooltip = (info: PickingInfo<MetricFeature>) => {
    const p = info.object?.properties
    if (!p) return null
    const headline = `${displayTitle}: ${formatValue(p.value)}`
    const share = p.share != null ? `${(p.share * 100).toFixed(1)}% of ${unitLabel} total` : null
    // Supporting context (total requests / open backlog) is mapMetrics-specific, so
    // it is shown only on the default path — an adapter brings its own semantics.
    const context: string[] = []
    if (!adapter && metric !== 'total_requests' && p.total_requests != null) {
      context.push(`Total requests: ${p.total_requests.toLocaleString()}`)
    }
    if (!adapter && metric !== 'open_backlog' && p.open_backlog != null) {
      context.push(`Open backlog: ${p.open_backlog.toLocaleString()}`)
    }
    return {
      html:
        `<div style="font-weight:600;margin-bottom:2px">${p.label}</div>` +
        `<div>${headline}</div>` +
        (share ? `<div style="opacity:.8">${share}</div>` : '') +
        context.map((c) => `<div style="opacity:.8">${c}</div>`).join('') +
        `<div style="opacity:.7;margin-top:3px;font-size:10px">Height is scaled for readability — not a physical measurement.</div>`,
      style: {
        backgroundColor: 'rgba(15,23,42,0.92)',
        color: '#fff',
        fontSize: '11px',
        lineHeight: '1.35',
        padding: '7px 9px',
        borderRadius: '8px',
        maxWidth: '220px',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
      },
    }
  }

  return (
    <div className="relative mx-auto h-[320px] w-full overflow-hidden rounded-lg sm:h-[440px]">
      <DeckGL
        key={resetCount}
        views={new MapView({ repeat: false })}
        initialViewState={initialViewState}
        // Left-drag pans, right-drag / two-finger rotates and tilts.
        controller={{ dragRotate: true, touchRotate: true, doubleClickZoom: false }}
        layers={[layer, ...(mode === 'district' ? [boroughOutlineLayer] : []), districtLabelLayer]}
        getTooltip={getTooltip}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
        style={{ position: 'absolute', inset: '0' }}
      />

      {/* Lightweight controls — drag hint + reset, matching the rest of the UI. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-1 flex items-center justify-between px-1">
        <span className="rounded-full bg-white/75 px-2 py-0.5 text-[10px] font-medium text-ink-subtle ring-1 ring-slate-200">
          Drag to pan · right-drag to rotate / tilt
        </span>
        <button
          type="button"
          onClick={() => setResetCount((c) => c + 1)}
          className="pointer-events-auto rounded-full bg-white/85 px-2.5 py-0.5 text-[10px] font-semibold text-ink-muted ring-1 ring-slate-200 transition-colors hover:bg-white hover:text-navy-900"
        >
          Reset view
        </button>
      </div>
    </div>
  )
}
