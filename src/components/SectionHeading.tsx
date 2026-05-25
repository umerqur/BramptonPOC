import type { ReactNode } from 'react'

type Props = {
  eyebrow?: string
  title: string
  description?: ReactNode
  align?: 'left' | 'center'
}

export default function SectionHeading({ eyebrow, title, description, align = 'left' }: Props) {
  const alignClass = align === 'center' ? 'text-center mx-auto' : ''
  return (
    <div className={`max-w-3xl ${alignClass}`}>
      {eyebrow && <div className="section-eyebrow">{eyebrow}</div>}
      <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">{title}</h2>
      {description && <p className="mt-3 text-base text-ink-muted">{description}</p>}
    </div>
  )
}
