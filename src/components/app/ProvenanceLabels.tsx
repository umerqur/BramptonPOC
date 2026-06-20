// Provenance labels for the case workflow. These make the division of
// responsibility explicit and auditable wherever AI assistance appears:
//
//   * AI assisted retrieval     — embeddings + rerank surface similar closed
//                                 cases for reference. It does NOT decide outcomes.
//   * Rules based closure template — the resident closure message is generated
//                                 from deterministic, rule based templates.
//   * Human approved            — a supervisor reviews and approves before the
//                                 resident is ever notified.
//
// They are presentational only.

export type ProvenanceKind = 'ai-retrieval' | 'rules-closure' | 'human-approved'

const PROVENANCE_LABELS: Record<ProvenanceKind, { label: string; cls: string }> = {
  'ai-retrieval': {
    label: 'AI assisted retrieval',
    cls: 'bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200',
  },
  'rules-closure': {
    label: 'Rules based closure template',
    cls: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
  },
  'human-approved': {
    label: 'Human approved',
    cls: 'bg-navy-50 text-navy-900 ring-1 ring-inset ring-navy-200',
  },
}

/** A single provenance badge. */
export function ProvenanceBadge({ kind }: { kind: ProvenanceKind }) {
  const p = PROVENANCE_LABELS[kind]
  return <span className={`badge ${p.cls}`}>{p.label}</span>
}

/**
 * The full provenance strip. Shows all three labels in pipeline order so staff
 * can see, at a glance, that AI only assists retrieval while the closure stays
 * rules based and human approved.
 */
export function ProvenanceStrip({ kinds }: { kinds?: ProvenanceKind[] }) {
  const order: ProvenanceKind[] = kinds ?? ['ai-retrieval', 'rules-closure', 'human-approved']
  return (
    <div className="flex flex-wrap items-center gap-2">
      {order.map((kind) => (
        <ProvenanceBadge key={kind} kind={kind} />
      ))}
    </div>
  )
}
