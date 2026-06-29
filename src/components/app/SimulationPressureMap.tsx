import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { getNYCCouncilDistrictBoundariesCached } from '../../services/municipalServiceRequests'
import type { CtganDistrictPressureRow } from '../../services/ctganAbmStress'
import { calmWorkloadCss } from './workloadColor'
import type { AreaUnit } from './NYCWorkloadMapPanel'
import type { AreaMetricValue } from './mapMetrics'
import type { DeckMetricAdapter } from './NYCWorkload3DDeck'

// The 3D scenario pressure map. It REUSES the existing deck.gl 3D workload view
// (NYCWorkload3DDeck) and feeds it ABM stress-test pressure instead of live NYC 311
// metrics. The geography is the real NYC council-district benchmark geometry (a POC
// stand-in for Brampton wards, which are not yet wired in); only the VALUES are
// scenario-adjusted. The same extruded council-district polygons are shaded +
// extruded by a selectable ABM pressure metric: case load, backlog, stale risk, or
// supervisor queue. This is planning simulation only — never live Brampton
// operational data and never an enforcement decision.

// The deck.gl bundle is heavy, so it stays code-split and only loads when this map
// renders (the Stress Testing tab), matching the operational map's pattern.
const NYCWorkload3DDeck = lazy(() => import('./NYCWorkload3DDeck'))

// Required, fixed labelling for the POC map.
const POC_DISCLAIMER = 'Public 311 benchmark data for POC modelling. Not live Brampton operational data.'

/** The four selectable ABM pressure metrics. Case load is the default. */
type SimMetric = 'case_load' | 'backlog' | 'stale_risk' | 'supervisor_queue'

type SimMetricConfig = { key: SimMetric; label: string; title: string; unit: string }

const SIM_METRICS: SimMetricConfig[] = [
  { key: 'case_load', label: 'Case load', title: 'Scenario case load', unit: 'cases' },
  { key: 'backlog', label: 'Backlog', title: 'Open backlog', unit: 'cases' },
  { key: 'stale_risk', label: 'Stale risk', title: 'Stale cases', unit: 'cases' },
  { key: 'supervisor_queue', label: 'Supervisor queue', title: 'Supervisor queue', unit: 'cases' },
]

const SIM_METRIC_BY_KEY = new Map(SIM_METRICS.map((m) => [m.key, m]))

/** Trailing integer of a district label, e.g. "Council District 11" -> "11". The
 *  ABM views emit "Council District N"; the bundled geometry is keyed by bare N. */
function districtKey(label: string): string | null {
  const m = label.match(/(\d+)\s*$/)
  return m ? m[1] : null
}

/** The selected metric's value for one district. Supervisor queue is not modeled
 *  per district by the ABM (it is a single global review queue), so it is allocated
 *  to districts by case share — a transparent planning approximation, not invented
 *  per-district data. */
function metricValue(row: CtganDistrictPressureRow, metric: SimMetric, peakSupervisorQueue: number): number {
  switch (metric) {
    case 'case_load':
      return row.total_cases
    case 'backlog':
      return row.backlog
    case 'stale_risk':
      return row.stale_cases
    case 'supervisor_queue':
      return Math.round(peakSupervisorQueue * row.share_of_cases)
  }
}

