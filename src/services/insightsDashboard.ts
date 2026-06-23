import { supabase, isSupabaseConfigured } from '../lib/supabase'

// Operational workload intelligence for the supervisor/coordinator Insights
// dashboard. Every chart and table reads a small, precomputed aggregate from a
// materialized view over the full New York City 311 public service request
// dataset in public.municipal_complaints (see migrations
// 018_insights_operational_dashboard.sql + 020_insights_materialized_views.sql)
// — the React app never scans the millions of underlying rows for a chart, and
// individual records are only fetched for an explicit drilldown (a small,
// filtered, limited slice).
//
// There is NO hardcoded fallback data here: when a live aggregate cannot be
// loaded, the caller surfaces a clear "Live data unavailable" error for
// that section rather than inventing numbers. This is supervisor decision support
// over public, historical workload data — not a risk prediction and not an
// automated enforcement decision. A human reviews and decides.

const INSIGHTS_SOURCE_META_VIEW = 'v_insights_source_meta'
const INSIGHTS_KPIS_VIEW = 'v_insights_kpis'
const INSIGHTS_COMPLAINT_TYPE_VOLUME_VIEW = 'v_insights_complaint_type_volume'
const INSIGHTS_CLOSURE_BOTTLENECKS_VIEW = 'v_insights_closure_bottlenecks'
const INSIGHTS_AREA_BOTTLENECKS_VIEW = 'v_insights_area_bottlenecks'
const INSIGHTS_DEPARTMENT_WORKLOAD_VIEW = 'v_insights_department_workload'
const INSIGHTS_MONTHLY_TREND_VIEW = 'v_insights_monthly_trend'
const INSIGHTS_CHANNEL_MIX_VIEW = 'v_insights_channel_mix'
const INSIGHTS_CLOSURE_DURATION_DISTRIBUTION_VIEW = 'v_insights_closure_duration_distribution'

// Synthetic field activity simulation — generated operational activity derived
// from the NYC 311 benchmark timing and status patterns (not Brampton
// operational patrol data). These four precomputed aggregate views demonstrate
// how patrol logs, officer activity, and closure bottlenecks could be visualized
// once real Brampton operational data is connected. The React app reads only the
// small aggregates here, never the underlying synthetic rows.
const SYNTHETIC_FIELD_ACTIVITY_SUMMARY_VIEW = 'v_synthetic_field_activity_summary'
const SYNTHETIC_FIELD_ACTIVITY_BY_BOROUGH_VIEW = 'v_synthetic_field_activity_by_borough'
const SYNTHETIC_FIELD_ACTIVITY_BY_CLOSURE_BUCKET_VIEW = 'v_synthetic_field_activity_by_closure_bucket'
const SYNTHETIC_FIELD_ACTIVITY_BY_COMPLAINT_TYPE_VIEW = 'v_synthetic_field_activity_by_complaint_type'

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Live data service is not configured')
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
// 8. Status mix
// ---------------------------------------------------------------------------

export type StatusMixRow = {
  status: string
  total_cases: number
}

export async function getInsightsStatusMix(): Promise<StatusMixRow[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('v_insights_status_mix')
    .select('status, total_cases')
    .order('total_cases', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    status: (r.status as string) || 'Unknown',
    total_cases: num(r.total_cases),
  }))
}

// ---------------------------------------------------------------------------
// 9. Closure time distribution
// ---------------------------------------------------------------------------

export type ClosureDurationBucket = {
  closure_bucket: string
  bucket_order: number
  total_cases: number
}

/**
 * Closure time distribution — closed historical requests bucketed by how long
 * they took to close, ordered fastest → slowest (bucket_order). This is
 * descriptive historical context that shows the long tail of slower cases, not
 * a prediction. Reads the precomputed aggregate view, never raw case rows.
 */
export async function getInsightsClosureDurationDistribution(): Promise<ClosureDurationBucket[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(INSIGHTS_CLOSURE_DURATION_DISTRIBUTION_VIEW)
    .select('closure_bucket, bucket_order, total_cases')
    .order('bucket_order', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    closure_bucket: (r.closure_bucket as string) || '—',
    bucket_order: num(r.bucket_order),
    total_cases: num(r.total_cases),
  }))
}

