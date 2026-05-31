import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Supabase connection for the EnforcementPOC project.
// Credentials are read from Vite environment variables so no secrets are
// committed to the repository:
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY
//
// Only the public anon key is ever used in the frontend. The service_role key
// must never be shipped to the browser.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * True only when both env vars are present. Live Supabase data is only ever
 * read from inside the authenticated `/app` area; public demo pages never
 * depend on this and always render bundled mock data.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        // Persist the session so a magic-link login survives reloads, and
        // detect the token returned in the redirect URL after the user clicks
        // the link in their email.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