export default function SimulationPressureMap({
  districtRows,
  peakSupervisorQueue,
  loading,
}: {
  districtRows: CtganDistrictPressureRow[]
  /** Peak single-day supervisor review queue for the latest run, allocated by
   *  district case share for the supervisor-queue view. */
  peakSupervisorQueue: number
  loading: boolean
}) {
  const [metric, setMetric] = useState<SimMetric>('case_load')
  const [units, setUnits] = useState<AreaUnit[]>([])
  const [geomLoading, setGeomLoading] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  // Bundled council-district benchmark geometry — keyed by district number and
  // labelled "Council District N". This is real NYC council-district geography used
  // as a POC stand-in (real Brampton ward boundaries are not yet wired in); only the
  // scenario pressure VALUES draped over it are generated.
  useEffect(() => {
    let active = true
    setGeomLoading(true)
    getNYCCouncilDistrictBoundariesCached()
      .then((districts) => {
        if (!active) return
        setUnits(
          districts.map((d) => ({
            id: String(d.id),
            key: String(d.council_district),
            label: `Council District ${d.council_district}`,
            short: d.short_label,
            geometry: d.geojson_geometry,
          })),
        )
      })
      .catch((err: unknown) => {
        console.error('Failed to load council district geometry:', err)
        if (active) setUnits([])
      })
      .finally(() => {
        if (active) setGeomLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Join ABM district pressure rows to geometry by the trailing district number.
  const byNum = useMemo(() => {
    const m = new Map<string, CtganDistrictPressureRow>()
    for (const r of districtRows) {
      const k = districtKey(r.district_or_area)
      if (k) m.set(k, r)
    }
    return m
  }, [districtRows])

  const cfg = SIM_METRIC_BY_KEY.get(metric) ?? SIM_METRICS[0]

  // One value per district that has ABM data; districts without data are omitted
  // so the deck renders them as no-data grey rather than a misleading zero.
  const values = useMemo<AreaMetricValue[]>(
    () =>
      units.flatMap((u) => {
        const row = byNum.get(u.key)
        if (!row) return []
        return [{ key: u.key, label: u.label, value: metricValue(row, metric, peakSupervisorQueue) }]
      }),
    [units, byNum, metric, peakSupervisorQueue],
  )

  const { min, max } = useMemo(() => {
    const vals = values.map((v) => v.value)
    if (!vals.length) return { min: 0, max: 0 }
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }, [values])

  // Adapter so the shared deck renders ABM pressure with the right title/units and
  // reads the value we computed above, with no NYC-311 labels leaking through.
  const adapter = useMemo<DeckMetricAdapter>(
    () => ({
      title: cfg.title,
      unit: cfg.unit,
      additive: true,
      rawValue: (row) => (row ? row.value : null),
      format: (v) => Math.round(v).toLocaleString(),
    }),
    [cfg],
  )

  const busiestKey = useMemo(() => {
    let best = -Infinity
    let key: string | null = null
    for (const v of values) {
      if (v.value > best) {
        best = v.value
        key = v.key
      }
    }
    return key
  }, [values])
  const activeKey = hovered ?? selected ?? busiestKey

  const hasJoin = values.length > 0

  return (
    <section aria-label="3D scenario pressure map" className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-navy-900">3D scenario pressure map</h3>
            <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-800">
              3D ABM pressure
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-ink-subtle">
            Shows scenario adjusted pressure using the benchmark geography and stress testing assumptions. Drag to pan,
            right-drag to rotate.
          </p>
        </div>

        {/* Toggle: case load / backlog / stale risk / supervisor queue. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Pressure metric</span>
          <div role="radiogroup" aria-label="Pressure metric" className="flex flex-wrap gap-1.5">
            {SIM_METRICS.map((m) => {
              const sel = m.key === metric
              return (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  onClick={() => setMetric(m.key)}
                  className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition ${
                    sel
                      ? 'border-teal-500 bg-teal-50 text-navy-900 ring-1 ring-teal-500'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-navy-900'
                  }`}
                >
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Required POC labelling — kept on the map, not buried in prose. */}
      <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-5 py-2 text-[11px] font-medium text-amber-900">
        <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" />
        {POC_DISCLAIMER}
      </div>

      <div className="p-5">
        {loading || geomLoading ? (
          <div className="flex h-[320px] w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/60 text-sm text-ink-subtle sm:h-[440px]">
            Loading 3D scenario pressure map…
          </div>
        ) : !hasJoin ? (
          <div className="flex h-[260px] w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/60 px-6 text-center text-sm text-ink-subtle">
            District pressure has not loaded for this run, so the map has nothing to extrude yet.
          </div>
        ) : (
          <figure className="relative rounded-lg bg-gradient-to-br from-slate-50 to-sky-50 p-4">
            <Suspense
              fallback={
                <div className="flex h-[320px] w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/60 text-sm text-ink-subtle sm:h-[440px]">
                  Loading 3D pressure view…
                </div>
              }
            >
              <NYCWorkload3DDeck
                units={units}
                values={values}
                metric="total_requests"
                min={min}
                max={max}
                unitLabel="council district"
                activeKey={activeKey}
                mode="district"
                onHover={setHovered}
                onSelect={(key) => setSelected(key)}
                adapter={adapter}
              />
            </Suspense>

            {/* Legend — relative to the selected ABM metric across council districts. */}
            <figcaption className="relative mt-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{cfg.title}</span>
                <span className="text-[10px] text-ink-subtle">Low to high across council districts</span>
              </div>
              <div
                className="mt-1 h-2 rounded-full"
                style={{
                  background: `linear-gradient(to right, ${calmWorkloadCss(0)}, ${calmWorkloadCss(0.4)}, ${calmWorkloadCss(0.72)}, ${calmWorkloadCss(1)})`,
                }}
              />
              <div className="mt-1 flex justify-between text-[11px] text-ink-subtle">
                <span>Low</span>
                <span>Medium</span>
                <span>High</span>
                <span>Highest</span>
              </div>
              {max > 0 && (
                <div className="mt-0.5 text-center text-[10px] tabular-nums text-ink-subtle">
                  {Math.round(min).toLocaleString()} to {Math.round(max).toLocaleString()} {cfg.unit}
                </div>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
                Height and colour are relative to the selected metric across council districts; heights are scaled for
                readability, not physical measurements.{' '}
                {metric === 'supervisor_queue' &&
                  'The ABM models the supervisor queue globally — here it is allocated to districts by case share as a planning approximation. '}
                Districts use NYC council-district benchmark geometry as POC stand-ins; real Brampton ward geometry is
                not yet wired in.
              </p>
            </figcaption>
          </figure>
        )}
      </div>
    </section>
  )
}
