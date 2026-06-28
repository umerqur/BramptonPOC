import { useEffect, useMemo, useState } from 'react'
import {
  getCtganLatestRunSummary,
  getCtganScenarioSummary,
  getCtganDailySummary,
  getCtganDistrictPressure,
  getCtganComplaintTypePressure,
  type CtganDistrictPressureRow,
  type CtganComplaintTypePressureRow,
} from '../../services/ctganAbmStress'

// CtganAbmFramework — the Stress Testing tab (/app/insights?tab=simulations).
//
// Renders the CTGAN + ABM stress testing framework. CTGAN generates synthetic
// service-request demand; an agent-based model (ABM) runs that demand through a
// district intake queue constrained by officer daily minutes, with a supervisor
// review queue as a second bottleneck. The page reads five precomputed,
// read-only Supabase views via src/services/ctganAbmStress.ts and NEVER writes.
//
// The framework structure always renders so the methodology is visible. When
// the views are empty or missing (no outputs loaded yet) the data panels show a
// single, exact "pending manual approval" state — never "broken", never
// "coming soon". Planning simulation only; not enforcement decisioning.

// Shown verbatim wherever live CTGAN ABM data is not yet available.
const PENDING_MESSAGE =
  'CTGAN ABM outputs are ready for loading. Schema alignment is complete. Data loading is pending manual approval.'

// Officer effort is modeled in hours in the views; the ABM's binding constraint
// is expressed in minutes, so convert at the edge.
const MINUTES_PER_HOUR = 60

type LiveState<T> = { data: T | null; loading: boolean; error: string | null }

