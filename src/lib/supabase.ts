import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isConfigured = Boolean(url && key && !url.includes('proje-kodunuz'))
export const supabase = isConfigured ? createClient(url!, key!, {
  auth: { persistSession: true, detectSessionInUrl: true, flowType: 'implicit' },
}) : null
