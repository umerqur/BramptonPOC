type Props = { className?: string }

export default function Logo({ className = 'h-7 w-7' }: Props) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="pei-badge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c4587" />
          <stop offset="1" stopColor="#0c1c3a" />
        </linearGradient>
        <linearGradient id="pei-pin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3c79d6" />
          <stop offset="1" stopColor="#1b4a93" />
        </linearGradient>
        <linearGradient id="pei-rose" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7d066" />
          <stop offset="1" stopColor="#e0a528" />
        </linearGradient>
      </defs>

      {/* Civic badge field */}
      <rect width="32" height="32" rx="7" fill="url(#pei-badge)" />
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="6.25" fill="none" stroke="#ffffff" strokeOpacity="0.10" />

      {/* Data-node signal — explainable AI / map nodes / human review */}
      <g stroke="#7cc0f0" strokeOpacity="0.45" strokeWidth="0.9" fill="#9fd3f5" fillOpacity="0.55">
        <path d="M6.5 7.5 L16 4.5 L25.5 7.5" fill="none" />
        <circle cx="6.5" cy="7.5" r="1.5" />
        <circle cx="16" cy="4.5" r="1.5" />
        <circle cx="25.5" cy="7.5" r="1.5" />
      </g>

      {/* Location pin — local ward context */}
      <path
        d="M16 28.5 C 12 23.5 8 19 8 13 a 8 8 0 1 1 16 0 c 0 6 -4 10.5 -8 15.5 Z"
        fill="url(#pei-pin)"
        stroke="#f3c64f"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />

      {/* Civic rose — Brampton identity / decision bloom */}
      <g fill="url(#pei-rose)">
        <circle cx="16" cy="9.6" r="2.5" />
        <circle cx="19.0" cy="11.8" r="2.5" />
        <circle cx="17.85" cy="15.35" r="2.5" />
        <circle cx="14.15" cy="15.35" r="2.5" />
        <circle cx="13.0" cy="11.8" r="2.5" />
      </g>
      <circle cx="16" cy="12.5" r="2.4" fill="#fbf4e0" />
      <circle cx="16" cy="12.5" r="1.05" fill="#e0a528" />
    </svg>
  )
}
