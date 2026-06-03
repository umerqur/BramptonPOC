import { useEffect, useMemo, useState } from 'react'
import {
  getBramptonWardBoundaries,
  type WardBoundary,
} from '../../services/municipalServiceRequests'

const JOIN_NOTE =
  'Brampton ward boundaries are real GeoHub data. Toronto benchmark complaints are not geographically joined to Brampton wards yet. Once Brampton provides operational complaint data, cases can be joined to these wards for local workload analysis.'

// Authenticated Brampton geographic context. Demonstrates that real Brampton
// GeoHub ward boundary data exists, rendered as an SVG boundary preview plus a
// card grid and table of the wards.
export default function AppWardContextPage() {
  const [wards, setWards] = useState<WardBoundary[]>([])
  const [loading, setLoading] = useState(true)
  // Hold the actual error message (or null) so we can surface the real Supabase
  // error instead of a generic "could not load" string.
  const [error, setError] = useState<string | null>(null)
  // Distinguish "query has not succeeded yet" from "query succeeded with 0 rows"
  // so we never render "0 Brampton wards" unless the load genuinely returned 0.
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setLoaded(false)
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
  }, [])

  // Only report a count once the query has actually succeeded.
  const querySucceeded = loaded && !error

  return (
    <div className="container-page py-10">
      <div className="section-eyebrow">Local Context</div>
      <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
        Brampton Geographic Context
      </h1>
      <p className="mt-2 text-sm text-ink-muted max-w-3xl">
        Real Brampton GeoHub ward boundaries provide local geographic context for the complaint workflow platform.
      </p>

      <div
        role="note"
        className="mt-6 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900"
      >
        <span aria-hidden className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-sky-500" />
        <span>{JOIN_NOTE}</span>
      </div>

      <div className="mt-6 text-sm text-ink-subtle">
        {loading
          ? 'Loading ward boundaries…'
          : querySucceeded
            ? `${wards.length.toLocaleString()} Brampton ward${wards.length === 1 ? '' : 's'}`
            : 'Ward boundaries unavailable'}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900">
          <div className="font-semibold">Could not load ward boundaries from Supabase.</div>
          <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-xs text-rose-800">{error}</pre>
        </div>
      )}

      {/* Map / boundary preview panel */}
      {!error && <WardBoundaryPanel wards={wards} loading={loading} loaded={loaded} />}

      {/* Cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {wards.map((w) => (
          <div key={w.id} className="card p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-navy-900">{w.ward || `Ward ${w.objectid ?? w.id}`}</div>
              {w.objectid != null && <span className="text-[11px] text-ink-subtle">#{w.objectid}</span>}
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Row label="Electoral area" value={w.electoral_area} />
              <Row label="Source city" value={w.source_city} />
              <Row label="Source dataset" value={w.source_dataset} />
              <Row label="Boundary geometry" value={w.geojson_geometry ? 'GeoJSON available' : 'Not available'} />
            </dl>
          </div>
        ))}
        {querySucceeded && wards.length === 0 && (
          <div className="text-sm text-ink-subtle">No ward boundaries available.</div>
        )}
      </div>

      {/* Table */}
      {wards.length > 0 && (
        <div className="mt-8 card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-ink-subtle">
                <tr className="text-left">
                  <Th>Ward</Th>
                  <Th>Electoral area</Th>
                  <Th>Source city</Th>
                  <Th>Source dataset</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {wards.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-navy-900">{w.ward || '—'}</td>
                    <td className="px-4 py-3 text-ink-muted">{w.electoral_area || '—'}</td>
                    <td className="px-4 py-3 text-ink-muted">{w.source_city || '—'}</td>
                    <td className="px-4 py-3 text-ink-muted">{w.source_dataset || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Boundary preview panel. When the ward rows carry usable GeoJSON geometry it
 * renders an SVG of the ward polygons; otherwise it falls back to a styled map
 * placeholder confirming the boundary layer is loaded.
 */
function WardBoundaryPanel({
  wards,
  loading,
  loaded,
}: {
  wards: WardBoundary[]
  loading: boolean
  loaded: boolean
}) {
  const map = useMemo(() => buildWardMap(wards), [wards])
  const hasWards = wards.length > 0

  return (
    <div className="mt-6 card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div>
          <div className="text-sm font-semibold text-navy-900">Ward boundary layer</div>
          <div className="text-xs text-ink-subtle">Brampton GeoHub electoral ward geometry</div>
        </div>
        {hasWards && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {wards.length} ward{wards.length === 1 ? '' : 's'} loaded
          </span>
        )}
      </div>

      <div className="relative bg-gradient-to-br from-slate-50 to-sky-50 p-5">
        {/* Subtle grid backdrop for the "map" feel */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(15,23,42,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.06) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        {map ? (
          <figure className="relative">
            <svg
              role="img"
              aria-label="Brampton ward boundary preview"
              viewBox={`0 0 ${map.width} ${map.height}`}
              className="mx-auto block h-auto w-full max-w-3xl"
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
                  key={`label-${shape.id}`}
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
            <figcaption className="relative mt-3 text-center text-xs text-ink-subtle">
              Brampton ward boundary layer loaded — {map.shapes.length} polygon
              {map.shapes.length === 1 ? '' : 's'} rendered from GeoJSON geometry.
            </figcaption>
          </figure>
        ) : (
          <div className="relative flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-sky-600">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Zm0 0v16m6-14v16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="mt-3 text-sm font-semibold text-navy-900">
              {loading
                ? 'Loading ward boundary layer…'
                : hasWards
                  ? 'Brampton ward boundary layer loaded'
                  : loaded
                    ? 'No ward boundary layer available'
                    : 'Brampton ward boundary layer'}
            </div>
            {hasWards && (
              <div className="mt-1 text-xs text-ink-subtle">
                {wards.length} ward boundar{wards.length === 1 ? 'y is' : 'ies are'} available. Interactive polygon
                rendering will appear here when GeoJSON geometry is present.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="text-ink text-right">{value || '—'}</dd>
    </div>
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
 * Projects every ward's GeoJSON rings into a shared SVG coordinate space,
 * returning null when no usable geometry exists (so the caller can fall back to
 * the map placeholder).
 */
function buildWardMap(wards: WardBoundary[]): WardMap | null {
  const entries = wards
    .map((w) => ({ ward: w, rings: extractRings(w.geojson_geometry) }))
    .filter((e) => e.rings.length > 0)

  if (entries.length === 0) return null

  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const { rings } of entries) {
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }
  }

  // Correct longitude compression at Brampton's latitude so shapes aren't
  // horizontally stretched.
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

  const shapes: WardShape[] = entries.map(({ ward, rings }, idx) => {
    const d = rings
      .map((ring) => {
        const segs = ring.map(([lng, lat], i) => {
          const [x, y] = project(lng, lat)
          return `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`
        })
        return `${segs.join(' ')} Z`
      })
      .join(' ')

    // Label at the centroid of the largest ring.
    const largest = rings.reduce((a, b) => (b.length > a.length ? b : a), rings[0])
    let sx = 0
    let sy = 0
    for (const [lng, lat] of largest) {
      const [x, y] = project(lng, lat)
      sx += x
      sy += y
    }
    const cx = sx / largest.length
    const cy = sy / largest.length

    const label = ward.ward || `Ward ${ward.objectid ?? ward.id}`
    const short = shortLabel(ward)
    return { id: String(ward.id ?? idx), label, short, d, cx: fmt(cx), cy: fmt(cy) }
  })

  const labelSize = Math.max(9, Math.min(16, width / 48))
  return { width: fmt(width), height: fmt(height), labelSize, shapes }
}

function shortLabel(ward: WardBoundary): string {
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
    const parts = [e.message, e.details, e.hint, e.code]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (parts.length > 0) return parts.join(' — ')
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}
