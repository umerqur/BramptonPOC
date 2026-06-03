import { useEffect, useState } from 'react'
import {
  getBramptonWardBoundaries,
  type WardBoundary,
} from '../../services/municipalServiceRequests'

const JOIN_NOTE =
  'Brampton ward boundaries are real GeoHub data. Toronto benchmark complaints are not geographically joined to Brampton wards yet. Once Brampton provides operational complaint data, cases can be joined to these wards for local workload analysis.'

// Authenticated Brampton ward context. Demonstrates that real Brampton GeoHub
// ward boundary data exists. Starts with a cards/table view of the 10 wards
// rather than SVG polygon rendering of the GeoJSON geometry.
export default function AppWardContextPage() {
  const [wards, setWards] = useState<WardBoundary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(false)
    getBramptonWardBoundaries()
      .then((data) => active && setWards(data))
      .catch((err) => {
        console.error('Failed to load Brampton ward boundaries:', err)
        if (active) setError(true)
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="container-page py-10">
      <div className="section-eyebrow">Local Context</div>
      <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
        Brampton ward context
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
        {loading ? 'Loading ward boundaries…' : `${wards.length.toLocaleString()} Brampton wards`}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Could not load ward boundaries from Supabase.
        </div>
      )}

      {/* Cards */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        {!loading && wards.length === 0 && !error && (
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
