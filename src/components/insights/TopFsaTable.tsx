import { useState } from 'react'
import type { WorkloadInsightRow } from '../../services/municipalServiceRequests'

const TIER_BADGE: Record<string, string> = {
  high: 'bg-rose-100 text-rose-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-emerald-100 text-emerald-800',
}

function TierBadge({ tier }: { tier: string }) {
  const t = (tier || '').toLowerCase()
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${TIER_BADGE[t] ?? 'bg-slate-100 text-slate-700'}`}>
      {t ? t.charAt(0).toUpperCase() + t.slice(1) : '—'}
    </span>
  )
}

/**
 * Ranked table of FSAs by workload score. Shows the prior-period volume ranking,
 * the predicted tier/score, and the realized April volume side by side so the
 * persistence relationship is visible rather than hidden.
 */
export default function TopFsaTable({ rows }: { rows: WorkloadInsightRow[] }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? rows : rows.slice(0, 15)

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">Top FSAs by workload</h2>
          <p className="text-xs text-ink-subtle">Ordered by workload score (highest first)</p>
        </div>
        {rows.length > 15 && (
          <button onClick={() => setShowAll((v) => !v)} className="btn-secondary text-xs py-1.5 px-3">
            {showAll ? 'Show top 15' : `Show all ${rows.length}`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-ink-subtle">
            <tr className="text-left">
              <Th>#</Th>
              <Th>FSA</Th>
              <Th>Tier</Th>
              <Th className="text-right">Workload score</Th>
              <Th className="text-right">Prior volume</Th>
              <Th className="text-right">Actual Apr volume</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((r, i) => (
              <tr key={r.location_id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 text-ink-subtle tabular-nums">{i + 1}</td>
                <td className="px-4 py-2.5 font-medium text-navy-900">{r.location_id}</td>
                <td className="px-4 py-2.5"><TierBadge tier={r.predicted_tier} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.workload_score.toFixed(3)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                  {r.prior_complaint_count?.toLocaleString() ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                  {r.actual_volume?.toLocaleString() ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-ink-subtle">
        Workload score is a calibrated planning signal, not a risk rating. FSA-level only — this view does not claim
        street-level hotspots.
      </p>
    </section>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${className}`}>
      {children}
    </th>
  )
}
