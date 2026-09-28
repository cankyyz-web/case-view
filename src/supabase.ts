import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type SupabaseConfig = { url: string; anon: string }

let client: SupabaseClient | null = null

export function getConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !anon || url.includes('YOUR_PROJECT') || anon === 'your_anon_key') return null
  return { url: url.replace(/\/$/, ''), anon }
}

export function db(): SupabaseClient | null {
  const config = getConfig()
  if (!config) return null
  if (!client) {
    client = createClient(config.url, config.anon, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  }
  return client
}

export function publicOrigin(): string {
  const configured = import.meta.env.VITE_PUBLIC_ORIGIN?.trim().replace(/\/$/, '')
  return configured || location.origin
}

export function shareLink(id: string): string {
  const path = location.pathname
  return `${publicOrigin()}${path}#/v/${id}`
}

export function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0'
  } catch {
    return false
  }
}
