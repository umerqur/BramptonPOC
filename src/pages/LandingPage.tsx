import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import SectionHeading from '../components/SectionHeading'

const aiCapabilities = [
  { title: 'Summarizes complaint history', body: 'Generates a clear, time-ordered summary of complaints associated with an address or case.' },
  { title: 'Detects repeat complaint patterns', body: 'Identifies addresses, areas, and categories with recurring or escalating activity.' },
  { title: 'Ranks cases by priority', body: 'Combines rules and signals to produce a transparent risk score and recommended priority.' },
  { title: 'Explains risk drivers', body: 'Every score includes the specific factors that contributed to it — no black box.' },
  { title: 'Recommends next operational action', body: 'Suggests a next step (monitor, notice, inspect, escalate) for staff review.' },
  { title: 'Prepares officer briefing notes', body: 'Produces a short, officer ready briefing combining history, signals, and recommended actions.' },
]

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy-900 text-white">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 80% 60%, white 1px, transparent 1px)',
            backgroundSize: '32px 32px, 48px 48px',
          }}
        />
        {/* Accent glow behind the visual */}
        <div className="pointer-events-none absolute -top-24 right-0 h-96 w-96 rounded-full bg-accent-500/10 blur-3xl" />
        <div className="container-page relative py-20 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-10">
            {/* Copy */}
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white ring-1 ring-inset ring-white/20">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-400" />
                Municipal AI Proof of Concept
              </div>
              <h1 className="mt-5 text-4xl sm:text-5xl lg:text-[3.25rem] lg:leading-[1.05] font-semibold tracking-tight">
                AI assisted enforcement intelligence for municipal operations
              </h1>
              <p className="mt-5 text-lg text-navy-100">
                A proof of concept that helps enforcement teams identify repeat complaint patterns, prioritize
                inspection queues, surface stale or high risk service requests, and prepare staff ready case summaries.
              </p>
              <div className="mt-6 text-sm sm:text-base text-navy-200">
                <p>
                  Built on real public 311 service request data normalized into a municipal enforcement schema, with
                  synthetic internal workflow fields used only where patrol, ticket, or closure data is not publicly
                  available. No private City data is required for the initial POC.
                </p>
              </div>

              <div className="mt-10 flex flex-col sm:flex-row gap-3">
                <Link to="/dashboard" className="btn-accent">
                  View Demo Dashboard
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                </Link>
                <Link to="/methodology" className="btn-secondary bg-white/5 text-white border-white/20 hover:bg-white/10 hover:border-white/40">
                  Read POC Methodology
                </Link>
              </div>

              <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-navy-200">
                <span className="inline-flex items-center gap-1.5"><Dot /> Real public 311 data + synthetic internal fields</span>
                <span className="inline-flex items-center gap-1.5"><Dot /> Decision support, not automated enforcement</span>
                <span className="inline-flex items-center gap-1.5"><Dot /> Human in the loop by design</span>
              </div>
            </div>

            {/* Municipal operations visual */}
            <div className="relative lg:pl-2">
              <HeroVisual />
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="container-page py-16 lg:py-20">
        <SectionHeading eyebrow="01 — Problem" title="High complaint volume, limited time to triage" />
        <p className="mt-4 max-w-3xl text-ink-muted">
          Municipal enforcement teams receive large volumes of complaints across property standards, parking, noise,
          waste, zoning, licensing, and other bylaw categories. Reviewing repeat complaints, identifying hotspots, and
          preparing case packages can be manual and time consuming.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { stat: '8+', label: 'Bylaw categories' },
            { stat: 'Multiple', label: 'Intake channels (311, mobile, web, phone)' },
            { stat: 'Manual', label: 'Repeat-pattern detection across files' },
            { stat: 'Time-bound', label: 'Officer capacity to prepare case packages' },
          ].map((item) => (
            <div key={item.label} className="card p-5">
              <div className="text-2xl font-semibold text-navy-900">{item.stat}</div>
              <div className="mt-1 text-sm text-ink-muted">{item.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Solution */}
      <section className="bg-white border-y border-slate-200">
        <div className="container-page py-16 lg:py-20">
          <SectionHeading
            eyebrow="02 — Solution"
            title="An assistive layer over existing intake and enforcement workflows"
          />
          <p className="mt-4 max-w-3xl text-ink-muted">
            The system combines real public 311 service request data normalized into an enforcement schema,
            synthetic records for missing internal workflow fields, rules based risk scoring, machine learning ready
            features, and AI generated case summaries to support faster triage and better operational visibility.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { title: 'Real public 311 data layer', body: 'NYC 311 service request data is normalized into a Brampton compatible enforcement schema, with synthetic records used only for missing internal workflow fields.' },
              { title: 'Transparent scoring', body: 'A rules based risk score with explainable drivers and ML ready feature design.' },
              { title: 'Officer ready outputs', body: 'Case summaries, recommended actions, and briefing notes designed for staff review.' },
            ].map((c) => (
              <div key={c.title} className="card p-6">
                <div className="h-9 w-9 rounded-md bg-navy-900/5 flex items-center justify-center text-navy-900">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
                </div>
                <h3 className="mt-4 text-base font-semibold text-navy-900">{c.title}</h3>
                <p className="mt-1.5 text-sm text-ink-muted">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What the AI does */}
      <section className="container-page py-16 lg:py-20">
        <SectionHeading eyebrow="03 — What the AI does" title="Six assistive capabilities, all designed for staff review" />
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {aiCapabilities.map((c, i) => (
            <div key={c.title} className="card p-5 card-hover">
              <div className="text-xs font-semibold text-accent-700">0{i + 1}</div>
              <h3 className="mt-2 text-base font-semibold text-navy-900">{c.title}</h3>
              <p className="mt-1.5 text-sm text-ink-muted">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Human in the loop */}
      <section className="bg-navy-900 text-white">
        <div className="container-page py-16 lg:py-20">
          <div className="grid lg:grid-cols-5 gap-10 items-start">
            <div className="lg:col-span-2">
              <div className="section-eyebrow text-accent-300">04 — Human in the loop</div>
              <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                The system does not make enforcement decisions
              </h2>
            </div>
            <div className="lg:col-span-3 space-y-4 text-navy-100">
              <p>
                It supports City staff by preparing information, explaining patterns, and helping prioritize review.
                Final decisions remain with authorized municipal staff.
              </p>
              <ul className="grid gap-2 sm:grid-cols-2 pt-2">
                {[
                  'No automated notices',
                  'No automated penalties',
                  'All recommendations are advisory',
                  'Full audit trail of AI-generated content',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <svg className="mt-0.5 text-accent-400 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="pt-4 flex flex-col sm:flex-row gap-3">
                <Link to="/privacy" className="btn-secondary bg-white/5 text-white border-white/20 hover:bg-white/10 hover:border-white/40">
                  Privacy &amp; Security
                </Link>
                <Link to="/how-it-works" className="btn-accent">How It Works</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function Dot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-accent-400" />
}

/* ----------------------------------------------------------------------------
 * Hero visual — a municipal operations scene.
 * A stylized neighbourhood map with service request pins, a field inspector,
 * a resident request, and the triage workflow. Analytics are kept secondary,
 * so the landing page reads as community service rather than a dashboard.
 * -------------------------------------------------------------------------- */

const workflowStages = [
  'Repeat complaint pattern',
  'Inspection queue',
  'Staff review',
  'Closure summary',
]

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-xl">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-navy-800/80 to-navy-950/85 p-3 shadow-2xl ring-1 ring-inset ring-white/5 backdrop-blur-sm sm:p-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-1 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-500/15 text-accent-300 ring-1 ring-inset ring-accent-500/30">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/></svg>
            </span>
            <span className="text-sm font-semibold text-white">Neighbourhood operations</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-navy-200 ring-1 ring-inset ring-white/10">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-400" />
            Ward view
          </span>
        </div>

        {/* Neighbourhood map scene */}
        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-navy-950/60">
          <NeighbourhoodScene />

          {/* Resident service request */}
          <div className="absolute left-2.5 top-2.5 max-w-[150px] rounded-lg rounded-bl-sm border border-white/10 bg-white/10 px-2.5 py-1.5 shadow-lg backdrop-blur-sm">
            <div className="flex items-center gap-1.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#85c7b1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span className="text-[9px] font-semibold uppercase tracking-wide text-accent-300">Resident request</span>
            </div>
            <p className="mt-0.5 text-[10px] leading-tight text-navy-100">“Overflowing bins on our street again.”</p>
          </div>

          {/* Hotspot marker */}
          <div className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[9px] font-medium text-amber-200 ring-1 ring-inset ring-amber-400/25 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
            Hotspot · Ward 4
          </div>

          {/* Field inspector */}
          <div className="absolute bottom-2.5 left-2.5 flex items-center gap-2 rounded-lg border border-white/10 bg-navy-900/80 px-2.5 py-1.5 shadow-lg backdrop-blur-sm">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500/15 ring-1 ring-inset ring-accent-500/30">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#85c7b1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="6" r="3"/><path d="M3.5 20v-1.5A5 5 0 0 1 8.5 13.5"/><rect x="13" y="11" width="8" height="10" rx="1"/><path d="M15 14.5h4"/><path d="M15 17h4"/></svg>
            </span>
            <div className="leading-tight">
              <p className="text-[10px] font-semibold text-white">Field inspector</p>
              <p className="text-[9px] text-navy-200">Reviewing case on site</p>
            </div>
          </div>
        </div>

        {/* Triage workflow */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {workflowStages.map((stage, i) => (
            <Fragment key={stage}>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-navy-100">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-400" />
                {stage}
              </span>
              {i < workflowStages.length - 1 && (
                <svg className="hidden shrink-0 text-navy-400 sm:block" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
              )}
            </Fragment>
          ))}
        </div>

        {/* Secondary analytics layer */}
        <div className="mt-2.5 grid grid-cols-5 gap-2.5">
          <div className="col-span-2 rounded-lg border border-white/10 bg-white/5 p-2.5">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[9px] font-medium uppercase tracking-wide text-navy-200">Risk signal</span>
              <span className="text-[9px] font-medium text-amber-200">Elevated</span>
            </div>
            <svg viewBox="0 0 120 36" className="mt-1.5 h-auto w-full" aria-hidden="true">
              <polyline points="2,30 22,26 42,28 62,18 82,20 102,9 118,5" fill="none" stroke="#52ab8e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="118" cy="5" r="2.5" fill="#85c7b1" />
            </svg>
          </div>
          <div className="col-span-3 rounded-lg border border-white/10 bg-white/5 p-2.5">
            <div className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#85c7b1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>
              <span className="text-[10px] font-semibold text-white">Staff ready case summary</span>
            </div>
            <p className="mt-1 text-[9px] leading-snug text-navy-200">
              3 repeat complaints in 30 days · last inspection 12d ago · recommend on-site review.
            </p>
          </div>
        </div>

        {/* Label */}
        <div className="mt-3 flex items-center justify-center gap-1.5 px-1 text-[10px] font-medium text-navy-300">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
          Decision support for municipal staff
        </div>
      </div>
    </div>
  )
}

function NeighbourhoodScene() {
  return (
    <svg viewBox="0 0 400 248" className="h-auto w-full" role="img" aria-label="Stylized neighbourhood map with streets, homes, a park, and service request pins">
      <defs>
        <pattern id="heroGrid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
        <radialGradient id="heroHotspot" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fb923c" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="400" height="248" fill="url(#heroGrid)" />

      {/* Park */}
      <g>
        <rect x="258" y="110" width="118" height="80" rx="12" fill="#358f73" fillOpacity="0.16" stroke="#52ab8e" strokeOpacity="0.35" />
        <circle cx="284" cy="140" r="9" fill="#52ab8e" fillOpacity="0.5" />
        <circle cx="312" cy="156" r="11" fill="#52ab8e" fillOpacity="0.42" />
        <circle cx="344" cy="138" r="8" fill="#52ab8e" fillOpacity="0.5" />
        <path d="M286 172 q14 -9 28 0" fill="none" stroke="#52ab8e" strokeOpacity="0.4" strokeWidth="2" strokeLinecap="round" />
        <text x="262" y="182" fontSize="8" fill="#85c7b1" fillOpacity="0.85">Park</text>
      </g>

      {/* Roads */}
      <g>
        <rect x="0" y="92" width="400" height="24" fill="#ffffff" fillOpacity="0.05" />
        <line x1="0" y1="104" x2="400" y2="104" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="1.5" strokeDasharray="11 9" />
        <rect x="150" y="0" width="22" height="248" fill="#ffffff" fillOpacity="0.05" />
        <line x1="161" y1="0" x2="161" y2="248" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="1.5" strokeDasharray="11 9" />
      </g>

      {/* Hotspot glow */}
      <circle cx="86" cy="58" r="50" fill="url(#heroHotspot)" />

      {/* Homes — top-left block */}
      <House x={26} y={34} />
      <House x={66} y={34} />
      <House x={106} y={42} w={22} />
      <House x={30} y={68} w={22} />

      {/* Buildings — bottom-left block */}
      <Building x={30} y={150} w={26} h={62} />
      <Building x={64} y={166} w={22} h={46} />
      <Building x={96} y={156} w={24} h={56} />

      {/* Homes — top-right block */}
      <House x={196} y={36} />
      <House x={236} y={36} />
      <House x={312} y={40} w={22} />
      <House x={352} y={40} w={22} />

      {/* Service request pins */}
      <Pin x={88} y={60} color="#f87171" pulse />
      <Pin x={54} y={178} color="#358f73" />
      <Pin x={214} y={62} color="#fbbf24" />
      <Pin x={330} y={150} color="#358f73" />
      <Pin x={118} y={200} color="#358f73" />
    </svg>
  )
}

function House({ x, y, w = 26 }: { x: number; y: number; w?: number }) {
  const h = w * 0.78
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M0 ${h * 0.42} L${w / 2} 0 L${w} ${h * 0.42} Z`} fill="#94a4c5" fillOpacity="0.5" />
      <rect x={w * 0.12} y={h * 0.42} width={w * 0.76} height={h * 0.58} rx="1.5" fill="#6477a5" fillOpacity="0.42" />
      <rect x={w * 0.44} y={h * 0.62} width={w * 0.18} height={h * 0.38} fill="#08111f" fillOpacity="0.45" />
    </g>
  )
}

function Building({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const cols = 2
  const rows = Math.max(2, Math.round(h / 16))
  const windows = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      windows.push(
        <rect
          key={`${r}-${c}`}
          x={w * (0.22 + c * 0.4)}
          y={10 + r * 14}
          width={w * 0.18}
          height="6"
          rx="1"
          fill="#c2cce0"
          fillOpacity="0.35"
        />,
      )
    }
  }
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="0" y="0" width={w} height={h} rx="2" fill="#445a89" fillOpacity="0.4" />
      {windows}
    </g>
  )
}

function Pin({ x, y, color, pulse = false }: { x: number; y: number; color: string; pulse?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {pulse && <circle cx="0" cy="-16" r="11" fill={color} fillOpacity="0.18" />}
      <path d="M0 0 C-8 -12 -8 -20 0 -25 C8 -20 8 -12 0 0 Z" fill={color} />
      <circle cx="0" cy="-16" r="3.4" fill="#08111f" fillOpacity="0.85" />
    </g>
  )
}
