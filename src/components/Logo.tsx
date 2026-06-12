type Props = { className?: string }

/**
 * Proactive Enforcement brand mark.
 *
 * An original, abstract civic-tech mark — no square frame, no shield or badge.
 * It reads as an expanding signal pinging a point: two concentric, open arcs
 * (proactive monitoring / review sweeping outward) opening toward the upper
 * right, a leading node in that opening (a located case / response target), and
 * a solid core (the focus under review). Together they suggest signal, movement,
 * location, and response without any literal enforcement iconography.
 *
 * Drawn on a transparent 32×32 viewBox in the navy/accent palette so it stays
 * crisp at the small nav size (h-7 w-7 ≈ 28px) and scales up cleanly. The
 * className controls the rendered size.
 */
export default function Logo({ className = 'h-7 w-7' }: Props) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="pei-sweep" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1b2944" />
          <stop offset="1" stopColor="#33476f" />
        </linearGradient>
      </defs>

      {/* Outer monitoring sweep — open toward the upper right (forward / proactive) */}
      <circle
        cx="16"
        cy="16"
        r="11.5"
        fill="none"
        stroke="url(#pei-sweep)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="52.8 19.5"
      />

      {/* Inner response arc — accent green, concentric movement outward */}
      <circle
        cx="16"
        cy="16"
        r="6.5"
        fill="none"
        stroke="#358f73"
        strokeWidth="2.7"
        strokeLinecap="round"
        strokeDasharray="28.6 12.2"
      />

      {/* Leading node in the opening — a located case / response point */}
      <circle cx="24.6" cy="7.4" r="1.9" fill="#52ab8e" />

      {/* Core focus under review */}
      <circle cx="16" cy="16" r="2.7" fill="#0f1a30" />
    </svg>
  )
}
