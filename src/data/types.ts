export type Category =
  | 'Property Standards'
  | 'Parking'
  | 'Noise'
  | 'Waste'
  | 'Zoning'
  | 'Licensing'
  | 'Illegal Dumping'
  | 'Grass and Weeds'

export type Risk = 'Low' | 'Medium' | 'High' | 'Critical'

export type RecommendedAction =
  | 'Monitor'
  | 'Merge with existing case'
  | 'Schedule inspection'
  | 'Escalate for supervisor review'
  | 'Send notice'
  | 'Prepare officer visit'

export type Priority = 'P1' | 'P2' | 'P3' | 'P4'

export type Complaint = {
  id: string
  date: string
  channel: '311 Web' | '311 Phone' | 'Mobile App' | 'Walk-in' | 'Email'
  summary: string
}

export type Case = {
  id: string
  category: Category
  ward: string
  address: string
  daysOpen: number
  repeatComplaints: number
  riskScore: number
  risk: Risk
  priority: Priority
  recommendedAction: RecommendedAction
  summary: string
  riskDrivers: string[]
  complaints: Complaint[]
  similarCases: string[]
  briefing: string[]
  status: 'New' | 'In Triage' | 'Assigned' | 'Inspection Scheduled' | 'Awaiting Response'
}
