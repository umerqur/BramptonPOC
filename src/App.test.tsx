import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { DIAGRAM_TITLE_LINE_1 } from './components/architecture/SolutionArchitectureDiagram'

// Routing tests for the public Solution Architecture page. The page is a City
// submission artifact and must be reachable by external reviewers with no
// Supabase session, while the rest of /app stays behind ProtectedRoute.
//
// No Supabase env vars are set in tests, so AuthProvider resolves to
// "ready, no session" — exactly the state of a logged-out visitor.

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('public Solution Architecture routing', () => {
  it('renders /solution-architecture without a session, with export actions', async () => {
    renderAt('/solution-architecture')

    expect(await screen.findByRole('heading', { name: DIAGRAM_TITLE_LINE_1 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download SVG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download PNG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeInTheDocument()
    // Public Layout nav is present (Methodology link), not the login page.
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('redirects the old /app/solution-architecture URL to the public page when logged out', async () => {
    renderAt('/app/solution-architecture')

    expect(await screen.findByRole('heading', { name: DIAGRAM_TITLE_LINE_1 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('shows a Solution Architecture link in the public navigation', async () => {
    renderAt('/methodology')

    const links = await screen.findAllByRole('link', { name: 'Solution Architecture' })
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute('href', '/solution-architecture')
  })

  it('still gates the rest of /app behind login', async () => {
    renderAt('/app')

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: DIAGRAM_TITLE_LINE_1 })).not.toBeInTheDocument()
  })
})
