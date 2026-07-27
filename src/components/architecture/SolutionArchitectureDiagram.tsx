import { forwardRef } from 'react'

// City of Brampton Proactive Enforcement Response POC — AI, Data and
// Cybersecurity Solution Architecture, rendered as a single inline SVG so it
// can be exported (SVG / PNG / print) exactly as displayed.
//
// The diagram is generated from repository inspection, not aspiration:
//   * Trust zones mirror the real code paths (public resident flow, Supabase
//     magic-link + allowlist auth, Netlify functions, RLS'd Postgres, the
//     Cohere + Qdrant retrieval pipeline, Anthropic/Groq/Cohere generation,
//     Mailjet email, NYC 311 benchmark + synthetic operational context).
//   * The Future City Production zone is drawn with a visually distinct dashed
//     boundary because it is a proposed control model, not a built system.
//
// Everything is plain SVG primitives — no chart library. Coordinates live in
// the layout constants below; nodes are stacked programmatically so text never
// overlaps its container.

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const VIEW_W = 2040
const VIEW_H = 2010

// Column x-origins inside the POC container (each zone column is 300 wide,
// with 70px arrow corridors between columns).
const COL = { a: 60, b: 430, c: 800, d: 1170, e: 1540 }
const ZONE_W = 300
const NODE_PAD = 14
const NODE_W = ZONE_W - NODE_PAD * 2

// Data classification palette (also used by the legend).
const CLS = {
  public: '#0369a1',
  synthetic: '#b45309',
  internal: '#475569',
  personal: '#be123c',
  secrets: '#7f1d1d',
  advisory: '#6d28d9',
  audit: '#0f766e',
} as const

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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

type NodeKind = 'default' | 'guard' | 'warn' | 'list'

type NodeSpec = {
  title: string
  lines?: string[]
  kind?: NodeKind
  /** Data-classification dot colour shown beside the title. */
  dot?: string
  /** Numbered-flow badge rendered at the node's top-right corner. */
  badge?: number
}

const NODE_STYLE: Record<NodeKind, { fill: string; stroke: string; titleFill: string }> = {
  default: { fill: '#ffffff', stroke: '#cbd5e1', titleFill: '#0f1a30' },
  guard: { fill: '#f0f9f6', stroke: '#26735c', titleFill: '#1c4a3d' },
  warn: { fill: '#fffbeb', stroke: '#b45309', titleFill: '#92400e' },
  list: { fill: '#ffffff', stroke: '#cbd5e1', titleFill: '#0f1a30' },
}

const TITLE_CPL = 34 // approx chars/line for 15px semibold at NODE_W
const LINE_CPL = 38 // approx chars/line for 13.5px regular at NODE_W

function nodeHeight(spec: NodeSpec): number {
  const titleLines = wrap(spec.title, TITLE_CPL).length
  const bodyLines = (spec.lines ?? []).reduce((n, l) => n + wrap(l, LINE_CPL).length, 0)
  return 12 + titleLines * 20 + (bodyLines > 0 ? 4 + bodyLines * 18 : 0) + 10
}

function FlowBadge({ cx, cy, n }: { cx: number; cy: number; n: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={14} fill="#0f1a30" stroke="#ffffff" strokeWidth={2} />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill="#ffffff">
        {n}
      </text>
    </g>
  )
}

