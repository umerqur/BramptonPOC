import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { cases } from '../data/mockCases'
import type { Risk } from '../data/types'

// Primary data source: the ML-enriched view of municipal service requests.
// This table carries the base service-request columns plus advisory ML
// pattern-detection and hotspot fields produced by the local PyTorch pipeline.
export const TABLE = 'municipal_service_requests_ml_enriched'

/**
 * Standard advisory disclaimer for all ML-derived outputs. Surfaced in the UI
 * wherever an ML signal is shown.
 */
export const ML_ADVISORY =
  'ML outputs are advisory pattern detection signals only. They are not enforcement decisions. Final decisions remain with authorized municipal staff.'

/**
 * Shape of a row in the Supabase `municipal_service_requests_ml_enriched`
 * table. The base columns mirror
 * supabase/migrations/001_create_municipal_service_requests.sql; the `ml_*`
 * columns are added by the ML enrichment pipeline.
 */
export type MunicipalServiceRequestRow = {
  id: string
  source_city: string | null
  source_dataset: string | null
  source_id: string
  opened_at: string | null
  closed_at: string | null
  agency: string | null
  agency_name: string | null
  category: string | null
  subcategory: string | null
  issue_detail: string | null
  location_type: string | null
  postal_code: string | null
  address_label: string | null
  street_name: string | null
  city: string | null
  status: string | null
  closure_text: string | null
  community_board: string | null
  council_district: number | null
  district: string | null
  channel: string | null
  latitude: number | null
  longitude: number | null
  days_open: number | null
  is_closed: boolean | null
  risk_score: number | null
  risk_level: string | null
  recommended_action: string | null
  risk_drivers: string | null
  // --- ML enrichment fields (advisory pattern detection only) ---
  ml_violation_probability: number | null
  ml_violation_pattern_class: number | null
  ml_violation_pattern_label: string | null
  ml_model_name: string | null
  ml_model_version: string | null
  ml_decision_threshold: number | null
  ml_output_type: string | null
  ml_hotspot_cluster_id: number | null
  ml_hotspot_cluster_size: number | null
  ml_hotspot_score: number | null
  ml_hotspot_label: string | null
}

/**
 * A normalized view-model row used by the dashboard and case queue tables.
 * Both real Supabase rows and the mock fallback cases map into this shape so
 * the UI does not need to branch on the data source.
 */
export type RequestRow = {
  id: string
  category: string
  district: string
  address: string
  daysOpen: number
  riskScore: number
  risk: Risk
  recommendedAction: string
  status: string
  // --- advisory ML fields surfaced in the case queue ---
  mlProbability: number | null
  mlPatternClass: number | null
  mlPatternLabel: string
  mlHotspotScore: number | null
  mlHotspotLabel: string
  mlHotspotClusterId: number | null
}

export type CategoryCount = {
  category: string
  count: number
}

/** A single hotspot cluster marker for the geospatial view. */
export type Hotspot = {
  clusterId: number
  size: number
  score: number
  patternLabel: string
  hotspotLabel: string
  lat: number
  lng: number
}

export type DashboardStats = {
  total: number
  highRisk: number
  open: number
  avgDaysOpen: number
  /** Cases whose ML pattern label is a high-signal tier. */
  highSignal: number
  /** Cases whose ML pattern label is a moderate-signal tier. */
  moderateSignal: number
  /** Distinct ML hotspot clusters. */
  hotspotClusters: number
  categoriesByCount: CategoryCount[]
  topHighRisk: RequestRow[]
  hotspots: Hotspot[]
}

export type RequestFilters = {
  category?: string
  district?: string
  riskLevel?: string
  search?: string
  sort?: 'risk_score' | 'days_open'
  limit?: number
}

export type FilterOptions = {
  categories: string[]
  districts: string[]
}

export const RISK_LEVELS: Risk[] = ['Critical', 'High', 'Medium', 'Low']
const HIGH_RISK_LEVELS = ['High', 'Critical']

// Columns selected for table/list views. Keeps payloads small over 49k rows.
const LIST_COLUMNS =
  'source_id, category, district, address_label, street_name, status, days_open, risk_score, risk_level, recommended_action, ml_violation_probability, ml_violation_pattern_class, ml_violation_pattern_label, ml_hotspot_score, ml_hotspot_label, ml_hotspot_cluster_id'

