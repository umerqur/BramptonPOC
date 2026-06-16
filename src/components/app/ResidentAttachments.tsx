import { useEffect, useState } from 'react'
import {
  createAttachmentSignedUrl,
  getResidentRequestAttachments,
  isImageAttachment,
  type ResidentRequestAttachment,
} from '../../services/residentRequests'
import { formatDateTime } from '../../services/demoWorkflowService'

// Staff view of the files a resident attached to a request. Files live in a
// PRIVATE Storage bucket — never exposed publicly. "View" mints a short-lived
// signed URL on demand and opens it in a new tab. Used in two places:
//   * variant="card"  — compact count + a button that expands the list (Work Queue)
//   * variant="full"  — a labelled "Resident attachments" section (Case Workbench)

function formatBytes(n: number | null): string {
  if (!n || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fileKind(att: ResidentRequestAttachment): string {
  const t = (att.content_type ?? '').toLowerCase()
  if (t === 'application/pdf') return 'PDF'
  if (t.startsWith('image/')) return `Image · ${t.slice(6).toUpperCase()}`
  return t || 'File'
}

/** Opens a private attachment via a freshly minted signed URL. */
function AttachmentRows({ attachments }: { attachments: ResidentRequestAttachment[] }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function open(att: ResidentRequestAttachment) {
    setBusyId(att.id)
    setError(null)
    try {
      const url = await createAttachmentSignedUrl(att.file_path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      console.error('Failed to open resident attachment:', err)
      setError('Could not open this file. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <ul className="space-y-2">
        {attachments.map((att) => (
          <li
            key={att.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-slate-100 text-ink-subtle">
                {isImageAttachment(att) ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                )}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-navy-900">{att.file_name}</div>
                <div className="truncate text-[11px] text-ink-subtle">
                  {fileKind(att)}
                  {formatBytes(att.file_size_bytes) ? ` · ${formatBytes(att.file_size_bytes)}` : ''} · uploaded{' '}
                  {formatDateTime(att.uploaded_at)}
                </div>
              </div>
            </div>
            <button
              onClick={() => open(att)}
              disabled={busyId === att.id}
              className="btn-secondary shrink-0 text-xs py-1.5 px-3 disabled:opacity-60"
            >
              {busyId === att.id ? 'Opening…' : 'View'}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{error}</p>
      )}
    </div>
  )
}

export default function ResidentAttachments({
  caseId,
  attachments: preloaded,
  variant,
}: {
  caseId: string
  /** Preloaded metadata (Work Queue batches it). If omitted, fetched by case id. */
  attachments?: ResidentRequestAttachment[]
  variant: 'card' | 'full'
}) {
  const [fetched, setFetched] = useState<ResidentRequestAttachment[] | null>(preloaded ?? null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (preloaded) {
      setFetched(preloaded)
      return
    }
    let active = true
    getResidentRequestAttachments(caseId)
      .then((rows) => active && setFetched(rows))
      .catch((err: unknown) => {
        console.error('Failed to load resident attachments:', err)
        if (active) setFetched([])
      })
    return () => {
      active = false
    }
  }, [caseId, preloaded])

  const attachments = fetched ?? []

  // Full section: always render the heading so staff know whether files exist.
  if (variant === 'full') {
    return (
      <section className="card p-5">
        <h3 className="text-sm font-semibold text-navy-900">Resident attachments</h3>
        <p className="text-xs text-ink-subtle">Photos or documents the resident uploaded with this request.</p>
        <div className="mt-3">
          {fetched === null ? (
            <p className="text-sm text-ink-subtle">Loading attachments…</p>
          ) : attachments.length === 0 ? (
            <p className="text-sm text-ink-subtle">No files were uploaded with this request.</p>
          ) : (
            <AttachmentRows attachments={attachments} />
          )}
        </div>
      </section>
    )
  }

  // Card variant: nothing to show for requests without attachments.
  if (attachments.length === 0) return null

  const single = attachments.length === 1
  const buttonLabel = single && isImageAttachment(attachments[0]) ? 'View uploaded photo' : 'View uploaded files'

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-navy-900">Attachments: {attachments.length}</span>
        <button onClick={() => setOpen((o) => !o)} className="btn-secondary text-xs py-1.5 px-3">
          {open ? 'Hide files' : buttonLabel}
        </button>
      </div>
      {open && (
        <div className="mt-3">
          <AttachmentRows attachments={attachments} />
        </div>
      )}
    </div>
  )
}
