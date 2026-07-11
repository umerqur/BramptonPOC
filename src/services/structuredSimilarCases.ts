import { supabase, isSupabaseConfigured } from '../lib/supabase'

// Structured Similar Cases — a RULES-BASED, deterministic similarity method
// over the real historical NYC 311 records in public.municipal_complaints.
//
// This intentionally does NOT use CTGAN, ABM scenarios, Cohere embeddings,
// Qdrant, or reranking. Candidates are narrowed with indexed structured
// filters (complaint type, closed with a usable closure history), then scored
// with a transparent weighted rule set documented below. The same inputs always
// produce the same output, and every surfaced row carries a short plain-language
// explanation of WHY it matched.
//
// DECISION SUPPORT ONLY: it surfaces comparable closed cases for staff
// reference. It never decides an outcome, and it exposes no resident personal
// information — every field shown comes from the public 311 benchmark record.

// ---------------------------------------------------------------------------
// Query input + result types
// ---------------------------------------------------------------------------

/**
 * The two explicit similarity modes:
 *   'nyc_historical'      — the current case IS an NYC 311 record. Structured
 *                           geography (borough / council district) and agency
 *                           are meaningful and scored.
 *   'brampton_benchmark'  — the current case is a Brampton resident request.
 *                           A Brampton ward (or the temporary nyc311_* alignment
 *                           district) is NOT comparable with an NYC borough or
 *                           council district, so geography and agency are
 *                           EXCLUDED from the score; the resident's reported
 *                           issue text drives the match instead, and the
 *                           results are benchmark references, not precedents.
 */
export type SimilarityMode = 'nyc_historical' | 'brampton_benchmark'

/** The structured fields of the CURRENT case the similarity runs against. */
export type SimilarCaseQuery = {
  mode: SimilarityMode
  /** The current case id — always excluded from results. */
  currentCaseId: string
  /** NYC 311 complaint type (verbatim for NYC cases, or the nyc311_* alignment
   *  value for resident cases — matched as a complaint-type family). */
  complaintType: string | null
  /** Brampton mode: the resident-facing request type label. */
  requestType?: string | null
  /** Brampton mode: the resident's reported-issue description (scored locally
   *  in the browser only — never sent to the database or shown). */
  description?: string | null
  happeningNow?: boolean | null
  /** NYC mode: subtype / descriptor text (request detail). */
  descriptor?: string | null
  /** NYC mode: agency / department. */
  agency?: string | null
  /** NYC mode only — never a Brampton ward or alignment district. */
  borough?: string | null
  /** NYC mode only. */
  councilDistrict?: string | null
  status?: string | null
  submittedAt?: string | null
  closedAt?: string | null
}

/** A candidate row read from public.municipal_complaints (non-PII, public 311 fields). */
export type SimilarCaseCandidate = {
  case_id: string
  complaint_type: string | null
  request_detail: string | null
  agency: string | null
  agency_name: string | null
  assigned_department: string | null
  borough: string | null
  council_district: string | null
  status: string | null
  submitted_at: string | null
  closed_at: string | null
  resolution_description: string | null
}

/** Conservative historical-resolution labels (see classifyHistoricalResolution). */
export type HistoricalResolutionLabel =
  | 'Condition corrected'
  | 'Referred to another agency'
  | 'No condition found'
  | 'Notice explicitly referenced'
  | 'Closed or resolved'

/** A scored, presentation-ready similar case (top 3 max). */
export type StructuredSimilarCase = {
  caseId: string
  complaintType: string | null
  /** Borough / council district display label. */
  area: string
  /** Agency / department the record carries. */
  agency: string | null
  status: string | null
  /** Whole days from submitted to closed, when both timestamps exist. */
  closureDays: number | null
  resolutionSummary: string | null
  /** Conservative label derived ONLY from explicit resolution phrasing —
   *  never an inferred enforcement action. Null when nothing explicit matched. */
  historicalResolution: HistoricalResolutionLabel | null
  /** Deterministic weighted score, 0..1. */
  similarityScore: number
  similarityPct: number
  /** Short plain-language reasons, e.g. "Same complaint type", "Same borough". */
  reasons: string[]
}

