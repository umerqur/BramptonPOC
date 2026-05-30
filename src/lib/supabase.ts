import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Supabase connection for the EnforcementPOC project.
// Credentials are read from Vite environment variables so no secrets are
// committed to the repository:
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * True only when both env vars are present. When false, the app falls back to
 * the bundled mock data so the POC always renders something sensible.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: { persistSession: false },
    })
  : null
