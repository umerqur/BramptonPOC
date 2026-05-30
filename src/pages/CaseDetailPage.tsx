import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import RiskBadge from '../components/RiskBadge'
import { findCase } from '../data/mockCases'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  getRequestBySourceId,
  normalizeRisk,
  type MunicipalServiceRequestRow,
} from '../services/municipalServiceRequests'

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const mock = id ? findCase(id) : undefined

  // Only query Supabase when the id is not a bundled mock case.
  const [row, setRow] = useState<MunicipalServiceRequestRow | null | undefined>(undefined)
  const [loading, setLoading] = useState(!mock && isSupabaseConfigured)

  useEffect(() => {
    let active = true
    if (mock || !id || !isSupabaseConfigured) {
      setRow(null)
      setLoading(false)
      return
    }
    setLoading(true)
    getRequestBySourceId(id)
      .then((data) => active && setRow(data))
      .catch((err) => {
        console.error('Failed to load service request from Supabase:', err)
        if (active) setRow(null)
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [id, mock])

  if (mock) return <MockCaseDetail c={mock} />
  if (loading) {
    return (
      <div className="container-page py-16 text-center text-ink-subtle">Loading service request…</div>
    )
  }
  if (row) return <RequestDetail row={row} />

  return (
    <div className="container-page py-16 text-center">
      <h1 className="text-2xl font-semibold text-navy-900">Case not found</h1>
      <p className="mt-2 text-ink-muted">No service request with ID <span className="font-mono">{id}</span>.</p>
      <Link to="/cases" className="mt-6 inline-block btn-primary">Back to case queue</Link>
    </div>
  )
}

function RequestDetail({ row }: { row: MunicipalServiceRequestRow }) {
  const risk = normalizeRisk(row.risk_level)
  const address = row.address_label || row.street_name || 'Address not recorded'
  const drivers = (row.risk_drivers ?? '').split('|').map((d) => d.trim()).filter(Boolean)

  return (
    <div className="container-page py-10">
      <div className="text-xs text-ink-subtle">
        <Link to="/cases" className="link-quiet">Case Queue</Link>
        <span className="mx-2">/</span>
        <span>{row.source_id}</span>
      </div>

      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">{row.source_id}</h1>
            <RiskBadge risk={risk} />
            {row.status && <span className="badge bg-navy-900/5 text-navy-900">{row.status}</span>}
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {[row.category, row.district, address].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled>Assign officer</button>
          <button className="btn-primary" disabled>Take recommended action</button>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-ink-subtle">
        Public NYC 311 service request normalized for POC modelling. Not Brampton operational data. Buttons disabled in
        POC — decision support only.
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card title="Request detail">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label="Category" value={row.category} />
              <Field label="Subcategory" value={row.subcategory} />
              <Field label="Issue detail" value={row.issue_detail} />
              <Field label="Location type" value={row.location_type} />
              <Field label="Agency" value={row.agency_name || row.agency} />
              <Field label="Channel" value={row.channel} />
            </dl>
          </Card>

          <Card title="Resolution">
            <p className="text-sm text-ink leading-relaxed">
              {row.closure_text || 'No closure or resolution text recorded for this request.'}
            </p>
          </Card>

          <Card title="Risk explanation">
            <div className="flex items-center gap-3">
              <div className="text-xs text-ink-subtle">Risk score</div>
              <div className="text-2xl font-semibold text-navy-900 tabular-nums">{row.risk_score ?? '—'}</div>
              <RiskBadge risk={risk} />
            </div>
            <ul className="mt-4 space-y-2">
              {drivers.length === 0 ? (
                <li className="text-sm text-ink-subtle">No risk drivers recorded.</li>
              ) : (
                drivers.map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent-500 shrink-0" />
                    <span>{d}</span>
                  </li>
                ))
              )}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Recommended action">
            <div className="text-sm text-ink-muted">Model recommendation, pending staff review</div>
            <div className="mt-2 text-base font-semibold text-navy-900">
              {row.recommended_action || 'Standard processing'}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-ink-subtle">
              <Metric label="Days open" value={row.days_open ?? '—'} />
              <Metric label="Status" value={row.is_closed ? 'Closed' : 'Open'} />
            </div>
          </Card>

          <Card title="Record">
            <dl className="space-y-2 text-sm">
              <Field label="Opened" value={formatDate(row.opened_at)} />
              <Field label="Closed" value={formatDate(row.closed_at)} />
              <Field label="Postal code" value={row.postal_code} />
              <Field label="District" value={row.district} />
              <Field label="Source" value={row.source_dataset} />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}

function MockCaseDetail({ c }: { c: NonNullable<ReturnType<typeof findCase>> }) {
  return (
    <div className="container-page py-10">
      <div className="text-xs text-ink-subtle">
        <Link to="/cases" className="link-quiet">Case Queue</Link>
        <span className="mx-2">/</span>
        <span>{c.id}</span>
      </div>

      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">{c.id}</h1>
            <RiskBadge risk={c.risk} />
            <span className="badge bg-slate-100 text-slate-700">{c.priority}</span>
            <span className="badge bg-navy-900/5 text-navy-900">{c.status}</span>
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {c.category} · {c.ward} · {c.address}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled>Assign officer</button>
          <button className="btn-primary" disabled>Take recommended action</button>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-ink-subtle">
        Buttons disabled in POC — decision support only. Final action remains with authorized municipal staff.
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          <Card title="Case summary" aiGenerated>
            <p className="text-sm text-ink leading-relaxed">{c.summary}</p>
          </Card>

          <Card title="Complaint history" hint={`${c.complaints.length} records`}>
            <ul className="divide-y divide-slate-100">
              {c.complaints.map((s) => (
                <li key={s.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3 text-xs text-ink-subtle">
                    <span className="font-mono">{s.id}</span>
                    <span>{s.date} · {s.channel}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink">{s.summary}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Risk explanation" aiGenerated>
            <div className="flex items-center gap-3">
              <div className="text-xs text-ink-subtle">Risk score</div>
              <div className="text-2xl font-semibold text-navy-900 tabular-nums">{c.riskScore}</div>
              <RiskBadge risk={c.risk} />
            </div>
            <ul className="mt-4 space-y-2">
              {c.riskDrivers.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent-500 shrink-0" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Officer briefing" aiGenerated>
            <ol className="space-y-3">
              {c.briefing.map((p, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="text-xs font-semibold text-accent-700 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-ink leading-relaxed">{p}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <Card title="Recommended action">
            <div className="text-sm text-ink-muted">AI recommendation, pending staff review</div>
            <div className="mt-2 text-base font-semibold text-navy-900">{c.recommendedAction}</div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-ink-subtle">
              <Metric label="Days open" value={c.daysOpen} />
              <Metric label="Repeat complaints" value={c.repeatComplaints} />
            </div>
          </Card>

          <Card title="Similar cases" hint={`${c.similarCases.length}`}>
            {c.similarCases.length === 0 ? (
              <div className="text-sm text-ink-subtle">No similar active cases identified.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {c.similarCases.map((sid) => (
                  <li key={sid}>
                    <Link to={`/cases/${sid}`} className="link-quiet font-medium">{sid}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Audit trail" hint="placeholder">
            <ul className="space-y-3 text-xs">
              <AuditEntry time="just now" actor="System" text="AI case summary regenerated" />
              <AuditEntry time="2h ago" actor="J. Lee (Triage)" text="Risk reviewed and acknowledged" />
              <AuditEntry time="yesterday" actor="System" text="Case opened from intake batch" />
              <AuditEntry time="—" actor="—" text="Full audit trail available in production with role based access" />
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-ink">{value || '—'}</dd>
    </div>
  )
}

function Card({
  title,
  hint,
  aiGenerated,
  children,
}: {
  title: string
  hint?: string
  aiGenerated?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
        <div className="flex items-center gap-2 text-xs text-ink-subtle">
          {aiGenerated && (
            <span className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-0.5 text-accent-800 ring-1 ring-inset ring-accent-200">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
              AI generated
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 p-2.5">
      <div className="text-[10px] uppercase tracking-wider">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-navy-900 tabular-nums">{value}</div>
    </div>
  )
}

function AuditEntry({ time, actor, text }: { time: string; actor: string; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
      <div className="flex-1">
        <div className="text-ink">{text}</div>
        <div className="text-ink-subtle">{actor} · {time}</div>
      </div>
    </li>
  )
}