function useLive<T>(load: () => Promise<T>): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({ data: null, loading: true, error: null })
  useEffect(() => {
    let active = true
    setState({ data: null, loading: true, error: null })
    load()
      .then((d) => active && setState({ data: d, loading: false, error: null }))
      .catch((err: unknown) => {
        // A missing/empty view is an expected "not loaded yet" state, not a bug.
        console.warn('CTGAN ABM view unavailable:', err)
        if (active) setState({ data: null, loading: false, error: errorMessage(err) })
      })
    return () => {
      active = false
    }
    // load is a stable module-level function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return state
}

function errorMessage(err: unknown): string {
  if (err == null) return 'Unknown error'
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}

const fmtInt = (n: number) => Math.round(n).toLocaleString()

function fmtDate(v: unknown): string {
  if (v == null) return '—'
  const s = String(v).trim()
  if (!s) return '—'
  // run_date arrives as an ISO timestamp; show just the calendar date.
  return s.slice(0, 10)
}

function str(v: unknown, fallback = '—'): string {
  if (v == null) return fallback
  const s = String(v).trim()
  return s.length ? s : fallback
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

export default function CtganAbmFramework() {
  const latestRun = useLive<Record<string, unknown> | null>(getCtganLatestRunSummary)
  const scenarios = useLive<Record<string, unknown>[]>(getCtganScenarioSummary)
  const daily = useLive<{ day: string; total_cases: number }[]>(getCtganDailySummary)
  const districts = useLive<CtganDistrictPressureRow[]>(getCtganDistrictPressure)
  const complaintTypes = useLive<CtganComplaintTypePressureRow[]>(getCtganComplaintTypePressure)

  const dailyRows = useMemo(() => daily.data ?? [], [daily.data])
  const districtRows = useMemo(() => districts.data ?? [], [districts.data])
  const complaintRows = useMemo(() => complaintTypes.data ?? [], [complaintTypes.data])
  const scenarioRows = useMemo(() => scenarios.data ?? [], [scenarios.data])

  const anyLoading =
    latestRun.loading || scenarios.loading || daily.loading || districts.loading || complaintTypes.loading

  // "Has data" means at least one view returned rows. With nothing loaded yet
  // every view is empty (or missing), and we fall to the pending state.
  const hasData =
    latestRun.data != null ||
    scenarioRows.length > 0 ||
    dailyRows.length > 0 ||
    districtRows.length > 0 ||
    complaintRows.length > 0

  const showPending = !anyLoading && !hasData

  // Derived headline measures (only meaningful once data is present).
  const totalGenerated = num(latestRun.data?.generated_cases)
  const simulatedDays = dailyRows.length
  const totalDailyDemand = useMemo(() => dailyRows.reduce((a, r) => a + r.total_cases, 0), [dailyRows])
  const peakDay = useMemo(
    () => dailyRows.reduce<{ day: string; total_cases: number } | null>(
      (best, r) => (best == null || r.total_cases > best.total_cases ? r : best),
      null,
    ),
    [dailyRows],
  )

  const districtCount = districtRows.length
  const totalDistrictCases = useMemo(() => districtRows.reduce((a, r) => a + r.total_cases, 0), [districtRows])
  const totalEstimatedHours = useMemo(() => districtRows.reduce((a, r) => a + r.estimated_hours, 0), [districtRows])
  const totalOfficerMinutes = totalEstimatedHours * MINUTES_PER_HOUR

  return (
    <div className="mt-6 space-y-6">
      {/* Framework banner — frames the whole tab as a planning simulation. */}
      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 bg-navy-900 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-white">CTGAN ABM Stress Testing Framework</h2>
            <span className="inline-flex items-center rounded-full bg-sky-400/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-200 ring-1 ring-inset ring-sky-400/30">
              Planning simulation
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-navy-100">
            A conditional GAN (CTGAN) generates synthetic service-request demand, and an agent-based model (ABM) runs
            that demand through each district&rsquo;s intake queue. Officer daily minutes are the constrained resource,
            and a supervisor review queue forms the second bottleneck. This is capacity planning and stress testing
            only — it does not make enforcement decisions and does not score officers.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {['CTGAN demand', 'Agent-based model', 'Capacity planning', 'Decision support only', 'Not enforcement decisioning'].map(
              (tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-medium text-navy-100 ring-1 ring-inset ring-white/15"
                >
                  {tag}
                </span>
              ),
            )}
          </div>
        </div>

        {/* Loading / pending status row inside the banner body. */}
        <div className="px-5 py-4">
          {anyLoading ? (
            <div className="animate-pulse rounded-md bg-slate-100/70 py-4 text-center text-sm text-ink-subtle">
              Connecting to CTGAN ABM outputs…
            </div>
          ) : showPending ? (
            <PendingState />
          ) : (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-ink-subtle">
              <span>
                <span className="font-semibold text-navy-900">Scenario:</span> {str(latestRun.data?.scenario_name)}
              </span>
              <span>
                <span className="font-semibold text-navy-900">Latest run:</span> {str(latestRun.data?.run_id)}
              </span>
              <span>
                <span className="font-semibold text-navy-900">Run date:</span> {fmtDate(latestRun.data?.run_date)}
              </span>
              <span>
                <span className="font-semibold text-navy-900">Scenarios:</span> {fmtInt(scenarioRows.length)}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* 1. CTGAN demand generation */}
      <FrameworkSection
        step={1}
        title="CTGAN demand generation"
        subtitle="Synthetic service-request demand generated by a conditional GAN, used as the ABM&rsquo;s arrival stream."
      >
        {showPending ? (
          <PendingState />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Generated cases" value={fmtInt(totalGenerated)} helper="Synthetic demand in the latest run" />
            <StatCard label="Simulated days" value={fmtInt(simulatedDays)} helper="Days in the demand horizon" />
            <StatCard label="Total daily demand" value={fmtInt(totalDailyDemand)} helper="Sum of cases across simulated days" />
            <StatCard
              label="Peak demand day"
              value={peakDay ? fmtDate(peakDay.day) : '—'}
              helper={peakDay ? `${fmtInt(peakDay.total_cases)} cases on peak day` : 'No daily rows'}
            />
          </div>
        )}
      </FrameworkSection>

      {/* 2. ABM district queue simulation */}
      <FrameworkSection
        step={2}
        title="ABM district queue simulation"
        subtitle="Generated demand flows into per-district intake queues; the ABM advances each queue day by day."
      >
        {showPending ? (
          <PendingState />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Districts simulated" value={fmtInt(districtCount)} helper="Distinct district queues modeled" />
            <StatCard label="Cases queued" value={fmtInt(totalDistrictCases)} helper="Total cases routed into district queues" />
            <StatCard
              label="Estimated field hours"
              value={fmtInt(totalEstimatedHours)}
              helper="Modeled officer effort across all districts"
            />
            <StatCard
              label="Avg cases / district"
              value={districtCount ? fmtInt(totalDistrictCases / districtCount) : '—'}
              helper="Mean queue load per district"
            />
          </div>
        )}
      </FrameworkSection>

      {/* 3. Officer daily minutes — the constrained resource */}
      <FrameworkSection
        step={3}
        title="Officer daily minutes — the constrained resource"
        subtitle="Each officer has a fixed budget of working minutes per day. When demand exceeds available minutes, cases queue rather than disappear — this is the model&rsquo;s binding constraint."
      >
        {showPending ? (
          <PendingState />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Officer-minutes demanded"
              value={fmtInt(totalOfficerMinutes)}
              helper="Modeled effort converted to minutes (hours × 60)"
            />
            <StatCard
              label="Equivalent field hours"
              value={fmtInt(totalEstimatedHours)}
              helper="Total constrained effort across the run"
            />
            <StatCard
              label="Per simulated day"
              value={simulatedDays ? fmtInt(totalOfficerMinutes / simulatedDays) : '—'}
              helper="Average officer-minutes of demand per day"
            />
          </div>
        )}
      </FrameworkSection>

      {/* 4. Supervisor review queue — the second bottleneck */}
      <FrameworkSection
        step={4}
        title="Supervisor review queue bottleneck"
        subtitle="Cases that require sign-off enter a supervisor review queue after field work. Limited review capacity makes this a second bottleneck where backlog can accumulate even when field minutes are available."
      >
        {showPending ? (
          <PendingState />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Cases entering review"
              value={fmtInt(totalDistrictCases)}
              helper="Cases routed through the modeled review stage"
            />
            <StatCard
              label="Review effort (hours)"
              value={fmtInt(totalEstimatedHours)}
              helper="Effort competing for supervisor capacity"
            />
            <StatCard
              label="Stage"
              value="Post-field"
              helper="Review queue forms after officer field work"
            />
          </div>
        )}
      </FrameworkSection>

      {/* 5. District pressure */}
      <FrameworkSection
        step={5}
        title="District pressure"
        subtitle="Where simulated demand concentrates by district or area. Planning estimate, not performance scoring."
      >
        {showPending ? (
          <PendingState />
        ) : (
          <PressureTable
            firstColLabel="District / area"
            rows={districtRows.map((r) => ({
              label: r.district_or_area,
              total_cases: r.total_cases,
              estimated_hours: r.estimated_hours,
            }))}
          />
        )}
      </FrameworkSection>

      {/* 6. Complaint type pressure */}
      <FrameworkSection
        step={6}
        title="Complaint type pressure"
        subtitle="Which complaint types drive the most simulated workload across the run."
      >
        {showPending ? (
          <PendingState />
        ) : (
          <PressureTable
            firstColLabel="Complaint type"
            rows={complaintRows.map((r) => ({
              label: r.complaint_type,
              total_cases: r.total_cases,
              estimated_hours: r.estimated_hours,
            }))}
          />
        )}
      </FrameworkSection>

      {/* 7. Clear note — planning simulation only, not enforcement decisioning. */}
      <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="text-sm font-semibold text-navy-900">Planning simulation only — not enforcement decisioning</div>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">
          This framework uses CTGAN-generated synthetic demand and an agent-based model to stress test capacity,
          backlog, and review sequencing. It is decision support for staffing and planning conversations. It does not
          predict outcomes for any individual, does not score officers, and is never used to make enforcement
          decisions.
        </p>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function FrameworkSection({
  step,
  title,
  subtitle,
  children,
}: {
  step: number
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">
            {step}
          </span>
          <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
        </div>
        <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-ink-subtle">{subtitle}</p>
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  )
}

function StatCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-navy-900">{value}</div>
      <div className="mt-1 text-[11px] leading-snug text-ink-subtle">{helper}</div>
    </div>
  )
}

type PressureRow = { label: string; total_cases: number; estimated_hours: number }

function PressureTable({ firstColLabel, rows }: { firstColLabel: string; rows: PressureRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-ink-subtle">
        No rows for this view.
      </div>
    )
  }
  const maxCases = rows.reduce((m, r) => Math.max(m, r.total_cases), 0) || 1
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-ink-subtle">
            <th className="py-2 pr-3 font-semibold">{firstColLabel}</th>
            <th className="py-2 pr-3 text-right font-semibold">Cases</th>
            <th className="py-2 pr-3 text-right font-semibold">Est. hours</th>
            <th className="hidden py-2 font-semibold sm:table-cell">Share of cases</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-slate-100 last:border-0">
              <td className="py-2 pr-3 text-navy-900">{r.label}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-navy-900">{fmtInt(r.total_cases)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-ink-subtle">{fmtInt(r.estimated_hours)}</td>
              <td className="hidden py-2 sm:table-cell">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-sky-500"
                    style={{ width: `${Math.max(2, Math.min(100, (r.total_cases / maxCases) * 100))}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The single, exact pending state shown wherever live data is not yet loaded.
function PendingState() {
  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-sky-900">
      <div className="font-semibold">Data loading pending</div>
      <p className="mt-0.5 leading-relaxed">{PENDING_MESSAGE}</p>
    </div>
  )
}
