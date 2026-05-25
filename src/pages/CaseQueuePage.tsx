import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import RiskBadge from '../components/RiskBadge'
import { cases } from '../data/mockCases'
import type { Category, Risk } from '../data/types'

const categories: ('All' | Category)[] = [
  'All',
  'Property Standards',
  'Parking',
  'Noise',
  'Waste',
  'Zoning',
  'Licensing',
  'Illegal Dumping',
  'Grass and Weeds',
]
const risks: ('All' | Risk)[] = ['All', 'Critical', 'High', 'Medium', 'Low']

type SortKey = 'riskScore' | 'daysOpen' | 'repeatComplaints'

export default function CaseQueuePage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<(typeof categories)[number]>('All')
  const [risk, setRisk] = useState<(typeof risks)[number]>('All')
  const [sortKey, setSortKey] = useState<SortKey>('riskScore')

  const filtered = useMemo(() => {
    return cases
      .filter((c) => (category === 'All' ? true : c.category === category))
      .filter((c) => (risk === 'All' ? true : c.risk === risk))
      .filter((c) => {
        if (!query.trim()) return true
        const q = query.toLowerCase()
        return (
          c.id.toLowerCase().includes(q) ||
          c.address.toLowerCase().includes(q) ||
          c.ward.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number))
  }, [query, category, risk, sortKey])

  return (
    <div className="container-page py-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="section-eyebrow">Case Queue</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">All open cases</h1>
          <p className="mt-2 text-sm text-ink-muted">{filtered.length} of {cases.length} cases shown · mock data</p>
        </div>
      </div>

      <div className="mt-6 card p-4">
        <div className="grid gap-3 md:grid-cols-12 items-end">
          <div className="md:col-span-5">
            <label className="text-xs font-medium text-ink-subtle">Search</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search case ID, address, ward, or category"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
            />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs font-medium text-ink-subtle">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as (typeof categories)[number])}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-ink-subtle">Risk</label>
            <select
              value={risk}
              onChange={(e) => setRisk(e.target.value as (typeof risks)[number])}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              {risks.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-ink-subtle">Sort by</label>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="riskScore">Risk score</option>
              <option value="daysOpen">Days open</option>
              <option value="repeatComplaints">Repeat complaints</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mt-6 card overflow-hidden">
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
                <Th className="text-right">Risk score</Th>
                <Th>Priority</Th>
                <Th>Recommended action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => (
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-ink-subtle text-sm">
                    No cases match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