// ---------------------------------------------------------------------------
// Similarity weights — the full, documented rule set. Deterministic: the same
// query + candidates always produce the same scores and ordering.
//
//   complaintType    0.30  exact match = 1.0; same complaint family = 0.5
//                          (family = text before " - ", so "Noise - Residential"
//                          and "Noise - Street/Sidewalk" share the "Noise" family)
//   descriptor       0.15  token-set Jaccard overlap between descriptors
//   agency           0.10  exact agency / department match
//   borough          0.10  exact borough match (case-insensitive)
//   district         0.10  exact council district match
//   closureDuration  0.10  1 - |candidateDays - referenceDays| / (referenceDays + 7),
//                          floored at 0. Reference = the current case's own
//                          closure duration when it is closed; otherwise the
//                          median closure duration of the candidate pool (i.e.
//                          typical cases score higher than outliers).
//   season           0.05  same calendar month = 1.0; same season = 0.5
//   statusClass      0.10  same status class (closed-like vs open-like)
// ---------------------------------------------------------------------------

export const STRUCTURED_SIMILARITY_WEIGHTS = {
  complaintType: 0.3,
  descriptor: 0.15,
  agency: 0.1,
  borough: 0.1,
  district: 0.1,
  closureDuration: 0.1,
  season: 0.05,
  statusClass: 0.1,
} as const

// ---------------------------------------------------------------------------
// Brampton benchmark weights — used when the CURRENT case is a Brampton
// resident request and the candidates are NYC 311 benchmark records. Geography
// (borough / council district), agency, current-case closure duration, and
// status class are deliberately EXCLUDED: a Brampton ward or temporary
// alignment district is not comparable with NYC geography, and a Brampton
// intake status says nothing about an NYC record. What IS comparable is the
// reported issue itself:
//
//   complaintFamily   0.45  exact NYC complaint type = 1.0; same complaint
//                           family (text before " - ") = 0.7
//   requestTypeTerms  0.20  normalized token overlap between the resident's
//                           request type and the candidate's
//                           complaint_type + request_detail
//   descriptionTerms  0.25  normalized token overlap between the resident's
//                           reported-issue description and the candidate's
//                           complaint_type + request_detail (scored locally
//                           in the browser — the description is never sent
//                           to the database and contains no resident
//                           contact details by form design)
//   season            0.10  same calendar month = 1.0; same season = 0.5
// ---------------------------------------------------------------------------

export const BRAMPTON_BENCHMARK_WEIGHTS = {
  complaintFamily: 0.45,
  requestTypeTerms: 0.2,
  descriptionTerms: 0.25,
  season: 0.1,
} as const

/** Below this total score a candidate is not a useful comparison and is hidden. */
export const MIN_SIMILARITY_SCORE = 0.3
/** Show exactly this many rows at most. */
export const MAX_SIMILAR_CASES = 3
/** How many indexed candidates to pull before scoring. */
const CANDIDATE_LIMIT = 60

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

function eq(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = norm(a)
  return na.length > 0 && na === norm(b)
}

/** The complaint-type family: the text before " - " (NYC subtypes the types). */
export function complaintFamily(type: string | null | undefined): string {
  return norm(type).split(' - ')[0].trim()
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'was', 'were', 'is', 'are', 'no', 'not', 'this', 'that', 'by', 'as', 'from',
])

