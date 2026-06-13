import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useWorkflow } from './workflowStore'
import type { DemoCase } from '../data/demoWorkflowTypes'

/**
 * Resolves the case a page should focus on. Honours a `?case=<id>` query param
 * (so deep links from the intake form / audit trail land on the right case) and
 * otherwise falls back to the store's active case.
 */
export function useDemoCase(): DemoCase | null {
  const { activeCase, cases, setActiveCase } = useWorkflow()
  const [params] = useSearchParams()
  const wanted = params.get('case')

  useEffect(() => {
    if (wanted && wanted !== activeCase?.id && cases.some((c) => c.id === wanted)) {
      setActiveCase(wanted)
    }
  }, [wanted, activeCase?.id, cases, setActiveCase])

  if (wanted) return cases.find((c) => c.id === wanted) ?? activeCase
  return activeCase
}
