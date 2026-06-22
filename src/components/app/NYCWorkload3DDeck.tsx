import { useMemo, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { GeoJsonLayer } from '@deck.gl/layers'
import { MapView, WebMercatorViewport } from '@deck.gl/core'
import type { Color, MapViewState, PickingInfo } from '@deck.gl/core'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'
import { calmWorkloadRgb } from './workloadColor'
import type { AreaUnit, AreaVolume } from './NYCWorkloadMapPanel'

// Professional 3D workload view built on deck.gl's GeoJsonLayer (extruded
// polygons) — replacing the old hand-rolled SVG pseudo-3D extrusion. It renders
// the real NYC borough / council-district GeoJSON, extruded by a CONTROLLED,
// relative height (sqrt scaling, hard-capped) and shaded with the municipal
// green→amber→orange→red ramp. This is a relative operational visualization:
// heights are scaled for readability and are not physical measurements.

// Height is intentionally NOT raw complaint volume. The suggested literal
// formula `Math.min(Math.sqrt(volume) * 600, 8000)` pegs almost every NYC
// district to the cap once volumes reach a few hundred, which flattens the
// low/medium/high contrast. Instead we keep sqrt scaling but normalize it
// against the current geography level's [min, max] and map it onto a capped
// height band — so differences stay visible without skyscraper exaggeration,
// consistent with the rest of the map being "relative to the selected geography
// level". The band top is tuned a little taller than the volume-flattening cap
// so the busiest geography reads as clearly taller than its neighbours, while
// the hard cap still rules out cartoonish skyscrapers.
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
type WorkloadProps = {
  key: string
  label: string
  short: string
  volume: number | null
  /** Workload share of the geography level total, 0..1, or null when no data. */
  share: number | null
  /** Linear min–max normalization used only for the color ramp. */
  colorT: number
  /** Capped, sqrt-scaled extrusion height in meters. */
  elevation: number
}

// deck.gl's GeoJsonLayer widens feature geometry to the general Geometry union,
// so accessors receive this type (we only ever build Polygon/MultiPolygon).
type WorkloadFeature = Feature<Geometry, WorkloadProps>

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

/** Controlled, relative, capped extrusion height — never raw volume. */
function elevationFor(volume: number | null, min: number, max: number): number {
  if (volume == null) return NO_DATA_HEIGHT
  const lo = Math.sqrt(Math.max(0, min))
  const hi = Math.sqrt(Math.max(0, max))
  const t = hi > lo ? (Math.sqrt(Math.max(0, volume)) - lo) / (hi - lo) : 0.5
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
  volumes: AreaVolume[],
  min: number,
  max: number,
): { fc: FeatureCollection<Geometry, WorkloadProps>; bounds: Bounds | null } {
  const byKey = new Map<string, number>()
  for (const v of volumes) byKey.set(v.key, v.volume)
  const total = volumes.reduce((s, v) => s + v.volume, 0)

  const features: WorkloadFeature[] = []
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity

  for (const u of units) {
    const geometry = toGeometry(u.geometry)
    if (!geometry) continue
    const volume = byKey.has(u.key) ? (byKey.get(u.key) as number) : null
    const colorT = max > min && volume != null ? (volume - min) / (max - min) : 0
    const share = volume != null && total > 0 ? volume / total : null
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        key: u.key,
        label: u.label,
        short: u.short,
        volume,
        share,
        colorT,
        elevation: elevationFor(volume, min, max),
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

function fillFor(p: WorkloadProps): Color {
  if (p.volume == null) return NO_DATA_COLOR
  const [r, g, b] = calmWorkloadRgb(p.colorT)
  return [r, g, b, 235]
}

const numFmt = (v: number) => v.toLocaleString()

export default function NYCWorkload3DDeck({
  units,
  volumes,
  min,
  max,
  unitLabel,
  activeKey,
  onHover,
  onSelect,
}: {
  units: AreaUnit[]
  volumes: AreaVolume[]
  min: number
  max: number
  unitLabel: string
  activeKey: string | null
  onHover: (key: string | null) => void
  onSelect: (key: string, label: string) => void
}) {
  // Bumping this remounts DeckGL, which re-reads initialViewState (i.e. resets).
  const [resetCount, setResetCount] = useState(0)

  const { fc, bounds } = useMemo(() => buildScene(units, volumes, min, max), [units, volumes, min, max])

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
      new GeoJsonLayer<WorkloadProps>({
        id: 'nyc-workload-3d',
        data: fc,
        pickable: true,
        extruded: true,
        filled: true,
        stroked: true,
        wireframe: false,
        elevationScale: 1,
        getElevation: (f: WorkloadFeature) => f.properties.elevation,
        getFillColor: (f: WorkloadFeature) => fillFor(f.properties),
        getLineColor: (f: WorkloadFeature): Color =>
          f.properties.key === activeKey ? [15, 23, 42, 255] : [255, 255, 255, 90],
        getLineWidth: (f: WorkloadFeature) => (f.properties.key === activeKey ? 2 : 1),
        lineWidthUnits: 'pixels',
        // Soft lighting so the calm colors read with depth, not as flat blocks.
        material: { ambient: 0.62, diffuse: 0.55, shininess: 24, specularColor: [30, 30, 30] },
        autoHighlight: true,
        highlightColor: [255, 255, 255, 60],
        onClick: (info: PickingInfo<WorkloadFeature>) => {
          const p = info.object?.properties
          if (p) onSelect(p.key, p.label)
        },
        onHover: (info: PickingInfo<WorkloadFeature>) => onHover(info.object?.properties.key ?? null),
        updateTriggers: {
          getFillColor: [min, max, activeKey],
          getElevation: [min, max],
          getLineColor: [activeKey],
          getLineWidth: [activeKey],
        },
      }),
    [fc, min, max, activeKey, onHover, onSelect],
  )

  const getTooltip = (info: PickingInfo<WorkloadFeature>) => {
    const p = info.object?.properties
    if (!p) return null
    const count = p.volume != null ? `${numFmt(p.volume)} complaints` : 'No workload data'
    const share = p.share != null ? `${(p.share * 100).toFixed(1)}% of ${unitLabel} workload` : '—'
    return {
      html:
        `<div style="font-weight:600;margin-bottom:2px">${p.label}</div>` +
        `<div>${count}</div>` +
        `<div style="opacity:.8">${share}</div>` +
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
        layers={[layer]}
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
