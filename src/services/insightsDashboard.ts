import { supabase, isSupabaseConfigured } from '../lib/supabase'

// Operational workload intelligence for the supervisor/coordinator Insights
// dashboard. Every chart and table on the dashboard reads a small, server-side
// aggregate view over the full NYC 311 benchmark dataset in
// public.municipal_complaints (see migration
// 018_insights_operational_dashboard.sql) — the React app never scans the
// millions of underlying rows for a chart. Individual records are only fetched
// for an explicit drilldown (a small, filtered, limited slice).
//
// This is supervisor decision support over NYC 311 public benchmark data: where
// the workload is concentrated, where closure is under pressure, and where
// staffing/routing review may be warranted. It is not Brampton operational data,
// not a risk prediction, and not an automated enforcement decision. A human
// coordinator or supervisor reviews and decides.

const INSIGHTS_SOURCE_META_VIEW = 'v_insights_source_meta'
const INSIGHTS_KPIS_VIEW = 'v_insights_kpis'
const INSIGHTS_COMPLAINT_TYPE_VOLUME_VIEW = 'v_insights_complaint_type_volume'
const INSIGHTS_CLOSURE_BOTTLENECKS_VIEW = 'v_insights_closure_bottlenecks'
const INSIGHTS_AREA_BOTTLENECKS_VIEW = 'v_insights_area_bottlenecks'
const INSIGHTS_DEPARTMENT_WORKLOAD_VIEW = 'v_insights_department_workload'
const INSIGHTS_MONTHLY_TREND_VIEW = 'v_insights_monthly_trend'
const INSIGHTS_CHANNEL_MIX_VIEW = 'v_insights_channel_mix'

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured')
  }
  return supabase
}

// A view aggregate may arrive as a Postgres numeric (string) or number; normalize.
function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : (value as number)
  return Number.isFinite(n) ? n : 0
}

// Closure-day metrics are null when a bucket has no closed cases yet.
function numOrNull(value: unknown): number | null {
  if (value == null) return null
  const n = typeof value === 'string' ? Number(value) : (value as number)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// 0. Source metadata — the real data source behind the dashboard
// ---------------------------------------------------------------------------

export type InsightsSourceMeta = {
  record_count: number
  earliest: string | null
  latest: string | null
}

export async function getInsightsSourceMeta(): Promise<InsightsSourceMeta> {
  const client = requireClient()
  const { data, error } = await client.from(INSIGHTS_SOURCE_META_VIEW).select('*').single()
  if (error) throw error
  const r = data as Record<string, unknown>
  return {
    record_count: num(r.record_count),
    earliest: (r.earliest as string | null) ?? null,
    latest: (r.latest as string | null) ?? null,
  }
}

/** Plain-English date, e.g. "July 1, 2024". Returns null for unparseable input. */
export function formatPlainDate(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * Demo placeholder source metadata, used only when the live source-meta view is
 * unavailable. Illustrative figures for the NYC 311 public benchmark.
 */
export function sampleInsightsSourceMeta(): InsightsSourceMeta {
  return { record_count: 3432183, earliest: '2024-07-01', latest: '2026-06-30' }
}

// ---------------------------------------------------------------------------
// 1. KPI summary
// ---------------------------------------------------------------------------

export type InsightsKpis = {
  total_requests: number
  open_requests: number
  closed_requests: number
  avg_closure_days: number | null
  median_closure_days: number | null
  p90_closure_days: number | null
  busiest_council_district: string | null
  top_complaint_type: string | null
}

export async function getInsightsKpis(): Promise<InsightsKpis> {
  const client = requireClient()
  const { data, error } = await client.from(INSIGHTS_KPIS_VIEW).select('*').single()
  if (error) throw error
  const r = data as Record<string, unknown>
  return {
    total_requests: num(r.total_requests),
    open_requests: num(r.open_requests),
    closed_requests: num(r.closed_requests),
    avg_closure_days: numOrNull(r.avg_closure_days),
    median_closure_days: numOrNull(r.median_closure_days),
    p90_closure_days: numOrNull(r.p90_closure_days),
    busiest_council_district: (r.busiest_council_district as string | null) ?? null,
    top_complaint_type: (r.top_complaint_type as string | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// 2. Complaint type pressure
// ---------------------------------------------------------------------------

export type ComplaintTypeVolume = {
  complaint_type: string
  total_cases: number
}

export async function getInsightsComplaintTypeVolume(limit = 12): Promise<ComplaintTypeVolume[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(INSIGHTS_COMPLAINT_TYPE_VOLUME_VIEW)
    .select('complaint_type, total_cases')
    .order('total_cases', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    complaint_type: (r.complaint_type as string) || 'Uncategorized',
    total_cases: num(r.total_cases),
  }))
}

// ---------------------------------------------------------------------------
// 3. Closure bottlenecks (by complaint type)
// ---------------------------------------------------------------------------

export type ClosureBottleneck = {
  complaint_type: string
  total_cases: number
  closed_cases: number
  avg_closure_days: number | null
  median_closure_days: number | null
  p90_closure_days: number | null
}

export async function getInsightsClosureBottlenecks(limit = 12): Promise<ClosureBottleneck[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(INSIGHTS_CLOSURE_BOTTLENECKS_VIEW)
    .select('complaint_type, total_cases, closed_cases, avg_closure_days, median_closure_days, p90_closure_days')
    .order('avg_closure_days', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    complaint_type: (r.complaint_type as string) || 'Uncategorized',
    total_cases: num(r.total_cases),
    closed_cases: num(r.closed_cases),
    avg_closure_days: numOrNull(r.avg_closure_days),
    median_closure_days: numOrNull(r.median_closure_days),
    p90_closure_days: numOrNull(r.p90_closure_days),
  }))
}

// ---------------------------------------------------------------------------
// 4. Area bottlenecks (by council district)
// ---------------------------------------------------------------------------

export type AreaBottleneck = {
  council_district: string
  total_cases: number
  avg_closure_days: number | null
  p90_closure_days: number | null
  top_complaint_type: string | null
}

export async function getInsightsAreaBottlenecks(limit = 12): Promise<AreaBottleneck[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(INSIGHTS_AREA_BOTTLENECKS_VIEW)
    .select('council_district, total_cases, avg_closure_days, p90_closure_days, top_complaint_type')
    .order('total_cases', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    council_district: String(r.council_district ?? ''),
    total_cases: num(r.total_cases),
    avg_closure_days: numOrNull(r.avg_closure_days),
    p90_closure_days: numOrNull(r.p90_closure_days),
    top_complaint_type: (r.top_complaint_type as string | null) ?? null,
  }))
}