function tokens(s: string | null | undefined): Set<string> {
  return new Set(
    norm(s)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** Whole days between two ISO timestamps, or null when either is missing. */
export function closureDays(submittedAt: string | null | undefined, closedAt: string | null | undefined): number | null {
  if (!submittedAt || !closedAt) return null
  const ms = new Date(closedAt).getTime() - new Date(submittedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.floor(ms / 86_400_000)
}

function monthOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const m = new Date(iso).getMonth()
  return Number.isNaN(m) ? null : m
}

/** Meteorological season index (0..3) for a 0-based month. */
function seasonOf(month: number): number {
  return Math.floor(((month + 1) % 12) / 3)
}

/** Terminal status labels count as the "closed" class. */
export function statusClass(status: string | null | undefined, closedAt?: string | null): 'closed' | 'open' {
  if (closedAt) return 'closed'
  const s = norm(status)
  return s === 'closed' || s === 'resolved' || s === 'completed' ? 'closed' : 'open'
}

/** Median of a non-empty number array (deterministic; average of middle pair). */
function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ---------------------------------------------------------------------------
// Conservative historical-resolution classification.
//
// GOVERNANCE: this label never infers an enforcement action from vague text
// and never recommends anything. It only restates what the public NYC 311
// resolution_description EXPLICITLY says, using exact-phrase matching. A
// ticket / fine / warning / notice is never classified unless the source text
// explicitly references it. Anything ambiguous returns null (no label shown).
// ---------------------------------------------------------------------------

export function classifyHistoricalResolution(
  resolution: string | null,
): HistoricalResolutionLabel | null {
  const text = norm(resolution)
  if (!text) return null

  if (text.includes('condition was corrected')) {
    return 'Condition corrected'
  }
  if (text.includes('referred to') || text.includes('forwarded to another agency')) {
    return 'Referred to another agency'
  }
  if (
    text.includes('no violation was observed') ||
    text.includes('condition was not found') ||
    text.includes('no evidence of the violation')
  ) {
    return 'No condition found'
  }
  if (text.includes('notice was issued') || text.includes('notice of violation')) {
    return 'Notice explicitly referenced'
  }
  if (text.includes('closed') || text.includes('resolved')) {
    return 'Closed or resolved'
  }
  return null
}

// ---------------------------------------------------------------------------
// Deterministic scoring — pure and fully testable.
// ---------------------------------------------------------------------------

/** Season/month component shared by both modes: same month = 1, same season = 0.5. */
function seasonScore(queryMonth: number | null, candidateMonth: number | null, reasons: string[]): number {
  if (queryMonth == null || candidateMonth == null) return 0
  if (candidateMonth === queryMonth) {
    reasons.push('Same month of year')
    return 1
  }
  if (seasonOf(candidateMonth) === seasonOf(queryMonth)) {
    reasons.push('Same season')
    return 0.5
  }
  return 0
}

/** Complaint-type component shared by both modes: exact = 1, family = partial. */
function complaintTypeScore(
  query: SimilarCaseQuery,
  candidate: SimilarCaseCandidate,
  familyValue: number,
  reasons: string[],
): number {
  if (eq(candidate.complaint_type, query.complaintType)) {
    reasons.push('Same complaint type')
    return 1
  }
  const queryFamily = complaintFamily(query.complaintType)
  if (queryFamily && complaintFamily(candidate.complaint_type) === queryFamily) {
    reasons.push('Same complaint family')
    return familyValue
  }
  return 0
}

/** NYC-historical score: full structured geography + agency rule set. */
function scoreNycHistorical(
  query: SimilarCaseQuery,
  c: SimilarCaseCandidate,
  referenceDays: number | null,
): { score: number; reasons: string[] } {
  const w = STRUCTURED_SIMILARITY_WEIGHTS
  const reasons: string[] = []

  const complaintType = complaintTypeScore(query, c, 0.5, reasons)

  // Descriptor / subtype (0.15): token overlap.
  const descriptor = jaccard(tokens(query.descriptor), tokens(c.request_detail))
  if (descriptor >= 0.5) reasons.push('Same descriptor')
  else if (descriptor > 0) reasons.push('Similar descriptor')

  // Agency / department (0.10).
  const candidateAgency = c.agency ?? c.agency_name ?? c.assigned_department
  const agency = eq(candidateAgency, query.agency) ? 1 : 0
  if (agency) reasons.push('Same agency')

  // Borough (0.10) and council district (0.10).
  const borough = eq(c.borough, query.borough) ? 1 : 0
  if (borough) reasons.push('Same borough')
  const district = eq(c.council_district, query.councilDistrict) ? 1 : 0
  if (district) reasons.push('Same council district')

  // Closure duration (0.10): linear proximity to the reference duration.
  const days = closureDays(c.submitted_at, c.closed_at)
  let closureDuration = 0
  if (days != null && referenceDays != null) {
    closureDuration = Math.max(0, 1 - Math.abs(days - referenceDays) / (referenceDays + 7))
    if (closureDuration >= 0.6) reasons.push('Similar closure duration')
  }

  const season = seasonScore(monthOf(query.submittedAt), monthOf(c.submitted_at), reasons)

  // Status class / workflow pattern (0.10).
  const sClass = statusClass(c.status, c.closed_at) === statusClass(query.status, query.closedAt) ? 1 : 0
  if (sClass) reasons.push('Similar workflow status')

  return {
    score:
      w.complaintType * complaintType +
      w.descriptor * descriptor +
      w.agency * agency +
      w.borough * borough +
      w.district * district +
      w.closureDuration * closureDuration +
      w.season * season +
      w.statusClass * sClass,
    reasons,
  }
}

/**
 * Brampton-benchmark score: the reported issue drives the match. Geography,
 * agency, current-case closure duration, and status class are EXCLUDED — a
 * Brampton ward / alignment district is not an NYC borough or council district.
 */
function scoreBramptonBenchmark(
  query: SimilarCaseQuery,
  c: SimilarCaseCandidate,
): { score: number; reasons: string[] } {
  const w = BRAMPTON_BENCHMARK_WEIGHTS
  const reasons: string[] = []

  const family = complaintTypeScore(query, c, 0.7, reasons)

  // The candidate's issue text: complaint type + request detail.
  const candidateTerms = tokens([c.complaint_type, c.request_detail].filter(Boolean).join(' '))

  // Resident request type term overlap (0.20).
  const requestTypeTerms = jaccard(tokens(query.requestType), candidateTerms)
  if (requestTypeTerms > 0) reasons.push('Matches the request type')

  // Resident reported-issue description term overlap (0.25). Scored locally in
  // the browser only — the description never leaves the client here.
  const descriptionTerms = jaccard(tokens(query.description), candidateTerms)
  if (descriptionTerms >= 0.25) reasons.push('Matches the reported issue description')
  else if (descriptionTerms > 0) reasons.push('Overlaps the reported issue description')

  const season = seasonScore(monthOf(query.submittedAt), monthOf(c.submitted_at), reasons)

  return {
    score:
      w.complaintFamily * family +
      w.requestTypeTerms * requestTypeTerms +
      w.descriptionTerms * descriptionTerms +
      w.season * season,
    reasons,
  }
}

export function scoreSimilarCases(
  query: SimilarCaseQuery,
  candidates: SimilarCaseCandidate[],
): StructuredSimilarCase[] {
  // Reference closure duration (NYC mode only): the current case's own
  // duration when closed, otherwise the median of the candidate pool.
  const candidateDurations = candidates
    .map((c) => closureDays(c.submitted_at, c.closed_at))
    .filter((d): d is number => d != null)
  const referenceDays = closureDays(query.submittedAt, query.closedAt) ?? median(candidateDurations)

  const scored = candidates
    // Never surface the current case as its own neighbour.
    .filter((c) => c.case_id && c.case_id !== query.currentCaseId)
    // Brampton benchmarks must be CLOSED records with usable resolution text
    // (also enforced in the retrieval query — this keeps the rule testable).
    .filter(
      (c) =>
        query.mode !== 'brampton_benchmark' ||
        (!!c.closed_at && !!c.resolution_description?.trim()),
    )
    .map((c) => {
      const { score, reasons } =
        query.mode === 'brampton_benchmark'
          ? scoreBramptonBenchmark(query, c)
          : scoreNycHistorical(query, c, referenceDays)

      return {
        caseId: c.case_id,
        complaintType: c.complaint_type,
        area:
          [c.borough, c.council_district ? `District ${c.council_district}` : null]
            .filter(Boolean)
            .join(' · ') || '—',
        agency: c.agency_name ?? c.agency ?? c.assigned_department,
        status: c.status,
        closureDays: closureDays(c.submitted_at, c.closed_at),
        resolutionSummary: c.resolution_description?.trim() || null,
        historicalResolution: classifyHistoricalResolution(c.resolution_description ?? null),
        similarityScore: score,
        similarityPct: Math.round(score * 100),
        reasons: reasons.slice(0, 4),
      }
    })

  return scored
    .filter((s) => s.similarityScore >= MIN_SIMILARITY_SCORE)
    // Stable, deterministic ordering: score descending, case id as tiebreaker.
    .sort((a, b) => b.similarityScore - a.similarityScore || a.caseId.localeCompare(b.caseId))
    .slice(0, MAX_SIMILAR_CASES)
}

// ---------------------------------------------------------------------------
// Candidate retrieval — indexed structured filters only, mirroring the Case
// Explorer query pattern (source_city = 'NYC' + submitted_at is not null match
// the partial-index predicates on the ~3.4M-row table; the complaint-type
// filter rides idx_mc_nyc_complaint_type_submitted*). Never scans free text.
// ---------------------------------------------------------------------------

const CANDIDATE_COLUMNS =
  'case_id, complaint_type, request_detail, agency, agency_name, assigned_department, borough, council_district, status, submitted_at, closed_at, resolution_description'

/** Brampton mode pulls a wider pool (the text scoring narrows it client-side). */
const BRAMPTON_CANDIDATE_LIMIT = 200

export async function getStructuredSimilarCases(
  query: SimilarCaseQuery,
): Promise<StructuredSimilarCase[]> {
  if (!isSupabaseConfigured || !supabase) return []
  const family = complaintFamily(query.complaintType)
  if (!family) return []
  const familyPattern = `${family.replace(/[%_,]/g, ' ').trim()}%`

  if (query.mode === 'brampton_benchmark') {
    // Brampton resident request → comparable CLOSED NYC benchmark records with
    // an explicit resolution description. Only the complaint-type family (an
    // indexed prefix match) narrows server-side; the resident's request type
    // and description are scored locally and never sent to the database.
    const { data, error } = await supabase
      .from('municipal_complaints')
      .select(CANDIDATE_COLUMNS)
      .eq('source_city', 'NYC')
      .not('submitted_at', 'is', null)
      .not('closed_at', 'is', null)
      .not('resolution_description', 'is', null)
      .neq('case_id', query.currentCaseId)
      .ilike('complaint_type', familyPattern)
      .order('submitted_at', { ascending: false })
      .limit(BRAMPTON_CANDIDATE_LIMIT)
    if (error) throw new Error(error.message)
    return scoreSimilarCases(query, (data ?? []) as SimilarCaseCandidate[])
  }

  // NYC-historical mode: the current case is itself an NYC record.
  let q = supabase
    .from('municipal_complaints')
    .select(CANDIDATE_COLUMNS)
    .eq('source_city', 'NYC')
    .not('submitted_at', 'is', null)
    // Closed cases with a usable closure history only.
    .not('closed_at', 'is', null)
    .neq('case_id', query.currentCaseId)

  // Exact complaint type when we have the verbatim NYC value; otherwise match
  // the family prefix. ILIKE with a trailing wildcard stays on the
  // complaint_type index.
  if (query.complaintType && norm(query.complaintType) !== family) {
    q = q.eq('complaint_type', query.complaintType.trim())
  } else {
    q = q.ilike('complaint_type', familyPattern)
  }

  const { data, error } = await q.order('submitted_at', { ascending: false }).limit(CANDIDATE_LIMIT)
  if (error) throw new Error(error.message)
  return scoreSimilarCases(query, (data ?? []) as SimilarCaseCandidate[])
}

// ---------------------------------------------------------------------------
// Adapters — build a SimilarCaseQuery from the two case shapes the app has.
// ---------------------------------------------------------------------------

/**
 * From a Supabase resident service request — BRAMPTON BENCHMARK mode.
 *
 * The nyc311_district alignment value is deliberately NOT passed as borough:
 * a Brampton ward (or a temporary alignment district) is not comparable with
 * an NYC borough or council district, so geography and agency never enter the
 * score. The resident's request type and reported-issue description drive the
 * match instead (scored locally; no resident personal information is used —
 * name / contact fields are never read here).
 */
export function similarQueryFromResidentRow(row: {
  case_id: string
  request_type: string | null
  description: string | null
  status: string
  created_at: string | null
  nyc311_complaint_type: string | null
  nyc311_district: string | null
}): SimilarCaseQuery {
  return {
    mode: 'brampton_benchmark',
    currentCaseId: row.case_id,
    complaintType: row.nyc311_complaint_type,
    requestType: row.request_type,
    description: row.description,
    status: row.status,
    submittedAt: row.created_at,
  }
}

/**
 * From a workflow-store case — NYC HISTORICAL mode (these are actual NYC 311
 * records, so their borough / council district / agency are real NYC values
 * and are scored). Borough only ever comes from the verbatim NYC source
 * record; a normalized ward_or_area is never passed as NYC geography.
 */
export function similarQueryFromDemoCase(c: {
  id: string
  source: {
    nyc?: {
      complaintType: string | null
      descriptor: string | null
      agency: string | null
      borough: string | null
      councilDistrict: string | null
      status: string | null
      submittedAt: string | null
    }
  }
  normalized: {
    complaint_type: string | null
    request_detail: string | null
    ward_or_area: string | null
    status: string | null
    submitted_at: string | null
    assigned_department: string | null
  }
}): SimilarCaseQuery {
  const nyc = c.source.nyc
  return {
    mode: 'nyc_historical',
    currentCaseId: c.id,
    complaintType: nyc?.complaintType ?? c.normalized.complaint_type,
    descriptor: nyc?.descriptor ?? c.normalized.request_detail,
    agency: nyc?.agency ?? c.normalized.assigned_department,
    borough: nyc?.borough ?? null,
    councilDistrict: nyc?.councilDistrict ?? null,
    status: nyc?.status ?? c.normalized.status,
    submittedAt: nyc?.submittedAt ?? c.normalized.submitted_at,
  }
}
