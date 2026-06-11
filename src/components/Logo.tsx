type Props = { className?: string }

/**
 * Proactive Enforcement Intelligence brand mark.
 *
 * An original, abstract municipal-intelligence mark — not the City of Brampton
 * logo, not a literal police badge, no cartoon iconography. It combines:
 *  - abstract shield geometry (enforcement / authority) in white negative space
 *    with a premium gold edge,
 *  - concentric signal arcs emanating from the core (proactive monitoring /
 *    oversight / intelligence),
 *  - a central oversight node (the intelligence core),
 *  - a soft pointed base (a subtle location-intelligence cue).
 *
 * Built on deep navy with a gold accent so it reads crisply at the small header
 * size (h-7 w-7 ≈ 28px) and stays refined when scaled up for landing or brand
 * sections. Drawn in a 32×32 viewBox; the className controls the rendered size.
 */
export default function Logo({ className = 'h-7 w-7' }: Props) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="pei-field" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2944" />
          <stop offset="1" stopColor="#0b1630" />
        </linearGradient>
        <linearGradient id="pei-shield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e7eef8" />
        </linearGradient>
        <linearGradient id="pei-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4cf6c" />
          <stop offset="1" stopColor="#cd982e" />
        </linearGradient>
      </defs>

      {/* Navy field — premium app-icon framing */}
      <rect width="32" height="32" rx="7" fill="url(#pei-field)" />
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="6.25" fill="none" stroke="#ffffff" strokeOpacity="0.12" />

      {/* Abstract shield — white negative space with a premium gold edge.
          The pointed base doubles as a subtle location cue. */}
      <path
        d="M16 5.6 L24.4 8.9 L24.4 16.1 C24.4 20.7 20.6 24.3 16 26.2 C11.4 24.3 7.6 20.7 7.6 16.1 L7.6 8.9 Z"
        fill="url(#pei-shield)"
        stroke="url(#pei-gold)"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />

      {/* Signal arcs — proactive monitoring / oversight radiating from the core */}
      <g fill="none" stroke="#1b2944" strokeWidth="1.25" strokeLinecap="round" strokeOpacity="0.92">
        <path d="M12.6 13.6 A4.5 4.5 0 0 1 19.4 13.6" />
        <path d="M10.8 12.1 A6.8 6.8 0 0 1 21.2 12.1" strokeOpacity="0.55" />
      </g>

      {/* Central oversight node — the intelligence core */}
      <circle cx="16" cy="16.6" r="2.7" fill="#142340" />
      <circle cx="16" cy="16.6" r="1.2" fill="url(#pei-gold)" />
    </svg>
  )
}