/** Coerce an arbitrary risk_level string into the typed Risk union. */
export function normalizeRisk(value: string | null | undefined): Risk {
  const match = RISK_LEVELS.find((r) => r.toLowerCase() === String(value ?? '').toLowerCase())
  return match ?? 'Low'
}

function rowAddress(row: Pick<MunicipalServiceRequestRow, 'address_label' | 'street_name'>): string {
  return row.address_label || row.street_name || 'Address not recorded'
}

function mapRow(row: Partial<MunicipalServiceRequestRow>): RequestRow {
  return {
    id: row.source_id ?? '',
    category: row.category || 'Uncategorized',
    district: row.district || 'Unknown',
    address: rowAddress(row as MunicipalServiceRequestRow),
    daysOpen: row.days_open ?? 0,
    riskScore: row.risk_score ?? 0,
    risk: normalizeRisk(row.risk_level),
    recommendedAction: row.recommended_action || 'Standard processing',
    status: row.status || 'Unknown',
    mlProbability: row.ml_violation_probability ?? null,
    mlPatternClass: row.ml_violation_pattern_class ?? null,
    mlPatternLabel: row.ml_violation_pattern_label || '—',
    mlHotspotScore: row.ml_hotspot_score ?? null,
    mlHotspotLabel: row.ml_hotspot_label || '—',
    mlHotspotClusterId: row.ml_hotspot_cluster_id ?? null,
  }
}

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured')
  }
  return supabase
}

/**
 * Fetch service requests for the case queue. Filtering for category, district,
 * risk level and free-text search is performed server-side; results are
 * ordered by the requested sort column and capped by `limit`.
 */
export async function getMunicipalServiceRequests(filters: RequestFilters = {}): Promise<RequestRow[]> {
  const client = requireClient()
  const { category, district, riskLevel, search, sort = 'risk_score', limit = 500 } = filters

  let query = client.from(TABLE).select(LIST_COLUMNS)

  if (category && category !== 'All') query = query.eq('category', category)
  if (district && district !== 'All') query = query.eq('district', district)
  if (riskLevel && riskLevel !== 'All') query = query.eq('risk_level', riskLevel)

  const trimmed = search?.trim()
  if (trimmed) {
    // Strip characters that have special meaning in a PostgREST `or` filter.
    const term = trimmed.replace(/[,()*%]/g, ' ').trim()
    if (term) {
      query = query.or(
        [
          `source_id.ilike.%${term}%`,
          `category.ilike.%${term}%`,
          `district.ilike.%${term}%`,
          `address_label.ilike.%${term}%`,
          `street_name.ilike.%${term}%`,
        ].join(','),
      )
    }
  }

  const { data, error } = await query.order(sort, { ascending: false, nullsFirst: false }).limit(limit)
  if (error) throw error
  return (data ?? []).map(mapRow)
}