function ZoneNode({ x, y, spec }: { x: number; y: number; spec: NodeSpec }) {
  const style = NODE_STYLE[spec.kind ?? 'default']
  const h = nodeHeight(spec)
  const titleLines = wrap(spec.title, TITLE_CPL)
  const bodyLines = (spec.lines ?? []).flatMap((l) => wrap(l, LINE_CPL))
  const ty = y + 12 + 15
  return (
    <g>
      <rect x={x} y={y} width={NODE_W} height={h} rx={8} fill={style.fill} stroke={style.stroke} strokeWidth={1.4} />
      {spec.dot && <circle cx={x + 13} cy={y + 21} r={5.5} fill={spec.dot} />}
      {titleLines.map((l, i) => (
        <text
          key={`t${i}`}
          x={x + (spec.dot ? 25 : 11)}
          y={ty + i * 20 - 1}
          fontSize={15}
          fontWeight={600}
          fill={style.titleFill}
        >
          {l}
        </text>
      ))}
      {bodyLines.map((l, i) => (
        <text
          key={`b${i}`}
          x={x + 11}
          y={ty + titleLines.length * 20 + 4 + i * 18 - 1}
          fontSize={13.5}
          fill="#4a5673"
        >
          {l}
        </text>
      ))}
      {spec.badge != null && <FlowBadge cx={x + NODE_W - 6} cy={y + 2} n={spec.badge} />}
    </g>
  )
}

/** A stacked column of nodes inside a zone, starting under the zone header. */
function NodeStack({ x, startY, specs, gap = 10 }: { x: number; startY: number; specs: NodeSpec[]; gap?: number }) {
  let y = startY
  return (
    <g>
      {specs.map((spec, i) => {
        const el = <ZoneNode key={i} x={x + NODE_PAD} y={y} spec={spec} />
        y += nodeHeight(spec) + gap
        return el
      })}
    </g>
  )
}

type ZoneProps = {
  x: number
  y: number
  w: number
  h: number
  num: number
  title: string
  subtitle?: string
  fill: string
  stroke: string
  children?: React.ReactNode
}

function Zone({ x, y, w, h, num, title, subtitle, fill, stroke, children }: ZoneProps) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={12} fill={fill} stroke={stroke} strokeWidth={2.25} />
      <circle cx={x + 26} cy={y + 25} r={13} fill={stroke} />
      <text x={x + 26} y={y + 30} textAnchor="middle" fontSize={14} fontWeight={700} fill="#ffffff">
        {num}
      </text>
      <text x={x + 46} y={y + 24} fontSize={16.5} fontWeight={700} fill="#0f1a30" letterSpacing={0.2}>
        {title}
      </text>
      {subtitle && (
        <text x={x + 46} y={y + 42} fontSize={12.5} fontWeight={500} fill="#4a5673">
          {subtitle}
        </text>
      )}
      {children}
    </g>
  )
}

/**
 * Directional flow arrow: an elbow path with an arrowhead and a numbered badge.
 * `badgeAt` is the [x, y] where the number circle sits (usually mid-path).
 */
function Flow({
  d,
  badgeAt,
  n,
  dashed = false,
  stroke = '#33476f',
}: {
  d: string
  badgeAt: [number, number]
  n?: number
  dashed?: boolean
  stroke?: string
}) {
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={2.5}
        strokeDasharray={dashed ? '7 5' : undefined}
        markerEnd={dashed ? 'url(#arrow-dashed)' : 'url(#arrow)'}
      />
      {n != null && <FlowBadge cx={badgeAt[0]} cy={badgeAt[1]} n={n} />}
    </g>
  )
}

/** Panel container used for the legend / controls / residency panels. */
function Panel({
  x,
  y,
  w,
  h,
  title,
  children,
}: {
  x: number
  y: number
  w: number
  h: number
  title: string
  children?: React.ReactNode
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={12} fill="#ffffff" stroke="#94a4c5" strokeWidth={1.6} />
      <text x={x + 18} y={y + 32} fontSize={17} fontWeight={700} fill="#0f1a30">
        {title}
      </text>
      <line x1={x + 18} y1={y + 44} x2={x + w - 18} y2={y + 44} stroke="#e3e8f1" strokeWidth={1.5} />
      {children}
    </g>
  )
}

