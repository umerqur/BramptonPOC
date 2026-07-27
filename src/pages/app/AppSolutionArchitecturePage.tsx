import { useCallback, useRef } from 'react'
import SolutionArchitectureDiagram, {
  DIAGRAM_TITLE_LINE_1,
  DIAGRAM_TITLE_LINE_2,
} from '../../components/architecture/SolutionArchitectureDiagram'

// Solution Architecture — an authenticated reference page for City
// cybersecurity and architecture reviewers. It renders the inline-SVG
// architecture diagram (trust zones, data flows, controls, residency) and a
// short narrative, with export actions (SVG / PNG / print-to-PDF) that
// serialize the exact SVG shown on screen. No chart library is used.

const EXPORT_BASENAME = 'brampton-poc-solution-architecture'
// PNG export scale relative to the SVG viewBox (2040 wide → ~4080px wide PNG).
const PNG_SCALE = 2

/** Serialize the live SVG element to a standalone SVG document string. */
function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  // Fix the exported size to the viewBox so the file opens at full resolution.
  const [, , w, h] = (clone.getAttribute('viewBox') ?? '0 0 2040 2010').split(' ')
  clone.setAttribute('width', w)
  clone.setAttribute('height', h)
  clone.removeAttribute('style')
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function AppSolutionArchitecturePage() {
  const svgRef = useRef<SVGSVGElement>(null)

  const downloadSvg = useCallback(() => {
    const svg = svgRef.current
    if (!svg) return
    const blob = new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' })
    downloadBlob(blob, `${EXPORT_BASENAME}.svg`)
  }, [])

  const downloadPng = useCallback(() => {
    const svg = svgRef.current
    if (!svg) return
    const viewBox = (svg.getAttribute('viewBox') ?? '0 0 2040 2010').split(' ')
    const width = Number(viewBox[2]) * PNG_SCALE
    const height = Number(viewBox[3]) * PNG_SCALE
    const svgUrl = URL.createObjectURL(new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }))
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(svgUrl)
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `${EXPORT_BASENAME}.png`)
      }, 'image/png')
    }
    img.onerror = () => URL.revokeObjectURL(svgUrl)
    img.src = svgUrl
  }, [])

  const printDiagram = useCallback(() => {
    const svg = svgRef.current
    if (!svg) return
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<!doctype html>
<html>
<head>
<title>${DIAGRAM_TITLE_LINE_1} — ${DIAGRAM_TITLE_LINE_2}</title>
<style>
  @page { size: landscape; margin: 8mm; }
  html, body { margin: 0; padding: 0; }
  svg { width: 100%; height: auto; }
</style>
</head>
<body>${serializeSvg(svg)}</body>
</html>`)
    win.document.close()
    win.focus()
    // Allow fonts/layout to settle before opening the print dialog.
    setTimeout(() => win.print(), 300)
  }, [])

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <div className="section-eyebrow">SOLUTION ARCHITECTURE</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
            {DIAGRAM_TITLE_LINE_1}
          </h1>
          <p className="mt-1 text-lg font-medium text-navy-700">{DIAGRAM_TITLE_LINE_2}</p>
          <p className="mt-2 text-ink-muted">
            Trust zones, AI and data flows, cybersecurity controls, data residency position, and the proposed
            future City production deployment — generated from inspection of this repository, for City
            cybersecurity and architecture review.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={downloadSvg} className="btn-secondary text-sm">
            Download SVG
          </button>
          <button onClick={downloadPng} className="btn-secondary text-sm">
            Download PNG
          </button>
          <button onClick={printDiagram} className="btn-primary text-sm">
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="card mt-6 overflow-x-auto p-2 sm:p-4">
        {/* Give the SVG a generous minimum width so zone text stays legible on
            small screens (horizontal scroll instead of shrinking). */}
        <div className="min-w-[1100px]">
          <SolutionArchitectureDiagram ref={svgRef} />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Architecture represents the current POC configuration and the proposed production control model. Final
        production architecture depends on City requirements, approved vendors, data classification, privacy
        review, cybersecurity review, and confirmed Canadian service regions.
      </div>

      {/* ---------------- Architecture narrative ---------------- */}
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <NarrativeCard title="Current POC architecture">
          <p>
            The POC is a React 18 + TypeScript single-page application built with Vite and Tailwind, hosted on
            Netlify. Residents use a public simulation flow to submit and track demo service requests; City staff
            sign in with Supabase passwordless magic links (restricted to an email allowlist) and work assigned
            cases through the Work Queue, Case Workbench, Closure Review, and Officer Field Console. Supabase
            PostgreSQL stores complaints, resident submissions, workflow events, synthetic operational context,
            statistical outputs, and AI review records, with Row Level Security enabled on application tables.
            Six Netlify serverless functions handle every privileged integration: Anthropic Claude drafting,
            the Cohere + Qdrant similar-case retrieval pipeline, the provider-pluggable Officer Case Assistant,
            and Mailjet resident email. Resident intake writes go through the authorized Supabase API path under
            a narrowly scoped RLS insert policy; all third-party AI and email calls happen only server-side.
          </p>
        </NarrativeCard>

        <NarrativeCard title="AI control model">
          <p>
            AI in this system is advisory and staff-invoked only. Each AI call runs once per explicit staff click,
            for a single case, receiving only allow-listed fields. Retrieval is grounded: Cohere embeddings and
            reranking over a Qdrant index of closed benchmark cases surface comparable context, and Anthropic
            Claude (claude-sonnet-4-6) drafts closure packets, case answers, and staff review notes from that
            supplied context — the Officer Case Assistant can also run on Groq or Cohere Command via server
            configuration. No AI component makes an enforcement decision, closes a case, writes to the database,
            or communicates with a resident. Every AI output is labelled as advisory, returned to the staff
            workspace, and requires explicit human review and approval before any workflow action.
          </p>
        </NarrativeCard>

        <NarrativeCard title="Data residency position">
          <p>
            The current POC runs on managed cloud services (Netlify, Supabase, Qdrant Cloud, Cohere, Anthropic,
            Groq, Mailjet) chosen for demonstration speed, and processes only NYC 311 public benchmark data and
            synthetic operational context. No City of Brampton operational data is present, and no claim of
            Canadian hosting is made for the POC — actual service regions must be verified from the configured
            vendor accounts. For production, Canadian data residency is a deployment requirement: database, file,
            log, backup, AI processing, vector storage, and disaster recovery locations must be City-approved,
            any cross-border processing explicitly identified and approved, and vendor regions and subprocessors
            documented before go-live.
          </p>
        </NarrativeCard>

        <NarrativeCard title="Trust boundaries">
          <p>
            The diagram draws explicit boundaries between the untrusted public zone (resident browsers over
            HTTPS), the authenticated staff zone (magic-link sessions, role-based access, human approval gate),
            the presentation zone (the Netlify SPA, which holds no privileged secrets), the server-side
            processing zone (Netlify functions holding all credentials as environment variables), the data
            platform (Supabase with Row Level Security), external AI services (reached only from the server
            functions), the communications zone (Mailjet, triggered only by controlled functions), and the
            benchmark/synthetic data zone (explicitly labelled as not Brampton operational data). The future
            City production environment is a separate, dashed boundary: a target state that requires City
            approvals before it exists.
          </p>
        </NarrativeCard>

        <NarrativeCard title="Cybersecurity controls">
          <p>
            Controls implemented in the POC include TLS on every hop; encryption at rest via managed vendor
            storage; Supabase authentication with an email allowlist and no public signup; Row Level Security
            with least-privilege, role-based staff access; server-side secret management (no VITE_-prefixed
            secrets, no service keys in the browser); input validation and server-side identity resolution in
            the functions; advisory labelling and output validation of AI content; a mandatory human approval
            gate before closure or resident contact; workflow-event audit logging with AI provenance records;
            data minimization (allow-listed fields sent to AI providers); per-click invocation rather than batch
            automation; and error handling that returns status codes without leaking secrets or prompts.
          </p>
        </NarrativeCard>

        <NarrativeCard title="Production readiness decisions still required">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Selection of a City-approved, Canadian-resident cloud tenant and vendor set (or Canadian regions of current vendors), including AI and vector-storage processing locations.</li>
            <li>Integration with the City identity provider / SSO, replacing the POC email allowlist.</li>
            <li>City-managed encryption keys where required, private networking or restricted service endpoints.</li>
            <li>Centralized logging, security monitoring, and SIEM integration.</li>
            <li>Retention, deletion, disaster recovery, and backup controls aligned to City policy.</li>
            <li>Production privacy (PIA) and cybersecurity assessments, data classification, and vendor/subprocessor documentation.</li>
            <li>Formal City approval before any real operational or resident data is introduced.</li>
          </ul>
        </NarrativeCard>
      </div>
    </div>
  )
}

function NarrativeCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed text-ink-muted">{children}</div>
    </section>
  )
}
