import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './supabase'

/**
 * Allowlist of users permitted to access the authenticated `/app` area.
 * There is no public signup — magic links are only sent to these addresses.
 */
export const ALLOWED_EMAILS = [
  'umer.qureshi@gmail.com',
  'umer@neuralforge.ca',
  'zeddotes@gmail.com',
  'hasham.qureshi@gmail.com',
  'liboluo@hotmail.com',
  'ousmaan_ahmed@icloud.com',
  'balraj_m7@hotmail.com',
  'yuri.levin@queensu.ca',
  // Demo By-law Officer account (staff role comes from the profile list in
  // src/lib/roles.ts — this email is the officer profile).
  'oakley.carpentry_worker@yahoo.com',
] as const

export const RESTRICTED_MESSAGE = 'Access is restricted to authorized project users.'

export function isAllowedEmail(email: string): boolean {
  return ALLOWED_EMAILS.includes(email.trim().toLowerCase() as (typeof ALLOWED_EMAILS)[number])
}

type AuthContextValue = {
  session: Session | null
  loading: boolean
  /** True once the initial session check has completed. */
  ready: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setReady(true)
      return
    }
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setReady(true)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading: !ready,
      ready,
      async signOut() {
        if (supabase) await supabase.auth.signOut()
        setSession(null)
      },
    }),
    [session, ready],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

export { isSupabaseConfigured }
