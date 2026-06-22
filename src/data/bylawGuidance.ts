// POC by-law guidance knowledge base for the Officer Assistant.
//
// This is a DETERMINISTIC, rule-based reference (not a live AI model). It maps a
// case's internal by-law category — which the workflow derives from the resident
// issue type or the NYC 311 complaint type — to the by-law "offended", what an
// officer should check on site, the action options open to them, and reminders
// for recording a truthful field outcome.
//
// The offence list is modelled on the New York City 311 service-request
// complaint types (the open benchmark dataset this POC runs on), re-expressed as
// municipal by-law offences. It is illustrative POC content, not the verbatim
// text of any real by-law.

import type { DemoCategory } from './demoWorkflowTypes'

export type BylawGuidance = {
  /** Short name of the by-law offence being investigated. */
  offence: string
  /** Illustrative by-law name + reference cited in guidance and closure text. */
  bylawName: string
  bylawReference: string
  /** The NYC 311 complaint type(s) this category is modelled on. */
  nycComplaintTypes: string[]
  /** One-line plain summary of what this offence covers. */
  summary: string
  /** What the officer should look for / confirm on site. */
  whatToCheck: string[]
  /** The action options open to the officer (least to most severe). */
  actionOptions: string[]
  /** Reminders for recording a truthful, defensible field outcome. */
  recordingTips: string[]
}

/**
 * Guidance per internal by-law category. Every operational case maps to exactly
 * one of these via categoryForRequestType (resident intake) or
 * categoryForNycComplaint (NYC open benchmark).
 */