/** A wrapped bullet list rendered inside a panel column. */
function BulletList({
  x,
  y,
  maxChars,
  items,
  color = '#0f1a30',
  lineH = 19,
  gap = 8,
  fontSize = 14,
}: {
  x: number
  y: number
  maxChars: number
  items: string[]
  color?: string
  lineH?: number
  gap?: number
  fontSize?: number
}) {
  let cy = y
  return (
    <g>
      {items.map((item, i) => {
        const lines = wrap(item, maxChars)
        const el = (
          <g key={i}>
            <circle cx={x + 4} cy={cy - 4} r={3} fill={color} />
            {lines.map((l, j) => (
              <text key={j} x={x + 15} y={cy + j * lineH} fontSize={fontSize} fill="#28395a">
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

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const FLOWS: string[] = [
  'Resident submits a service request over HTTPS.',
  'The application validates input and writes through the authorized backend path (Supabase API, anon key, RLS insert policy).',
  'Supabase PostgreSQL stores the request and its workflow event.',
  'A server-side function sends the resident confirmation via Mailjet.',
  'Authorized staff authenticate (Supabase Auth magic link + allowlist) and retrieve assigned work.',
  'Staff explicitly request an AI review packet for one selected case.',
  'The server-side function retrieves approved case context (read-only).',
  'Retrieval services locate relevant benchmark and case context (Cohere embed → Qdrant search → Cohere rerank).',
  'Grounded AI produces advisory draft content only — no decisions.',
  'The output is returned to the staff workspace, labelled as AI advisory.',
  'Staff review, edit, approve, or reject the output.',
  'Only an approved workflow action may update case status or trigger resident communication.',
]

// Kept to one rendered line each (≤ 40 chars) so the panel never overflows.
const SECURITY_CONTROLS: string[] = [
  'Encryption in transit (HTTPS / TLS)',
  'Encryption at rest (managed storage)',
  'Supabase auth (magic link + allowlist)',
  'Row Level Security on app tables',
  'Least privilege role-based access',
  'Server-side secret management',
  'Input validation on server functions',
  'Output validation + advisory labels',
  'Human approval before closure/contact',
  'Audit logging (workflow + AI records)',
  'Data minimization (allow-listed fields)',
  'Environment separation (POC vs prod)',
  'Per-click invocation / rate limiting',
  'Error handling without secret leakage',
  'No browser access to privileged APIs',
]

const RESIDENCY_POC: string[] = [
  'Managed cloud services are used for demonstration (Netlify, Supabase, Qdrant, Cohere, Anthropic, Groq, Mailjet).',
  'NYC 311 public data and synthetic operational context only.',
  'No City of Brampton operational data should be assumed.',
  'Actual service regions must be verified from the configured vendor accounts.',
]

const RESIDENCY_PROD: string[] = [
  'Canadian data residency is a deployment requirement.',
  'All database, file, log, backup, AI processing, vector storage, and disaster recovery locations must be approved by the City.',
  'Any cross-border processing must be explicitly identified and approved.',
  'Vendor regions and subprocessors must be documented before production.',
]

const FUTURE_COLS: { heading: string; items: string[] }[] = [
  {
    heading: 'Hosting & residency',
    items: [
      'Canadian hosted production environment',
      'City approved cloud tenant',
      'Canadian data residency for data, AI processing, vectors, and backups',
      'Private networking or restricted service endpoints',
      'City managed encryption keys where required',
    ],
  },
  {
    heading: 'Identity & operations',
    items: [
      'City identity provider / SSO',
      'Centralized logging and security monitoring',
      'SIEM integration',
      'Retention and deletion controls',
      'Disaster recovery and backup controls',
    ],
  },
  {
    heading: 'Assurance gates',
    items: [
      'Production privacy assessment (PIA)',
      'Production cybersecurity assessment',
      'Vendor regions and subprocessors documented',
      'City approval required before any real operational data is introduced',
    ],
  },
]

const CLASSIFICATION: { label: string; color: string }[] = [
  { label: 'Public', color: CLS.public },
  { label: 'Synthetic POC', color: CLS.synthetic },
  { label: 'Internal application', color: CLS.internal },
  { label: 'Personal information', color: CLS.personal },
  { label: 'Credentials and secrets', color: CLS.secrets },
  { label: 'AI generated advisory content', color: CLS.advisory },
  { label: 'Audit records', color: CLS.audit },
]

const NOTE =
  'Architecture represents the current POC configuration and the proposed production control model. Final production architecture depends on City requirements, approved vendors, data classification, privacy review, cybersecurity review, and confirmed Canadian service regions.'

// ---------------------------------------------------------------------------
// The diagram
// ---------------------------------------------------------------------------

export const DIAGRAM_TITLE_LINE_1 = 'City of Brampton Proactive Enforcement Response POC'
export const DIAGRAM_TITLE_LINE_2 = 'AI, Data and Cybersecurity Solution Architecture'

const SolutionArchitectureDiagram = forwardRef<SVGSVGElement>(function SolutionArchitectureDiagram(_props, ref) {
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label={`${DIAGRAM_TITLE_LINE_1} — ${DIAGRAM_TITLE_LINE_2}`}
      fontFamily="Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7.5} markerHeight={7.5} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#33476f" />
        </marker>
        <marker id="arrow-dashed" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7.5} markerHeight={7.5} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#4f46e5" />
        </marker>
      </defs>

      {/* Canvas */}
      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="#f8fafc" />

      {/* Title */}
      <text x={40} y={48} fontSize={28} fontWeight={800} fill="#0f1a30">
        {DIAGRAM_TITLE_LINE_1}
      </text>
      <text x={40} y={80} fontSize={19} fontWeight={600} fill="#33476f">
        {DIAGRAM_TITLE_LINE_2}
      </text>
      <text x={VIEW_W - 40} y={46} textAnchor="end" fontSize={13.5} fill="#4a5673">
        Solid boundaries = current POC (implemented in this repository)
      </text>
      <text x={VIEW_W - 40} y={66} textAnchor="end" fontSize={13.5} fill="#4a5673">
        Dashed boundary = proposed future City production deployment
      </text>

      {/* ================= CURRENT POC CONTAINER ================= */}
      <rect x={30} y={100} width={1980} height={1000} rx={16} fill="#ffffff" stroke="#33476f" strokeWidth={2.5} />
      <rect x={30} y={100} width={1980} height={40} rx={16} fill="#e3e8f1" />
      <rect x={30} y={124} width={1980} height={16} fill="#e3e8f1" />
      <text x={52} y={126} fontSize={17} fontWeight={800} fill="#0f1a30" letterSpacing={0.4}>
        CURRENT POC ARCHITECTURE — managed cloud demonstration environment (benchmark + synthetic data only)
      </text>

      {/* Zone 1 — Public User Zone */}
      <Zone x={COL.a} y={170} w={ZONE_W} h={280} num={1} title="Public User Zone" subtitle="Untrusted — residents" fill="#e0f2fe" stroke="#0369a1">
        <NodeStack
          x={COL.a}
          startY={228}
          specs={[
            { title: 'Resident browser (any device)' },
            { title: 'Resident request submission', lines: ['/resident/new-request'], dot: CLS.personal },
            { title: 'Resident status tracking', lines: ['/resident/status/:caseId — non-PII RPC'] },
            { title: 'HTTPS / TLS only', kind: 'guard' },
          ]}
        />
      </Zone>

      {/* Zone 2 — Authorized City Staff Zone */}
      <Zone x={COL.a} y={480} w={ZONE_W} h={590} num={2} title="Authorized City Staff Zone" subtitle="Authenticated — allowlisted staff" fill="#e3e8f1" stroke="#33476f">
        <NodeStack
          x={COL.a}
          startY={538}
          specs={[
            { title: 'Authenticated staff browser' },
            { title: 'Supabase authentication', lines: ['Passwordless magic link', 'Email allowlist — no public signup'] },
            { title: 'Role-based access', lines: ['Supervisor · CSR · By-law Officer', 'Profile-driven role switching'] },
            {
              title: 'Staff review and approval workspace',
              lines: ['Work Queue · Case Workbench', 'Closure Review · Field Console'],
              badge: 11,
            },
            {
              title: 'Human approval gate',
              lines: ['Required before closure or any', 'resident communication'],
              kind: 'guard',
            },
          ]}
        />
      </Zone>

      {/* Zone 3 — Application Presentation Zone */}
      <Zone x={COL.b} y={170} w={ZONE_W} h={430} num={3} title="Application Presentation" subtitle="Netlify-hosted SPA" fill="#f1f5f9" stroke="#475569">
        <NodeStack
          x={COL.b}
          startY={228}
          specs={[
            { title: 'React 18 + TypeScript SPA', lines: ['Vite build · Tailwind design system'], dot: CLS.internal },
            { title: 'Netlify hosted frontend (CDN)' },
            { title: 'Public routes', lines: ['/ · /methodology · /privacy · /resident'] },
            { title: 'Authenticated staff routes', lines: ['/app — session-gated (ProtectedRoute)'] },
            {
              title: 'No privileged secrets in the browser',
              lines: ['Only the Supabase anon key, always', 'constrained by Row Level Security'],
              kind: 'guard',
            },
          ]}
        />
      </Zone>

      {/* Zone 4 — Server-Side Processing Zone */}
      <Zone x={COL.b} y={640} w={ZONE_W} h={430} num={4} title="Server-Side Processing" subtitle="Netlify serverless functions" fill="#daefe6" stroke="#26735c">
        <NodeStack
          x={COL.b}
          startY={698}
          specs={[
            {
              title: 'API orchestration (6 functions)',
              lines: [
                'generate-ai-review-packet',
                'ask-case-agent · generate-case-ai-review',
                'officer-case-assistant · similar-cases',
                'send-resident-email',
              ],
              kind: 'list',
            },
            { title: 'Input validation + authorization', lines: ['Server-side identity resolution from', 'the Supabase access token'] },
            { title: 'AI + email request construction', lines: ['Allow-listed case fields only'] },
            {
              title: 'Secrets: server env vars only',
              lines: ['Anthropic · Cohere · Qdrant · Groq ·', 'Mailjet · service-role keys — never', 'exposed to the client, never logged'],
              kind: 'warn',
              dot: CLS.secrets,
            },
          ]}
        />
      </Zone>

      {/* Zone 5 — Data Platform Zone */}
      <Zone x={COL.c} y={170} w={ZONE_W} h={530} num={5} title="Data Platform Zone" subtitle="Supabase (managed PostgreSQL)" fill="#e0e7ff" stroke="#4338ca">
        <NodeStack
          x={COL.c}
          startY={228}
          specs={[
            { title: 'Supabase PostgreSQL' },
            { title: 'Supabase Auth (GoTrue)' },
            { title: 'Row Level Security', lines: ['Enabled on application tables;', 'anon inserts limited to demo intake'], kind: 'guard' },
            {
              title: 'Data stores',
              lines: [
                'Municipal complaints (NYC benchmark)',
                'Resident submissions (demo PII)',
                'Workflow events (audit trail)',
                'Patrol logs · tickets (synthetic)',
                'Complaint trends · closure templates',
                'Statistical outputs · ML scores',
                'AI review records (advisory)',
                'Audit and provenance records',
              ],
              badge: 3,
              dot: CLS.audit,
            },
          ]}
        />
      </Zone>

      {/* Zone 8 — Benchmark and POC Data Zone */}
      <Zone x={COL.c} y={760} w={ZONE_W} h={310} num={8} title="Benchmark & POC Data" subtitle="Offline-prepared datasets" fill="#fef3c7" stroke="#b45309">
        <NodeStack
          x={COL.c}
          startY={818}
          specs={[
            { title: 'NYC 311 public benchmark data', dot: CLS.public },
            { title: 'Synthetic operational context', lines: ['Patrol logs · ticket records', 'closure templates (CTGAN / scripted)'], dot: CLS.synthetic },
            { title: 'Normalized Brampton-ready schema' },
            { title: 'NOT Brampton operational data', kind: 'warn' },
          ]}
        />
      </Zone>

      {/* Zone 6 — AI Services Zone */}
      <Zone x={COL.d} y={170} w={ZONE_W} h={570} num={6} title="AI Services Zone" subtitle="External APIs — server calls only" fill="#ede9fe" stroke="#6d28d9">
        <NodeStack
          x={COL.d}
          startY={228}
          specs={[
            { title: 'Cohere embeddings', lines: ['embed-english-v3.0'] },
            { title: 'Qdrant vector retrieval', lines: ['Top-50 closed cases · indexed offline'] },
            { title: 'Cohere reranking', lines: ['rerank-english-v3.0 → top ≤ 10'] },
            {
              title: 'Anthropic Claude generation',
              lines: ['claude-sonnet-4-6 · grounded drafting'],
              dot: CLS.advisory,
            },
            { title: 'Officer assistant provider chain', lines: ['Groq → Anthropic → Cohere Command'] },
            {
              title: 'Grounded + advisory only',
              lines: ['No autonomous enforcement decisions', 'No autonomous case closure', 'No direct resident communication', 'Staff approval always required'],
              kind: 'guard',
            },
          ]}
        />
      </Zone>

      {/* Zone 7 — Communications Zone */}
      <Zone x={COL.d} y={760} w={ZONE_W} h={310} num={7} title="Communications Zone" subtitle="Transactional email" fill="#cffafe" stroke="#0e7490">
        <NodeStack
          x={COL.d}
          startY={818}
          specs={[
            { title: 'Mailjet (Send API v3.1)' },
            { title: 'Resident confirmation email' },
            { title: 'Status + closure update emails' },
            {
              title: 'Server-side trigger only',
              lines: ['Sent only by controlled functions on', 'explicit actions · resident-only'],
              kind: 'guard',
            },
          ]}
        />
      </Zone>

      {/* Flows list panel */}
      <Panel x={COL.e} y={170} w={450} h={900} title="Numbered data flows">
        {FLOWS.map((f, i) => {
          const lines = wrap(f, 52)
          const y0 = 238 + i * 68
          return (
            <g key={i}>
              <FlowBadge cx={COL.e + 34} cy={y0 - 5} n={i + 1} />
              {lines.map((l, j) => (
                <text key={j} x={COL.e + 58} y={y0 + j * 18} fontSize={13.5} fill="#28395a">
                  {l}
                </text>
              ))}
            </g>
          )
        })}
      </Panel>

      {/* ---------------- Flow arrows ---------------- */}
      {/* 1 · Resident → App (HTTPS) */}
      <Flow d={`M360,240 H424`} badgeAt={[392, 222]} n={1} />
      {/* 2 · App → Supabase (validated write) */}
      <Flow d={`M730,300 H794`} badgeAt={[762, 282]} n={2} />
      {/* 12 · Approved action → status update / email trigger */}
      <Flow d={`M730,400 H794`} badgeAt={[762, 382]} n={12} />
      {/* 5 · Staff authenticate + retrieve work */}
      <Flow d={`M360,540 H424`} badgeAt={[392, 522]} n={5} />
      {/* 6 · Staff request AI review packet */}
      <Flow d={`M360,700 H424`} badgeAt={[392, 682]} n={6} />
      {/* 10 · Output returned to staff workspace */}
      <Flow d={`M600,640 V606`} badgeAt={[600, 623]} n={10} />
      {/* 7 · Function reads approved case context */}
      <Flow d={`M730,670 H794`} badgeAt={[762, 652]} n={7} />
      {/* 8 · Retrieval: embed → vector search → rerank (into Zone 6 left edge) */}
      <Flow d={`M730,712 H1164`} badgeAt={[940, 712]} n={8} />
      {/* 9 · Grounded generation (advisory only) */}
      <Flow d={`M730,730 H1164`} badgeAt={[1040, 730]} n={9} />
      {/* 4 · Confirmation email via Mailjet (elbow down into Zone 7) */}
      <Flow d={`M730,748 H1300 V754`} badgeAt={[1140, 748]} n={4} />

      {/* ================= FUTURE PRODUCTION ZONE ================= */}
      <Flow d={`M1020,1100 V1122`} badgeAt={[0, 0]} dashed stroke="#4f46e5" />
      <text x={1036} y={1118} fontSize={13} fill="#4338ca" fontStyle="italic">
        production hardening path — City approvals required
      </text>

      <g>
        <rect
          x={30}
          y={1130}
          width={1980}
          height={330}
          rx={16}
          fill="#eef2ff"
          stroke="#4f46e5"
          strokeWidth={3}
          strokeDasharray="14 8"
        />
        <circle cx={62} cy={1162} r={13} fill="#4f46e5" />
        <text x={62} y={1167} textAnchor="middle" fontSize={14} fontWeight={700} fill="#ffffff">
          9
        </text>
        <text x={84} y={1162} fontSize={17} fontWeight={800} fill="#1e1b4b" letterSpacing={0.4}>
          FUTURE CITY PRODUCTION ZONE — proposed control model (not built; requires City approval)
        </text>
        <text x={84} y={1184} fontSize={13.5} fill="#3730a3">
          A visually distinct target-state boundary: the POC above must be re-platformed into a City-approved Canadian environment before any real operational data is introduced.
        </text>
        {FUTURE_COLS.map((col, i) => {
          const cx = 84 + i * 640
          return (
            <g key={i}>
              <text x={cx} y={1222} fontSize={15} fontWeight={700} fill="#1e1b4b">
                {col.heading}
              </text>
              <BulletList x={cx} y={1250} maxChars={68} items={col.items} color="#4f46e5" lineH={20} gap={9} fontSize={14} />
            </g>
          )
        })}
      </g>

      {/* ================= BOTTOM PANELS ================= */}
      {/* Data classification legend */}
      <Panel x={30} y={1490} w={530} h={390} title="Data classification legend">
        {CLASSIFICATION.map((c, i) => (
          <g key={c.label}>
            <rect x={58} y={1548 + i * 40} width={26} height={18} rx={4} fill={c.color} />
            <text x={96} y={1562 + i * 40} fontSize={15} fill="#0f1a30">
              {c.label}
            </text>
          </g>
        ))}
        <text x={58} y={1852} fontSize={12.5} fill="#6b7693" fontStyle="italic">
          Coloured dots on diagram nodes mark the dominant classification.
        </text>
      </Panel>

      {/* Security controls */}
      <Panel x={600} y={1490} w={700} h={390} title="Security controls (current POC)">
        <BulletList x={630} y={1568} maxChars={42} items={SECURITY_CONTROLS.slice(0, 8)} color="#26735c" lineH={19} gap={12} fontSize={14} />
        <BulletList x={960} y={1568} maxChars={42} items={SECURITY_CONTROLS.slice(8)} color="#26735c" lineH={19} gap={12} fontSize={14} />
      </Panel>

      {/* Data residency */}
      <Panel x={1340} y={1490} w={670} h={390} title="Data residency">
        <text x={1370} y={1568} fontSize={15} fontWeight={700} fill="#92400e">
          Current POC
        </text>
        <BulletList x={1370} y={1596} maxChars={38} items={RESIDENCY_POC} color="#b45309" lineH={19} gap={12} fontSize={13.5} />
        <text x={1700} y={1568} fontSize={15} fontWeight={700} fill="#1e40af">
          Future production
        </text>
        <BulletList x={1700} y={1596} maxChars={38} items={RESIDENCY_PROD} color="#1e40af" lineH={19} gap={12} fontSize={13.5} />
      </Panel>

      {/* Required note */}
      {wrap(NOTE, 165).map((l, i) => (
        <text key={i} x={40} y={1916 + i * 22} fontSize={14.5} fontWeight={500} fill="#33476f" fontStyle="italic">
          {l}
        </text>
      ))}
      <text x={40} y={1974} fontSize={12.5} fill="#6b7693">
        Generated from repository inspection of umerqur/BramptonPOC — routes, Netlify functions, Supabase migrations (RLS), environment configuration, and service integrations.
      </text>
    </svg>
  )
})

export default SolutionArchitectureDiagram
