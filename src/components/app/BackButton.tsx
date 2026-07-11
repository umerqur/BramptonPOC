import { useNavigate } from 'react-router-dom'

// Back button that returns to the EXACT previous screen (with its scroll
// context) when browser history exists, and falls back to a safe route when
// the page was opened directly (deep link, refresh, new tab).
//
// React Router stamps an incrementing `idx` onto window.history.state — idx 0
// is the first in-app entry, so anything above 0 means navigate(-1) lands on a
// real previous in-app screen.

export default function BackButton({ fallback, label = 'Back' }: { fallback: string; label?: string }) {
  const navigate = useNavigate()

  function goBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) {
      navigate(-1)
    } else {
      navigate(fallback)
    }
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-600 hover:text-accent-700"
      aria-label={label}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden
      >
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </svg>
      {label}
    </button>
  )
}
