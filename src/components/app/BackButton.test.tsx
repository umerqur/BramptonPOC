import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import BackButton from './BackButton'

// BackButton must return to the exact previous screen when in-app history
// exists (navigate(-1)) and fall back to the given route when the page was
// opened directly. React Router keys this off window.history.state.idx, which
// jsdom lets us control directly.

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderApp(initialEntries: string[], initialIndex: number) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <LocationProbe />
      <Routes>
        <Route path="/app/officer/:caseId" element={<div>Officer case</div>} />
        <Route
          path="/app/nyc_case/:caseId"
          element={<BackButton fallback="/app/insights" label="Back" />}
        />
        <Route path="/app/insights" element={<div>Insights</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function setHistoryIdx(idx: number) {
  window.history.replaceState({ idx }, '')
}

afterEach(() => {
  window.history.replaceState(null, '')
})

describe('BackButton', () => {
  it('returns to the exact previous screen when history exists', () => {
    renderApp(['/app/officer/RSR-1', '/app/nyc_case/NYC-311-0001'], 1)
    setHistoryIdx(1) // one in-app entry behind us

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('location').textContent).toBe('/app/officer/RSR-1')
  })

  it('falls back to the safe route when there is no usable history', () => {
    renderApp(['/app/nyc_case/NYC-311-0001'], 0)
    setHistoryIdx(0) // deep link / refresh: nothing in-app behind us

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('location').textContent).toBe('/app/insights')
  })
})