// ---------------------------------------------------------------------------
// 5. Department workload
// ---------------------------------------------------------------------------

export type InsightsDepartmentWorkload = {
  department: string
  total_cases: number
  open_cases: number
  closed_cases: number
  avg_closure_days: number | null
}

export async function getInsightsDepartmentWorkload(limit = 12): Promise<InsightsDepartmentWorkload[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(INSIGHTS_DEPARTMENT_WORKLOAD_VIEW)
    .select('department, total_cases, open_cases, closed_cases, avg_closure_days')
    .order('total_cases', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    department: (r.department as string) || 'Unassigned',
    total_cases: num(r.total_cases),
    open_cases: num(r.open_cases),
    closed_cases: num(r.closed_cases),
    avg_closure_days: numOrNull(r.avg_closure_days),
  }))
}

// ---------------------------------------------------------------------------
// 6. Trend (monthly)
// ---------------------------------------------------------------------------

export type MonthlyTrendPoint = {
  month: string
  request_volume: number
  avg_closure_days: number | null
}

export async function getInsightsMonthlyTrend(limit = 24): Promise<MonthlyTrendPoint[]> {
  const client = requireClient()
  // Most recent months first from the server, then return oldest → newest for charting.
  const { data, error } = await client
    .from(INSIGHTS_MONTHLY_TREND_VIEW)
    .select('month, request_volume, avg_closure_days')
    .order('month', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({
      month: (r.month as string) || '',
      request_volume: num(r.request_volume),
      avg_closure_days: numOrNull(r.avg_closure_days),
    }))
    .reverse()
}

// ---------------------------------------------------------------------------
// 7. Channel mix
// ---------------------------------------------------------------------------

export type ChannelMixRow = {
  channel: string
  total_cases: number
}

/** Canonical channel order for display, regardless of view ordering. */
const CHANNEL_ORDER = ['Online', 'Phone', 'Mobile', 'Unknown']

export async function getInsightsChannelMix(): Promise<ChannelMixRow[]> {
  const client = requireClient()
  const { data, error } = await client.from(INSIGHTS_CHANNEL_MIX_VIEW).select('channel, total_cases')
  if (error) throw error
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    channel: (r.channel as string) || 'Unknown',
    total_cases: num(r.total_cases),
  }))
  return rows.sort((a, b) => CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel))
}

// ---------------------------------------------------------------------------
// Benchmark sample fallbacks
// ---------------------------------------------------------------------------
// Used only when the live aggregate views are unavailable (e.g. the Insights
// migration has not been applied yet), so the dashboard still renders with a
// clear "benchmark sample" banner — mirroring the workload map's fallback. These
// are illustrative NYC-shaped figures, not Brampton operational data.

type SampleType = {
  type: string
  vol: number
  avg: number
  median: number
  p90: number
}

