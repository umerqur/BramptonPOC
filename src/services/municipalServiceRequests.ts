import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { cases } from '../data/mockCases'
import type { Risk } from '../data/types'

export const TABLE = 'municipal_service_requests'

/**
 * Shape of a row in the Supabase `municipal_service_requests` table.
 * Mirrors supabase/migrations/001_create_municipal_service_requests.sql.
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
}

export type CategoryCount = {
  category: string
  count: number
}

export type DashboardStats = {
  total: number
  highRisk: number
  open: number
  avgDaysOpen: number
  categoriesByCount: CategoryCount[]
  topHighRisk: RequestRow[]
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
  'source_id, category, district, address_label, street_name, status, days_open, risk_score, risk_level, recommended_action'

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
    client.from(TABLE).select('category, days_open, risk_level, is_closed').limit(1000),
  ])
  if (totalRes.error) throw totalRes.error
  if (sampleRes.error) throw sampleRes.error

  const total = totalRes.count ?? 0
  const sample = (sampleRes.data ?? []) as Array<
    Pick<MunicipalServiceRequestRow, 'category' | 'days_open' | 'risk_level' | 'is_closed'>
  >

  // Step 2 — exact KPI counts and the priority queue. Each degrades on its own
  // instead of taking down the whole dashboard.
  const [highRisk, open, topHighRisk] = await Promise.all([
    countWhere((q) => q.in('risk_level', HIGH_RISK_LEVELS)).catch(() =>
      sample.filter((r) => HIGH_RISK_LEVELS.includes(normalizeRisk(r.risk_level))).length,
    ),
    countWhere((q) => q.eq('is_closed', false)).catch(() =>
      sample.filter((r) => r.is_closed === false).length,
    ),
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

  return { total, highRisk, open, avgDaysOpen, categoriesByCount, topHighRisk }
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
  return {
    total: rows.length,
    highRisk: rows.filter((r) => r.risk === 'High' || r.risk === 'Critical').length,
    open: rows.filter((r) => r.status !== 'Closed').length,
    avgDaysOpen: Math.round(rows.reduce((s, r) => s + r.daysOpen, 0) / Math.max(rows.length, 1)),
    categoriesByCount: Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    topHighRisk: rows.slice(0, 6),
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