export const BYLAW_GUIDANCE: Record<DemoCategory, BylawGuidance> = {
  'Property Standards': {
    offence: 'Property standards / unsafe or unsanitary condition',
    bylawName: 'Property Standards By-law',
    bylawReference: 'PS-2024-11',
    nycComplaintTypes: ['UNSANITARY CONDITION', 'HEAT/HOT WATER', 'PLUMBING', 'PAINT/PLASTER', 'GENERAL'],
    summary:
      'Maintenance, safety, or sanitation defects on a property (exterior or common areas) that fall below the minimum property standard.',
    whatToCheck: [
      'Confirm the exact address / unit and that it matches the complaint location.',
      'Photograph the specific defect (structural, sanitation, pest, or maintenance).',
      'Note whether the condition is active, a health/safety risk, or already remedied.',
      'Identify the responsible party (owner, property manager, or tenant).',
    ],
    actionOptions: [
      'No violation — condition not observed or already corrected.',
      'Education / warning — minor issue, advise the responsible party.',
      'Notice / order to comply — set a compliance period and plan a re-inspection.',
      'Ticket — only if a fine/citation is actually issued for a confirmed violation.',
    ],
    recordingTips: [
      'Record exactly what you observed — do not assume a violation you did not confirm.',
      'Only record "notice issued" if you actually issued a notice or order to comply.',
      'Only record "ticket" if a ticket/fine/citation was actually issued.',
    ],
  },
  'Illegal Dumping': {
    offence: 'Illegal dumping / improper waste disposal',
    bylawName: 'Waste & Sanitation By-law',
    bylawReference: 'WS-2024-04',
    nycComplaintTypes: ['Sanitation Condition', 'Dirty Condition', 'Illegal Dumping', 'Derelict Vehicles'],
    summary:
      'Dumping, illegal disposal, or accumulation of waste, debris, or litter on public or private property.',
    whatToCheck: [
      'Confirm the material is dumped/abandoned waste, not lawful set-out for collection.',
      'Photograph the material and any identifying evidence of who left it.',
      'Note volume, hazard (sharps, chemicals), and whether it blocks a right-of-way.',
      'Check for repeat dumping signs at the same location.',
    ],
    actionOptions: [
      'No violation — material is lawful set-out or already cleared.',
      'Education / warning — advise the responsible party on proper disposal.',
      'Notice / order to comply — require removal within a compliance period.',
      'Ticket — only if a fine/citation is actually issued.',
    ],
    recordingTips: [
      'Record "resolved" only if the waste was actually cleared / removed.',
      'Capture evidence of the responsible party before recording an action.',
      'Do not record a ticket unless one was actually issued.',
    ],
  },
  Noise: {
    offence: 'Noise / disturbance',
    bylawName: 'Noise Control By-law',
    bylawReference: 'NC-2024-07',
    nycComplaintTypes: ['Noise', 'Noise - Residential', 'Noise - Commercial', 'Noise - Street/Sidewalk'],
    summary: 'Unreasonable or prohibited noise (amplified sound, construction, machinery, or persistent disturbance).',
    whatToCheck: [
      'Confirm the source and whether the noise is active at the time of the visit.',
      'Note time of day and whether it falls within restricted hours.',
      'Assess whether the level is unreasonable / prohibited under the by-law.',
      'Identify the responsible party and whether this is a repeat disturbance.',
    ],
    actionOptions: [
      'No violation — no active noise observed at the time of inspection.',
      'Education / warning — advise the responsible party to reduce the noise.',
      'Notice / order to comply — for an ongoing or repeat disturbance.',
      'Ticket — only if a fine/citation is actually issued.',
    ],
    recordingTips: [
      'If nothing was audible on arrival, record "no violation observed".',
      'A warning is the right record for a first, low-level disturbance.',
      'Only record a ticket if one was actually issued.',
    ],
  },
  Parking: {
    offence: 'Parking / vehicle obstruction',
    bylawName: 'Parking & Traffic By-law',
    bylawReference: 'PT-2024-02',
    nycComplaintTypes: ['Illegal Parking', 'Blocked Driveway', 'Abandoned Vehicle', 'Derelict Vehicle'],
    summary: 'Illegally parked, abandoned, or obstructing vehicles (blocked driveways, fire routes, or restricted zones).',
    whatToCheck: [
      'Confirm the vehicle, plate, and that it is in the complained-of location.',
      'Determine the specific contravention (blocked driveway, fire route, time limit, abandoned).',
      'Photograph the vehicle in position with context (signage, hydrant, driveway).',
      'For "abandoned", note condition and how long it appears to have been there.',
    ],
    actionOptions: [
      'No violation — vehicle moved, permitted, or not in contravention.',
      'Education / warning — advise the owner where appropriate.',
      'Notice / order — tag an abandoned vehicle for removal within the compliance period.',
      'Ticket — only if a parking ticket/citation is actually issued.',
    ],
    recordingTips: [
      'Record the plate and exact contravention in your notes.',
      'Only record "ticket" if a parking ticket was actually issued.',
      'Record "resolved" only if the vehicle was removed / the obstruction cleared.',
    ],
  },
  'Yard Maintenance': {
    offence: 'Yard maintenance / overgrowth',
    bylawName: 'Lot Maintenance By-law',
    bylawReference: 'LM-2024-09',
    nycComplaintTypes: ['Overgrown Tree/Plant', 'Weeds', 'Lot Condition', 'Standing Water'],
    summary: 'Overgrowth, long grass/weeds, or an unkempt lot condition that breaches the lot maintenance standard.',
    whatToCheck: [
      'Confirm the lot/yard and measure or estimate the overgrowth against the standard.',
      'Photograph the condition (grass height, weeds, debris, standing water).',
      'Note any pest/health concern (e.g. standing water, vermin harbourage).',
      'Identify the responsible party (owner or occupant).',
    ],
    actionOptions: [
      'No violation — within the standard or already maintained.',
      'Education / warning — advise the responsible party to bring it into compliance.',
      'Notice / order to comply — set a compliance period and re-inspect.',
      'Ticket — only if a fine/citation is actually issued.',
    ],
    recordingTips: [
      'Record the observed condition factually (e.g. grass height, area affected).',
      'A notice/order is typical for first-time overgrowth — record only if issued.',
      'Record "resolved" only if the lot was actually brought into compliance.',
    ],
  },
  Zoning: {
    offence: 'Zoning / illegal use or occupancy',
    bylawName: 'Zoning & Land Use By-law',
    bylawReference: 'ZL-2024-15',
    nycComplaintTypes: ['Illegal Conversion', 'SRO Illegal', 'Building/Use', 'Special Enforcement'],
    summary: 'Unpermitted use, illegal conversion, or occupancy that does not conform to the zoning / land-use by-law.',
    whatToCheck: [
      'Confirm the property and the specific use or conversion complained of.',
      'Note observable indicators of an illegal unit or non-conforming use (entrances, meters, signage).',
      'Do not enter private space without authority — record what is observable.',
      'Flag any immediate life-safety concern for escalation.',
    ],
    actionOptions: [
      'No violation — use conforms or could not be confirmed from observation.',
      'Education / warning — advise the owner of the zoning requirement.',
      'Notice / order to comply — refer for formal zoning review where warranted.',
      'Ticket — only if a fine/citation is actually issued.',
    ],
    recordingTips: [
      'Zoning matters are often escalated — record observations, not conclusions.',
      'Flag follow-up required when a formal zoning review is needed.',
      'Do not record an action (notice/ticket) you did not actually take.',
    ],
  },
}

/** Guidance for a case's by-law category (defaults to Property Standards). */
export function guidanceForCategory(category: DemoCategory): BylawGuidance {
  return BYLAW_GUIDANCE[category] ?? BYLAW_GUIDANCE['Property Standards']
}
