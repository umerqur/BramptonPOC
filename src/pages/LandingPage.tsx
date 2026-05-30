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
        {/* Accent glow behind the visual panel */}
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

            {/* Command center visual */}
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

type HeroRisk = 'Critical' | 'High' | 'Medium'

const heroKpis = [
  { label: 'Open requests', value: '1,284', delta: '+46 this week', tone: 'neutral' as const },
  { label: 'High risk records', value: '96', delta: 'High or Critical', tone: 'alert' as const },
  { label: 'Stale cases', value: '37', delta: 'Past SLA window', tone: 'warn' as const },
  { label: 'Repeat locations', value: '22', delta: '3+ complaints', tone: 'accent' as const },
]

const heroQueue: { id: string; category: string; district: string; days: number; risk: HeroRisk }[] = [
  { id: 'SR-4471', category: 'Property Standards', district: 'District 4', days: 18, risk: 'Critical' },
  { id: 'SR-3920', category: 'Illegal Dumping', district: 'District 7', days: 11, risk: 'High' },
  { id: 'SR-5012', category: 'Noise', district: 'District 2', days: 6, risk: 'Medium' },
]

const heroActivity = [
  { text: 'Repeat complaint cluster flagged · District 4', when: '2m' },
  { text: 'Case summary prepared for staff review', when: '14m' },
  { text: 'Stale case escalated past SLA window', when: '1h' },
]

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-xl rounded-2xl border border-white/10 bg-gradient-to-b from-navy-800/80 to-navy-950/80 p-3 shadow-2xl ring-1 ring-inset ring-white/5 backdrop-blur-sm sm:p-4">
      {/* Panel header */}
      <div className="flex items-center justify-between gap-3 px-1 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-500/15 text-accent-300 ring-1 ring-inset ring-accent-500/30">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m7 14 3-4 3 3 4-6"/></svg>
          </span>
          <span className="text-sm font-semibold text-white">Enforcement Intelligence</span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-navy-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-400" />
          Demo workspace
        </span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-2.5">
        {heroKpis.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-navy-200">{kpi.label}</div>
            <div className="mt-1 text-xl font-semibold text-white tabular-nums">{kpi.value}</div>
            <div
              className={
                'mt-1 text-[10px] ' +
                (kpi.tone === 'alert'
                  ? 'text-red-300'
                  : kpi.tone === 'warn'
                    ? 'text-amber-200'
                    : kpi.tone === 'accent'
                      ? 'text-accent-300'
                      : 'text-navy-200')
              }
            >
              {kpi.delta}
            </div>
          </div>
        ))}
      </div>

      {/* Hotspot map + activity */}
      <div className="mt-2.5 grid grid-cols-5 gap-2.5">
        <div className="col-span-3 rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">Hotspots</span>
            <span className="text-[10px] text-navy-200">Complaint density</span>
          </div>
          <div className="mt-2 overflow-hidden rounded-md border border-white/10 bg-navy-950/60">
            <HeroMap />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-navy-200">
            <LegendDot color="bg-red-400" label="Critical" />
            <LegendDot color="bg-orange-400" label="High" />
            <LegendDot color="bg-amber-300" label="Medium" />
          </div>
        </div>

        <div className="col-span-2 rounded-lg border border-white/10 bg-white/5 p-3">
          <span className="text-[11px] font-semibold text-white">Case activity</span>
          <ul className="mt-2.5 space-y-2.5">
            {heroActivity.map((a) => (
              <li key={a.text} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400 ring-2 ring-accent-400/20" />
                <div className="min-w-0">
                  <p className="text-[10px] leading-tight text-navy-100">{a.text}</p>
                  <p className="text-[9px] text-navy-300">{a.when} ago</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Priority queue preview */}
      <div className="mt-2.5 rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-white">Priority queue</span>
          <span className="text-[10px] text-navy-200">Ranked by risk score</span>
        </div>
        <ul className="mt-2 divide-y divide-white/5">
          {heroQueue.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <span className="text-[11px] font-medium text-white tabular-nums">{row.id}</span>
                <span className="ml-2 text-[10px] text-navy-200">{row.category}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden text-[9px] text-navy-300 sm:inline">{row.district}</span>
                <span className="text-[9px] text-navy-300 tabular-nums">{row.days}d</span>
                <HeroRiskTag risk={row.risk} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Demo data label */}
      <div className="mt-3 flex items-center justify-center gap-1.5 px-1 text-[10px] text-navy-300">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        Demo data modelled on public 311 service requests
      </div>
    </div>
  )
}

function HeroRiskTag({ risk }: { risk: HeroRisk }) {
  const styles: Record<HeroRisk, string> = {
    Critical: 'bg-red-500/15 text-red-300 ring-red-500/30',
    High: 'bg-orange-500/15 text-orange-300 ring-orange-500/30',
    Medium: 'bg-amber-400/15 text-amber-200 ring-amber-400/30',
  }
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium ring-1 ring-inset ${styles[risk]}`}>
      {risk}
    </span>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {label}
    </span>
  )
}

function HeroMap() {
  return (
    <svg viewBox="0 0 320 150" className="h-auto w-full">
      <defs>
        <pattern id="heroGrid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="1" />
        </pattern>
        <radialGradient id="heroHot" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f87171" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#f87171" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="heroWarm" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fb923c" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="heroMed" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fcd34d" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#fcd34d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="320" height="150" fill="url(#heroGrid)" />
      {/* mock roads */}
      <path d="M0 55 L320 48" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="2" />
      <path d="M0 108 L320 114" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="2" />
      <path d="M95 0 L100 150" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="2" />
      <path d="M225 0 L222 150" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="2" />
      {/* heat blobs */}
      <circle cx="100" cy="55" r="46" fill="url(#heroHot)" />
      <circle cx="228" cy="112" r="40" fill="url(#heroWarm)" />
      <circle cx="170" cy="82" r="30" fill="url(#heroMed)" />
      {/* points */}
      <circle cx="100" cy="55" r="2.5" fill="#f87171" />
      <circle cx="106" cy="60" r="1.8" fill="#f87171" />
      <circle cx="94" cy="49" r="1.8" fill="#f87171" />
      <circle cx="228" cy="112" r="2.2" fill="#fb923c" />
      <circle cx="235" cy="117" r="1.6" fill="#fb923c" />
      <circle cx="170" cy="82" r="1.8" fill="#fcd34d" />
    </svg>
  )
}