const SAMPLE_TYPES: SampleType[] = [
  { type: 'Noise - Residential', vol: 41200, avg: 4.2, median: 2.1, p90: 11.0 },
  { type: 'Illegal Parking', vol: 38950, avg: 1.8, median: 0.9, p90: 5.4 },
  { type: 'HEAT/HOT WATER', vol: 33110, avg: 9.7, median: 6.2, p90: 24.5 },
  { type: 'Blocked Driveway', vol: 27840, avg: 1.5, median: 0.7, p90: 4.8 },
  { type: 'Street Condition', vol: 19420, avg: 14.3, median: 8.0, p90: 38.2 },
  { type: 'Water System', vol: 16880, avg: 7.1, median: 3.4, p90: 19.6 },
  { type: 'Sanitation Condition', vol: 15230, avg: 5.6, median: 3.1, p90: 14.9 },
  { type: 'Rodent', vol: 12110, avg: 12.8, median: 7.5, p90: 33.1 },
  { type: 'Damaged Tree', vol: 9870, avg: 21.4, median: 12.0, p90: 56.7 },
  { type: 'Graffiti', vol: 7640, avg: 18.2, median: 10.5, p90: 47.3 },
]

const SAMPLE_DEPARTMENTS: InsightsDepartmentWorkload[] = [
  { department: 'NYPD — New York City Police Department', total_cases: 78200, open_cases: 9100, closed_cases: 69100, avg_closure_days: 2.4 },
  { department: 'HPD — Housing Preservation & Development', total_cases: 64300, open_cases: 12800, closed_cases: 51500, avg_closure_days: 10.6 },
  { department: 'DOT — Department of Transportation', total_cases: 33950, open_cases: 6400, closed_cases: 27550, avg_closure_days: 13.1 },
  { department: 'DSNY — Department of Sanitation', total_cases: 24110, open_cases: 3200, closed_cases: 20910, avg_closure_days: 5.2 },
  { department: 'DEP — Department of Environmental Protection', total_cases: 16880, open_cases: 2100, closed_cases: 14780, avg_closure_days: 7.0 },
  { department: 'DPR — Department of Parks & Recreation', total_cases: 10800, open_cases: 1900, closed_cases: 8900, avg_closure_days: 20.9 },
]

const SAMPLE_CHANNELS: ChannelMixRow[] = [
  { channel: 'Online', total_cases: 96400 },
  { channel: 'Phone', total_cases: 78250 },
  { channel: 'Mobile', total_cases: 40360 },
  { channel: 'Unknown', total_cases: 7240 },
]

export function sampleInsightsKpis(): InsightsKpis {
  const total = SAMPLE_TYPES.reduce((n, t) => n + t.vol, 0)
  const closed = Math.round(total * 0.84)
  return {
    total_requests: total,
    open_requests: total - closed,
    closed_requests: closed,
    avg_closure_days: 6.8,
    median_closure_days: 3.2,
    p90_closure_days: 22.4,
    busiest_council_district: '5',
    top_complaint_type: SAMPLE_TYPES[0].type,
  }
}

export function sampleComplaintTypeVolume(): ComplaintTypeVolume[] {
  return SAMPLE_TYPES.map((t) => ({ complaint_type: t.type, total_cases: t.vol }))
}

export function sampleClosureBottlenecks(): ClosureBottleneck[] {
  return [...SAMPLE_TYPES]
    .sort((a, b) => b.avg - a.avg)
    .map((t) => ({
      complaint_type: t.type,
      total_cases: t.vol,
      closed_cases: Math.round(t.vol * 0.85),
      avg_closure_days: t.avg,
      median_closure_days: t.median,
      p90_closure_days: t.p90,
    }))
}

export function sampleAreaBottlenecks(): AreaBottleneck[] {
  // Deterministic spread across NYC's 51 council districts; outer districts carry
  // more volume, mirroring the real benchmark distribution.
  return Array.from({ length: 51 }, (_, i) => {
    const n = i + 1
    const base = 2400 + ((n * 1373) % 7600)
    const wave = Math.round(1600 * (1 + Math.sin(n / 2.3)))
    const t = SAMPLE_TYPES[n % SAMPLE_TYPES.length]
    return {
      council_district: String(n),
      total_cases: base + wave,
      avg_closure_days: Math.round((t.avg + (n % 5)) * 10) / 10,
      p90_closure_days: Math.round((t.p90 + (n % 9)) * 10) / 10,
      top_complaint_type: t.type,
    }
  }).sort((a, b) => b.total_cases - a.total_cases)
}

export function sampleDepartmentWorkload(): InsightsDepartmentWorkload[] {
  return SAMPLE_DEPARTMENTS
}

export function sampleMonthlyTrend(months = 24): MonthlyTrendPoint[] {
  const out: MonthlyTrendPoint[] = []
  const now = new Date()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const seasonal = 1 + 0.28 * Math.sin((d.getMonth() / 12) * Math.PI * 2)
    const request_volume = Math.round(7600 * seasonal + ((i * 311) % 1400))
    const avg_closure_days = Math.round((6.5 + 2.4 * Math.sin(i / 3.2)) * 10) / 10
    out.push({ month, request_volume, avg_closure_days })
  }
  return out
}

export function sampleChannelMix(): ChannelMixRow[] {
  return SAMPLE_CHANNELS
}
