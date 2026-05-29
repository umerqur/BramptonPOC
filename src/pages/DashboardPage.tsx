import { Link } from 'react-router-dom'
import StatCard from '../components/StatCard'
import RiskBadge from '../components/RiskBadge'
import SectionHeading from '../components/SectionHeading'
import {
  averageDaysOpen,
  casesByCategory,
  highPriorityCases,
  priorityQueue,
  recentSummaries,
  repeatComplaintLocations,
  totalOpenCases,
} from '../data/dashboard'

export default function DashboardPage() {
  const maxCategoryCount = Math.max(...casesByCategory.map((c) => c.count), 1)

  return (
    <div className="container-page py-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="section-eyebrow">Demo Dashboard</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">Operational overview</h1>
          <p className="mt-2 text-sm text-ink-muted max-w-2xl">
            Current dataset: public NYC 311 service requests normalized for POC modelling. Not Brampton operational
            data. Internal workflow fields shown here are synthetic and figures do not reflect any real City case load.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-subtle">
          <span className="h-2 w-2 rounded-full bg-accent-500" />
          Last refreshed: just now
        </div>
      </div>

      {/* KPI cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total open cases" value={totalOpenCases} hint="across all categories" />
        <StatCard
          label="High priority cases"
          value={highPriorityCases}
          trend={{ direction: 'up', text: '+2 vs last week' }}
        />
        <StatCard
          label="Repeat complaint locations"
          value={repeatComplaintLocations}
          hint="3+ complaints, same address"
        />
        <StatCard label="Avg days open" value={averageDaysOpen} hint="rolling 30-day window" />
      </div>

      {/* Row 1: categories + hotspot map */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-navy-900">Cases by category</h3>
            <span className="text-xs text-ink-subtle">Open cases</span>
          </div>
          <ul className="mt-4 space-y-3">
            {casesByCategory.map((row) => (
              <li key={row.category}>
                <div className="flex justify-between text-sm">
                  <span className="text-ink">{row.category}</span>
                  <span className="font-medium text-navy-900">{row.count}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-navy-700"
                    style={{ width: `${(row.count / maxCategoryCount) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-navy-900">Hotspots</h3>
            <span className="text-xs text-ink-subtle">Mock geospatial visualization</span>
          </div>
          <div className="mt-4 relative h-64 sm:h-80 rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
            <MapPlaceholder />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-subtle">
            <LegendDot color="bg-red-500" label="Critical cluster" />
            <LegendDot color="bg-orange-500" label="High activity" />
            <LegendDot color="bg-amber-400" label="Medium activity" />
            <LegendDot color="bg-slate-400" label="Background" />
          </div>
        </div>
      </div>

      {/* Priority queue */}
      <div className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <SectionHeading eyebrow="Priority Queue" title="Highest risk open cases" />
          <Link to="/cases" className="text-sm font-medium text-navy-700 hover:text-navy-900">
            View full queue →
          </Link>
        </div>

        <div className="mt-5 card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-ink-subtle">
                <tr className="text-left">
                  <Th>Case ID</Th>
                  <Th>Category</Th>
                  <Th>Ward</Th>
                  <Th>Address</Th>
                  <Th className="text-right">Days open</Th>
                  <Th className="text-right">Repeat</Th>
                  <Th className="text-right">Risk</Th>
                  <Th>Priority</Th>
                  <Th>Recommended action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {priorityQueue.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td>
                      <Link to={`/cases/${c.id}`} className="font-medium text-navy-900 hover:underline">{c.id}</Link>
                    </Td>
                    <Td>{c.category}</Td>
                    <Td>{c.ward}</Td>
                    <Td className="text-ink-muted">{c.address}</Td>
                    <Td className="text-right tabular-nums">{c.daysOpen}</Td>
                    <Td className="text-right tabular-nums">{c.repeatComplaints}</Td>
                    <Td className="text-right tabular-nums font-medium">{c.riskScore}</Td>
                    <Td><RiskBadge risk={c.risk} /></Td>
                    <Td className="text-ink-muted">{c.recommendedAction}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent AI summaries */}
      <div className="mt-10">
        <SectionHeading eyebrow="AI Summaries" title="Recent AI generated case summaries" />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {recentSummaries.map((s) => (
            <div key={s.id} className="card p-5 card-hover">
              <div className="flex items-center justify-between">
                <Link to={`/cases/${s.id}`} className="text-sm font-semibold text-navy-900 hover:underline">{s.id}</Link>
                <RiskBadge risk={s.risk} />
              </div>
              <div className="mt-1 text-xs text-ink-subtle">{s.category} · {s.ward}</div>
              <p className="mt-3 text-sm text-ink leading-relaxed">{s.summary}</p>
              <div className="mt-4 flex items-center gap-2 text-[11px] text-ink-subtle">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent-500" />
                AI generated · reviewed by staff before action
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${className}`}>{children}</th>
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  )
}

function MapPlaceholder() {
  return (
    <svg viewBox="0 0 600 300" className="w-full h-full">
      <defs>
        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#e2e8f0" strokeWidth="1" />
        </pattern>
        <radialGradient id="hot" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="warm" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="med" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="600" height="300" fill="url(#grid)" />
      {/* mock roads */}
      <path d="M0 110 L600 100" stroke="#cbd5e1" strokeWidth="3" />
      <path d="M0 210 L600 220" stroke="#cbd5e1" strokeWidth="3" />
      <path d="M180 0 L190 300" stroke="#cbd5e1" strokeWidth="3" />
      <path d="M420 0 L420 300" stroke="#cbd5e1" strokeWidth="3" />
      {/* heat blobs */}
      <circle cx="190" cy="110" r="80" fill="url(#hot)" />
      <circle cx="430" cy="220" r="70" fill="url(#warm)" />
      <circle cx="320" cy="160" r="55" fill="url(#med)" />
      {/* points */}
      <circle cx="190" cy="110" r="4" fill="#dc2626" />
      <circle cx="195" cy="115" r="3" fill="#dc2626" />
      <circle cx="183" cy="103" r="3" fill="#dc2626" />
      <circle cx="430" cy="220" r="3.5" fill="#ea580c" />
      <circle cx="438" cy="226" r="3" fill="#ea580c" />
      <circle cx="320" cy="160" r="3" fill="#d97706" />
      <text x="14" y="20" fontSize="10" fill="#64748b">Mock map · placeholder for geospatial layer</text>
    </svg>
  )
}
