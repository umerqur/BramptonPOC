import { useCallback, useRef } from 'react'
import SolutionArchitectureDiagram, {
  DIAGRAM_TITLE_LINE_1,
  DIAGRAM_TITLE_LINE_2,
} from '../../components/architecture/SolutionArchitectureDiagram'

// Solution Architecture — an executive-level reference page for the City
// submission. It renders the simplified inline-SVG architecture overview and a
// short three-section narrative, with export actions (SVG / PNG / print-to-PDF)
// that serialize the exact SVG shown on screen. Deliberately free of internal
// implementation detail — vendors are named only in the data hosting and
// residency statement.

const EXPORT_BASENAME = 'brampton-poc-solution-architecture'
const DEFAULT_VIEWBOX = '0 0 1680 960'
// PNG export scale relative to the SVG viewBox (1680 wide → ~3360px wide PNG).
const PNG_SCALE = 2

/** Serialize the live SVG element to a standalone SVG document string. */
function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  // Fix the exported size to the viewBox so the file opens at full resolution.
  const [, , w, h] = (clone.getAttribute('viewBox') ?? DEFAULT_VIEWBOX).split(' ')
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
    const viewBox = (svg.getAttribute('viewBox') ?? DEFAULT_VIEWBOX).split(' ')
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
            An executive-level overview of the proof of concept for City review: how residents, staff, the
            application, AI assisted decision support, and the data platform fit together.
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
        {/* Give the SVG a generous minimum width so text stays legible on small
            screens (horizontal scroll instead of shrinking). */}
        <div className="min-w-[900px]">
          <SolutionArchitectureDiagram svgRef={svgRef} />
        </div>
      </div>

      {/* ---------------- Short narrative ---------------- */}
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <NarrativeCard title="Current POC">
          <p>
            The proof of concept demonstrates a resident service-request and staff review workflow using public
            benchmark and synthetic data only. City operational data is not currently being used. Application
            data is stored in a Canadian hosted Supabase environment, and public benchmark source files are
            stored in AWS object storage.
          </p>
        </NarrativeCard>

        <NarrativeCard title="Security and Human Oversight">
          <p>
            All privileged operations run in secure server-side services with authentication, role-based access,
            encryption, and audit logging. AI produces grounded advisory drafts only and does not automate
            enforcement decisions. Staff remain responsible for reviewing and approving every outcome and
            resident communication.
          </p>
        </NarrativeCard>

        <NarrativeCard title="Production Considerations">
          <p>
            Production architecture will be finalized with the City. Any production use of City operational data
            remains subject to City approval, privacy review, cybersecurity review, and confirmation of approved
            processing regions.
          </p>
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