/** Highest risk-scored requests, used for the dashboard priority queue. */
export async function getHighRiskRequests(limit = 6): Promise<RequestRow[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(TABLE)
    .select(LIST_COLUMNS)
    .order('risk_score', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map(mapRow)
}

/** A single request looked up by its source_id (the public-facing id). */
export async function getRequestBySourceId(sourceId: string): Promise<MunicipalServiceRequestRow | null> {
  const client = requireClient()
  const { data, error } = await client.from(TABLE).select('*').eq('source_id', sourceId).maybeSingle()
  if (error) throw error
  return (data as MunicipalServiceRequestRow) ?? null
}

async function countWhere(apply?: (q: ReturnType<typeof buildCountQuery>) => unknown): Promise<number> {
  let query = buildCountQuery()
  if (apply) query = apply(query) as typeof query
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

function buildCountQuery() {
  return requireClient().from(TABLE).select('*', { count: 'exact', head: true })
}

/**
 * Aggregate statistics for the dashboard.
 *
 * Resilience strategy (so a single capability gap doesn't drop the whole
 * dashboard to mock data):
 *   1. Foundational read — a cheap exact total count plus a bounded sample
 *      via plain `select`. These are the simplest possible queries; if they
 *      fail the table is genuinely unreadable (missing table or blocking RLS)
 *      and the page falls back to mock data.
 *   2. Exact KPI counts (high-risk, open) via cheap `head` count queries.
 *      These never use aggregate functions, so they work regardless of
 *      project settings; if one does fail we estimate from the sample rather
 *      than discarding the real data we already have.
 *   3. Category breakdown + average days-open via PostgREST aggregate
 *      functions, which some projects disable. On failure we derive both from
 *      the sample fetched in step 1.
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  const client = requireClient()

  // Step 1 — foundational read. A failure here is fatal (handled by caller).
  const [totalRes, sampleRes] = await Promise.all([
    client.from(TABLE).select('*', { count: 'exact', head: true }),
    client
      .from(TABLE)
      .select('category, days_open, risk_level, is_closed, ml_violation_pattern_label')
      .limit(1000),
  ])
  if (totalRes.error) throw totalRes.error
  if (sampleRes.error) throw sampleRes.error

  const total = totalRes.count ?? 0
  const sample = (sampleRes.data ?? []) as Array<
    Pick<
      MunicipalServiceRequestRow,
      'category' | 'days_open' | 'risk_level' | 'is_closed' | 'ml_violation_pattern_label'
    >
  >

  // Step 2 — exact KPI counts and the priority queue. Each degrades on its own
  // instead of taking down the whole dashboard.
  const [highRisk, open, highSignal, moderateSignal, hotspotClusters, hotspots, topHighRisk] =
    await Promise.all([
      countWhere((q) => q.in('risk_level', HIGH_RISK_LEVELS)).catch(() =>
        sample.filter((r) => HIGH_RISK_LEVELS.includes(normalizeRisk(r.risk_level))).length,
      ),
      countWhere((q) => q.eq('is_closed', false)).catch(() =>
        sample.filter((r) => r.is_closed === false).length,
      ),
      // Signal tiers map to the ML pattern label (high / moderate / low). If the
      // enrichment uses a different labelling scheme, adjust SIGNAL_MATCH below.
      countWhere((q) => q.ilike('ml_violation_pattern_label', SIGNAL_MATCH.high)).catch(
        () => sample.filter((r) => isSignal(r.ml_violation_pattern_label, 'high')).length,
      ),
      countWhere((q) => q.ilike('ml_violation_pattern_label', SIGNAL_MATCH.moderate)).catch(
        () => sample.filter((r) => isSignal(r.ml_violation_pattern_label, 'moderate')).length,
      ),
      getHotspotClusterCount(client).catch((err) => {
        console.warn('Hotspot cluster count failed, omitting:', err)
        return 0
      }),
      getHotspots(client).catch((err) => {
        console.warn('Hotspot query failed, omitting:', err)
        return [] as Hotspot[]
      }),
      getHighRiskRequests(6).catch((err) => {
        console.warn('Priority queue query failed, omitting:', err)
        return [] as RequestRow[]
      }),
    ])

  // Step 3 — category breakdown and average. Try true DB aggregates first,
  // then fall back to the in-memory sample.
  let categoriesByCount: CategoryCount[]
  let avgDaysOpen: number
  try {
    ;[categoriesByCount, avgDaysOpen] = await Promise.all([
      getCategoriesByCount(client),
      getAverageDaysOpen(client),
    ])
  } catch (err) {
    console.warn('Aggregate queries unavailable, using sampled estimates:', err)
    const sampled = sampledAggregates(sample)
    categoriesByCount = sampled.categoriesByCount
    avgDaysOpen = sampled.avgDaysOpen
  }

  return {
    total,
    highRisk,
    open,
    avgDaysOpen,
    highSignal,
    moderateSignal,
    hotspotClusters,
    categoriesByCount,
    topHighRisk,
    hotspots,
  }
}

// ML pattern-signal tier matching. Signal tiers are read from
// `ml_violation_pattern_label` (case-insensitive substring). Centralized here
// so the labelling scheme can be adjusted in one place.
const SIGNAL_MATCH = { high: '%high%', moderate: '%moderate%', low: '%low%' } as const

function isSignal(label: string | null | undefined, tier: 'high' | 'moderate' | 'low'): boolean {
  return String(label ?? '').toLowerCase().includes(tier)
}

/**
 * Count of distinct ML hotspot clusters. Uses a PostgREST group-by aggregate
 * (one row per cluster id) so the payload stays bounded (~hundreds of rows)
 * rather than scanning all 49k records.
 */
async function getHotspotClusterCount(client: NonNullable<typeof supabase>): Promise<number> {
  const { data, error } = await client.from(TABLE).select('ml_hotspot_cluster_id, n:source_id.count()')
  if (error) throw error
  return ((data ?? []) as Array<{ ml_hotspot_cluster_id: number | null }>).filter(
    (r) => r.ml_hotspot_cluster_id != null,
  ).length
}

/**
 * One representative marker per hotspot cluster for the geospatial view.
 * Fetches the highest-scoring rows that belong to a cluster and have
 * coordinates, then keeps the first row seen per cluster id.
 */
export async function getHotspots(
  client: NonNullable<typeof supabase>,
  limit = 250,
): Promise<Hotspot[]> {
  const { data, error } = await client
    .from(TABLE)
    .select(
      'ml_hotspot_cluster_id, ml_hotspot_cluster_size, ml_hotspot_score, ml_hotspot_label, ml_violation_pattern_label, latitude, longitude',
    )
    .not('ml_hotspot_cluster_id', 'is', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .order('ml_hotspot_score', { ascending: false, nullsFirst: false })
    .limit(2000)
  if (error) throw error

  const seen = new Set<number>()
  const out: Hotspot[] = []
  for (const r of (data ?? []) as Array<Partial<MunicipalServiceRequestRow>>) {
    const clusterId = r.ml_hotspot_cluster_id
    if (clusterId == null || seen.has(clusterId)) continue
    if (r.latitude == null || r.longitude == null) continue
    seen.add(clusterId)
    out.push({
      clusterId,
      size: r.ml_hotspot_cluster_size ?? 0,
      score: r.ml_hotspot_score ?? 0,
      patternLabel: r.ml_violation_pattern_label || '—',
      hotspotLabel: r.ml_hotspot_label || '—',
      lat: r.latitude,
      lng: r.longitude,
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Category counts and average days-open derived from an already-fetched sample
 * of rows. Used as a fallback when PostgREST aggregate functions are disabled.
 */
function sampledAggregates(
  rows: Array<Pick<MunicipalServiceRequestRow, 'category' | 'days_open'>>,
): { categoriesByCount: CategoryCount[]; avgDaysOpen: number } {
  const counts = new Map<string, number>()
  let daysSum = 0
  let daysCount = 0
  for (const r of rows) {
    if (r.category) counts.set(r.category, (counts.get(r.category) ?? 0) + 1)
    if (typeof r.days_open === 'number') {
      daysSum += r.days_open
      daysCount += 1
    }
  }
  return {
    categoriesByCount: Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    avgDaysOpen: daysCount ? Math.round(daysSum / daysCount) : 0,
  }
}

async function getCategoriesByCount(client: NonNullable<typeof supabase>): Promise<CategoryCount[]> {
  const { data, error } = await client
    .from(TABLE)
    // PostgREST aggregate: group by category, count rows per group.
    .select('category, count:source_id.count()')
  if (error) throw error
  return ((data ?? []) as Array<{ category: string | null; count: number }>)
    .filter((r) => r.category)
    .map((r) => ({ category: r.category as string, count: Number(r.count) || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
}

async function getAverageDaysOpen(client: NonNullable<typeof supabase>): Promise<number> {
  const { data, error } = await client.from(TABLE).select('avg:days_open.avg()').single()
  if (error) throw error
  const avg = (data as { avg: number | string | null } | null)?.avg
  return Math.round(Number(avg) || 0)
}

/**
 * Distinct categories and districts for the case queue filter dropdowns.
 * Derived from a bounded sample of rows so it works without DB-side DISTINCT.
 */
export async function getFilterOptions(): Promise<FilterOptions> {
  const client = requireClient()
  const { data, error } = await client.from(TABLE).select('category, district').limit(1000)
  if (error) throw error
  const rows = (data ?? []) as Array<Pick<MunicipalServiceRequestRow, 'category' | 'district'>>
  const unique = (values: Array<string | null>) =>
    Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b))
  return {
    categories: unique(rows.map((r) => r.category)),
    districts: unique(rows.map((r) => r.district)),
  }
}

// ---------------------------------------------------------------------------
// Mock fallback helpers — used when Supabase is not configured or a query
// fails, so the POC still renders without a live backend. Do not remove.
// ---------------------------------------------------------------------------

/**
 * Synthesize advisory ML fields from a mock case so the fallback UI mirrors the
 * live ML-enriched shape. These are derived from the existing mock signals
 * (risk + repeat complaints), not real model output.
 */
function mockMlFields(c: (typeof cases)[number]): {
  mlProbability: number
  mlPatternClass: number
  mlPatternLabel: string
  mlHotspotScore: number | null
  mlHotspotLabel: string
  mlHotspotClusterId: number | null
} {
  const mlProbability = Math.min(1, Math.max(0, Math.round((c.riskScore / 100) * 100) / 100))
  const tier = c.risk === 'Critical' || c.risk === 'High' ? 'High' : c.risk === 'Medium' ? 'Moderate' : 'Low'
  const clustered = c.repeatComplaints >= 3
  return {
    mlProbability,
    mlPatternClass: tier === 'High' ? 2 : tier === 'Moderate' ? 1 : 0,
    mlPatternLabel: `${tier} pattern signal`,
    mlHotspotScore: clustered ? Math.round(mlProbability * 100) / 100 : null,
    mlHotspotLabel: clustered ? 'Active cluster' : c.repeatComplaints >= 2 ? 'Emerging cluster' : 'No cluster',
    mlHotspotClusterId: clustered ? 400 + (Number(c.id.replace(/\D/g, '')) % 13) : null,
  }
}

export function mockRequestRows(): RequestRow[] {
  return cases
    .slice()
    .sort((a, b) => b.riskScore - a.riskScore)
    .map((c) => ({
      id: c.id,
      category: c.category,
      district: c.ward,
      address: c.address,
      daysOpen: c.daysOpen,
      riskScore: c.riskScore,
      risk: c.risk,
      recommendedAction: c.recommendedAction,
      status: c.status,
      ...mockMlFields(c),
    }))
}

export function mockFilterOptions(): FilterOptions {
  const rows = mockRequestRows()
  const unique = (values: string[]) => Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
  return {
    categories: unique(rows.map((r) => r.category)),
    districts: unique(rows.map((r) => r.district)),
  }
}

export function mockDashboardStats(): DashboardStats {
  const rows = mockRequestRows()
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1)

  // Build hotspot markers from clustered mock rows with deterministic pseudo
  // coordinates around a Brampton-area bounding box.
  const clusterSeen = new Set<number>()
  const hotspots: Hotspot[] = []
  rows.forEach((r, i) => {
    if (r.mlHotspotClusterId == null || clusterSeen.has(r.mlHotspotClusterId)) return
    clusterSeen.add(r.mlHotspotClusterId)
    hotspots.push({
      clusterId: r.mlHotspotClusterId,
      size: Math.max(2, r.riskScore % 9),
      score: r.mlHotspotScore ?? 0,
      patternLabel: r.mlPatternLabel,
      hotspotLabel: r.mlHotspotLabel,
      lat: 43.68 + ((i * 7) % 20) / 100,
      lng: -79.78 + ((i * 11) % 24) / 100,
    })
  })

  return {
    total: rows.length,
    highRisk: rows.filter((r) => r.risk === 'High' || r.risk === 'Critical').length,
    open: rows.filter((r) => r.status !== 'Closed').length,
    avgDaysOpen: Math.round(rows.reduce((s, r) => s + r.daysOpen, 0) / Math.max(rows.length, 1)),
    highSignal: rows.filter((r) => isSignal(r.mlPatternLabel, 'high')).length,
    moderateSignal: rows.filter((r) => isSignal(r.mlPatternLabel, 'moderate')).length,
    hotspotClusters: clusterSeen.size,
    categoriesByCount: Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    topHighRisk: rows.slice(0, 6),
    hotspots,
  }
}

/** Client-side equivalent of the server filters, for the mock fallback path. */
export function filterMockRows(rows: RequestRow[], filters: RequestFilters): RequestRow[] {
  const { category, district, riskLevel, search, sort = 'risk_score' } = filters
  const q = search?.trim().toLowerCase()
  return rows
    .filter((r) => (!category || category === 'All' ? true : r.category === category))
    .filter((r) => (!district || district === 'All' ? true : r.district === district))
    .filter((r) => (!riskLevel || riskLevel === 'All' ? true : r.risk === riskLevel))
    .filter((r) => {
      if (!q) return true
      return (
        r.id.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.district.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => (sort === 'days_open' ? b.daysOpen - a.daysOpen : b.riskScore - a.riskScore))
}
