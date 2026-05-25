type Props = { className?: string }

export default function Logo({ className = 'h-7 w-7' }: Props) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#0f1a30" />
      <path
        d="M16 6 L24 10 V17 C24 21.5 20.5 25 16 26 C11.5 25 8 21.5 8 17 V10 Z"
        fill="none"
        stroke="#52ab8e"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.5" fill="#52ab8e" />
    </svg>
  )
}
