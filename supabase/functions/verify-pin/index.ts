import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { openShare, type SharePayload } from '../_shared/encrypter.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}

const LOCK_EVERY = 5
const LOCK_MS = 15 * 60 * 1000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function urlAllowed(fileUrl: string, supabaseUrl: string): boolean {
  try {
    const file = new URL(fileUrl)
    const project = new URL(supabaseUrl)
    if (file.origin !== project.origin) return false
    if (!file.pathname.includes('/storage/v1/object/sign/cases/')) return false
    return !file.pathname.includes('..')
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)

  let body: { token?: unknown; pin?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'missing' }, 400)
  }

  const token = typeof body.token === 'string' ? body.token : ''
  const pin = typeof body.pin === 'string' ? body.pin : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return json({ error: 'missing' }, 404)
  }
  if (!/^\d{4}$/.test(pin)) return json({ error: 'pin' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'server' }, 500)

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: row, error } = await admin
    .from('shares')
    .select('id, owner_id, salt, iv, ciphertext, expires_at, failed_attempts, locked_until')
    .eq('id', token)
    .maybeSingle()

  if (error) return json({ error: 'server' }, 500)
  if (!row) return json({ error: 'missing' }, 404)
  if (new Date(row.expires_at).getTime() <= Date.now()) return json({ error: 'expired' }, 410)
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return json({ error: 'locked', retry_at: row.locked_until }, 423)
  }

  // Stretch the PIN, then decrypt. Failure means the PIN is wrong.
  const payload: SharePayload | null = await openShare(pin, {
    salt: row.salt,
    iv: row.iv,
    ciphertext: row.ciphertext,
  })

  if (!payload) {
    const attempts = Number(row.failed_attempts) + 1
    const lock = attempts % LOCK_EVERY === 0
    await admin
      .from('shares')
      .update({
        failed_attempts: attempts,
        locked_until: lock ? new Date(Date.now() + LOCK_MS).toISOString() : row.locked_until,
      })
      .eq('id', row.id)
    if (lock) {
      return json({ error: 'locked', retry_at: new Date(Date.now() + LOCK_MS).toISOString() }, 423)
    }
    return json({ error: 'pin' }, 401)
  }

  if (!payload.files.every((file) => urlAllowed(file.url, url))) {
    return json({ error: 'server' }, 500)
  }

  await admin.from('shares').update({ failed_attempts: 0, locked_until: null }).eq('id', row.id)
  return json({
    title: payload.title || 'Case',
    files: payload.files.map((file) => ({ name: file.name, url: file.url })),
  })
})
