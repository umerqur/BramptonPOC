import { cases } from './mockCases'
import type { Category } from './types'

export const totalOpenCases = cases.length
export const highPriorityCases = cases.filter((c) => c.risk === 'High' || c.risk === 'Critical').length
export const averageDaysOpen = Math.round(cases.reduce((s, c) => s + c.daysOpen, 0) / cases.length)
export const repeatComplaintLocations = cases.filter((c) => c.repeatComplaints >= 3).length

const categoryOrder: Category[] = [
  'Property Standards',
  'Parking',
  'Noise',
  'Waste',
  'Zoning',
  'Licensing',
  'Illegal Dumping',
  'Grass and Weeds',
]

export const casesByCategory = categoryOrder.map((category) => ({
  category,
  count: cases.filter((c) => c.category === category).length,
}))

export const recentSummaries = cases
  .slice()
  .sort((a, b) => b.riskScore - a.riskScore)
  .slice(0, 4)
  .map((c) => ({
    id: c.id,
    category: c.category,
    ward: c.ward,
    risk: c.risk,
    summary: c.summary,
  }))

export const priorityQueue = cases
  .slice()
  .sort((a, b) => b.riskScore - a.riskScore)
  .slice(0, 6)
