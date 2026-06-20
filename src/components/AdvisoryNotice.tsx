import { TRIAGE_ADVISORY } from '../services/municipalServiceRequests'

/**
 * Standard advisory banner shown wherever decision-support triage outputs appear.
 * Makes explicit that the rule based POC triage is decision support only and
 * not a final enforcement decision. Use `variant="inline"` for a compact note.
 */
export default function AdvisoryNotice({ variant = 'banner' }: { variant?: 'banner' | 'inline' }) {
  if (variant === 'inline') {
    return <p className="text-[11px] leading-relaxed text-ink-subtle">{TRIAGE_ADVISORY}</p>
  }
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    >
      <span aria-hidden className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      <span>
        <span className="font-semibold">Decision support only:</span> {TRIAGE_ADVISORY}
      </span>
    </div>
  )
}