/**
 * Whether a channel mix is meaningful enough to chart. NYC 311 records often
 * lack a usable channel value; if the dataset is empty or overwhelmingly
 * "Unknown" we hide the chart rather than imply a precise online/phone/mobile
 * split that the data does not support.
 */
export function isChannelMixMeaningful(rows: ChannelMixRow[]): boolean {
  const total = rows.reduce((n, r) => n + r.total_cases, 0)
  if (total === 0) return false
  const unknown = rows.find((r) => r.channel === 'Unknown')?.total_cases ?? 0
  return unknown / total < 0.95
}

// ---------------------------------------------------------------------------
// 10. Synthetic field activity simulation
// ---------------------------------------------------------------------------
//
// Generated operational activity from NYC 311 benchmark timing and status
// patterns — NOT Brampton operational patrol data. This demonstrates how patrol
// logs, officer activity, and closure bottlenecks could be visualized once real
// Brampton operational data is connected. Each function reads a small precomputed
// aggregate view, never the underlying synthetic rows.

export type SyntheticFieldActivitySummary = {
  sampled_cases: number
  planned_field_activities: number
  active_style_cases: number
  avg_activity_intensity: number
  latest_source_closed_at: string | null
}

export async function getSyntheticFieldActivitySummary(): Promise<SyntheticFieldActivitySummary> {
  const client = requireClient()
  const { data, error } = await client.from(SYNTHETIC_FIELD_ACTIVITY_SUMMARY_VIEW).select('*').single()
  if (error) throw error
  const r = data as Record<string, unknown>
  return {
    sampled_cases: num(r.sampled_cases),
    planned_field_activities: num(r.planned_field_activities),
    active_style_cases: num(r.active_style_cases),
    avg_activity_intensity: num(r.avg_activity_intensity),
    latest_source_closed_at: (r.latest_source_closed_at as string | null) ?? null,
  }
}

export type SyntheticFieldActivityByBorough = {
  borough: string
  sampled_cases: number
  planned_field_activities: number
  active_style_cases: number
  avg_activity_intensity: number
}

export async function getSyntheticFieldActivityByBorough(): Promise<SyntheticFieldActivityByBorough[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(SYNTHETIC_FIELD_ACTIVITY_BY_BOROUGH_VIEW)
    .select('borough, sampled_cases, planned_field_activities, active_style_cases, avg_activity_intensity')
    .order('planned_field_activities', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    borough: (r.borough as string) || 'Unknown',
    sampled_cases: num(r.sampled_cases),
    planned_field_activities: num(r.planned_field_activities),
    active_style_cases: num(r.active_style_cases),
    avg_activity_intensity: num(r.avg_activity_intensity),
  }))
}

export type SyntheticFieldActivityByClosureBucket = {
  closure_bucket: string
  bucket_order: number
  sampled_cases: number
  planned_field_activities: number
  avg_activity_intensity: number
}

export async function getSyntheticFieldActivityByClosureBucket(): Promise<SyntheticFieldActivityByClosureBucket[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(SYNTHETIC_FIELD_ACTIVITY_BY_CLOSURE_BUCKET_VIEW)
    .select('closure_bucket, bucket_order, sampled_cases, planned_field_activities, avg_activity_intensity')
    .order('bucket_order', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    closure_bucket: (r.closure_bucket as string) || '—',
    bucket_order: num(r.bucket_order),
    sampled_cases: num(r.sampled_cases),
    planned_field_activities: num(r.planned_field_activities),
    avg_activity_intensity: num(r.avg_activity_intensity),
  }))
}

export type SyntheticFieldActivityByComplaintType = {
  complaint_type: string
  sampled_cases: number
  planned_field_activities: number
  active_style_cases: number
  avg_activity_intensity: number
}

export async function getSyntheticFieldActivityByComplaintType(limit = 12): Promise<SyntheticFieldActivityByComplaintType[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(SYNTHETIC_FIELD_ACTIVITY_BY_COMPLAINT_TYPE_VIEW)
    .select('complaint_type, sampled_cases, planned_field_activities, active_style_cases, avg_activity_intensity')
    .order('planned_field_activities', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    complaint_type: (r.complaint_type as string) || 'Uncategorized',
    sampled_cases: num(r.sampled_cases),
    planned_field_activities: num(r.planned_field_activities),
    active_style_cases: num(r.active_style_cases),
    avg_activity_intensity: num(r.avg_activity_intensity),
  }))
}
