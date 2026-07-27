// City of Brampton Proactive Enforcement Response POC — executive-level
// solution architecture, rendered as a single inline SVG (no chart library)
// so it can be exported (SVG / PNG / print) exactly as displayed.
//
// This is a City submission artifact, deliberately kept at an executive
// altitude: six components, simple arrows, and plain-language messages. It
// intentionally names no AI providers, models, functions, routes, tables, or
// other internal implementation details. Vendor names appear only in the data
// hosting and residency statement, where the City asked for them explicitly.

const VIEW_W = 1680
const VIEW_H = 960

export const DIAGRAM_TITLE_LINE_1 = 'City of Brampton Proactive Enforcement Response POC'
export const DIAGRAM_TITLE_LINE_2 = 'AI, Data and Cybersecurity Solution Architecture'

/** Greedy word-wrap for SVG text (no native wrapping). */
function wrap(text: string, maxChars: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (next.length > maxChars && line) {
      lines.push(line)
      line = w
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

type BoxProps = {
  x: number
  y: number
  w: number
  h: number
  title: string
  lines: string[]
  stroke: string
  fill: string
}

/** One architecture component: a titled box with up to three plain lines. */
function ComponentBox({ x, y, w, h, title, lines, stroke, fill }: BoxProps) {
  const titleLines = wrap(title, Math.floor((w - 36) / 10))
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={12} fill={fill} stroke={stroke} strokeWidth={2.5} />
      {titleLines.map((l, i) => (
        <text key={`t${i}`} x={x + 18} y={y + 32 + i * 24} fontSize={19} fontWeight={700} fill="#0f1a30">
          {l}
        </text>
      ))}
      {lines.map((l, i) => (
        <text key={`l${i}`} x={x + 18} y={y + 32 + titleLines.length * 24 + 8 + i * 22} fontSize={14.5} fill="#28395a">
          {l}
        </text>
      ))}
    </g>
  )
}

/** A simple directional arrow between components. */
function Arrow({ d }: { d: string }) {
  return <path d={d} fill="none" stroke="#33476f" strokeWidth={2.5} markerEnd="url(#arrow)" />

}

/** A wrapped bullet list inside a panel. */
function Bullets({
  x,
  y,
  maxChars,
  items,
  lineH = 21,
  gap = 7,
}: {
  x: number
  y: number
  maxChars: number
  items: string[]
  lineH?: number
  gap?: number
}) {
  let cy = y
  return (
    <g>
      {items.map((item, i) => {
        const lines = wrap(item, maxChars)
        const el = (
          <g key={i}>
            <circle cx={x + 4} cy={cy - 5} r={3} fill="#26735c" />
            {lines.map((l, j) => (
              <text key={j} x={x + 16} y={cy + j * lineH} fontSize={15} fill="#28395a">
                {l}
              </text>
            ))}
          </g>
        )
        cy += lines.length * lineH + gap
        return el
      })}
    </g>
  )
}

const KEY_MESSAGES: string[] = [
  'AI assisted decision support system',
  'No automated enforcement decisions',
  'Staff review and approval required',
  'Public benchmark and synthetic data only',
  'Application data in Canadian hosted Supabase',
  'Benchmark source files in AWS object storage',
  'City operational data is not currently used',
  'Production architecture finalized with the City',
]

const RESIDENCY_STATEMENTS: string[] = [
  'Public benchmark source data is stored in AWS object storage.',
  'Application data is stored in a Canadian hosted Supabase environment.',
  'Any production use of City operational data remains subject to City approval, privacy review, cybersecurity review, and confirmation of approved processing regions.',
]

export default function SolutionArchitectureDiagram({ svgRef }: { svgRef?: React.Ref<SVGSVGElement> }) {
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label={`${DIAGRAM_TITLE_LINE_1} — ${DIAGRAM_TITLE_LINE_2}`}
      fontFamily="Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={8} markerHeight={8} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#33476f" />
        </marker>
      </defs>

      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="#f8fafc" />

      {/* Title */}
      <text x={40} y={44} fontSize={26} fontWeight={800} fill="#0f1a30">
        {DIAGRAM_TITLE_LINE_1}
      </text>
      <text x={40} y={74} fontSize={18} fontWeight={600} fill="#33476f">
        {DIAGRAM_TITLE_LINE_2}
      </text>
      <text x={VIEW_W - 40} y={44} textAnchor="end" fontSize={13.5} fill="#4a5673">
        Executive overview — current proof of concept
      </text>

      {/* ---------------- Components ---------------- */}
      <ComponentBox
        x={50}
        y={330}
        w={290}
        h={170}
        title="Resident and City Staff"
        stroke="#0369a1"
        fill="#f0f9ff"
        lines={['Residents submit and track', 'service requests', 'Staff review and approve', 'outcomes']}
      />
      <ComponentBox
        x={430}
        y={330}
        w={270}
        h={170}
        title="Web Application"
        stroke="#475569"
        fill="#ffffff"
        lines={['Managed application hosting', 'Public resident area and', 'staff-only workspace', 'Encrypted connections']}
      />
      <ComponentBox
        x={810}
        y={330}
        w={270}
        h={170}
        title="Application Services"
        stroke="#26735c"
        fill="#f0f9f6"
        lines={['Secure server-side services', 'Authentication and role-based', 'access', 'Validation and authorization']}
      />
      <ComponentBox
        x={1190}
        y={120}
        w={350}
        h={150}
        title="AI Assisted Decision Support"
        stroke="#6d28d9"
        fill="#f5f3ff"
        lines={['AI services and vector retrieval', 'Grounded advisory drafts only', 'Staff approval always required']}
      />
      <ComponentBox
        x={1190}
        y={330}
        w={350}
        h={150}
        title="Data Platform"
        stroke="#4338ca"
        fill="#eef2ff"
        lines={['Managed relational database', 'Canadian hosted application data', 'Encryption and audit logging']}
      />
      <ComponentBox
        x={1190}
        y={540}
        w={350}
        h={150}
        title="Approved External Services"
        stroke="#0e7490"
        fill="#ecfeff"
        lines={['Notification service (resident updates)', 'Object storage (public benchmark', 'source files)']}
      />

      {/* ---------------- Simple arrows ---------------- */}
      {/* Users ↔ Web Application */}
      <Arrow d="M340,400 H424" />
      <Arrow d="M424,435 H346" />
      {/* Web Application → Application Services */}
      <Arrow d="M700,415 H804" />
      {/* Application Services → AI / Data / External */}
      <Arrow d="M1080,370 H1120 V195 H1184" />
      <Arrow d="M1080,415 H1184" />
      <Arrow d="M1080,460 H1120 V615 H1184" />

      {/* ---------------- Governance strip ---------------- */}
      <rect x={50} y={735} width={1580} height={64} rx={12} fill="#daefe6" stroke="#26735c" strokeWidth={2} />
      <text x={840} y={762} textAnchor="middle" fontSize={17} fontWeight={700} fill="#1c4a3d">
        AI assisted decision support only — the system does not automate enforcement decisions.
      </text>
      <text x={840} y={786} textAnchor="middle" fontSize={15.5} fill="#1c4a3d">
        City staff remain responsible for reviewing and approving every outcome and resident communication.
      </text>

      {/* ---------------- Bottom panels ---------------- */}
      <g>
        <rect x={50} y={825} width={770} height={118} rx={12} fill="#ffffff" stroke="#94a4c5" strokeWidth={1.6} />
        <text x={70} y={850} fontSize={16.5} fontWeight={700} fill="#0f1a30">
          Data hosting and residency
        </text>
        {(() => {
          let y = 872
          return RESIDENCY_STATEMENTS.map((s, i) => {
            const lines = wrap(s, 100)
            const el = lines.map((l, j) => (
              <text key={`${i}-${j}`} x={70} y={y + j * 19} fontSize={13.5} fill="#28395a">
                {l}
              </text>
            ))
            y += lines.length * 19 + 3
            return el
          })
        })()}
      </g>
      <g>
        <rect x={860} y={825} width={770} height={118} rx={12} fill="#ffffff" stroke="#94a4c5" strokeWidth={1.6} />
        <text x={880} y={850} fontSize={16.5} fontWeight={700} fill="#0f1a30">
          Key messages
        </text>
        <Bullets x={880} y={874} maxChars={48} items={KEY_MESSAGES.slice(0, 4)} lineH={19} gap={2} />
        <Bullets x={1240} y={874} maxChars={48} items={KEY_MESSAGES.slice(4)} lineH={19} gap={2} />
      </g>
    </svg>
  )
}
