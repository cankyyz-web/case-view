import { db, getConfig } from './supabase'

export type GrantedFile = { name: string; url: string }
export type Grant = { title: string; files: GrantedFile[] }

export type VerifyResult =
  | { ok: true; grant: Grant }
  | { ok: false; reason: 'pin' | 'expired' | 'locked' | 'missing' | 'config' | 'network'; retryAt?: string }

export type ShareRecord = {
  id: string
  title: string
  expires_at: string
  created_at: string
  failed_attempts: number
  locked_until: string | null
}

export async function verifyPin(token: string, pin: string): Promise<VerifyResult> {
  const config = getConfig()
  if (!config || !db()) return { ok: false, reason: 'config' }
  try {
    const response = await fetch(`${config.url}/functions/v1/verify-pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anon,
        Authorization: `Bearer ${config.anon}`,
      },
      body: JSON.stringify({ token, pin }),
    })
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
      retry_at?: string
      title?: string
      files?: GrantedFile[]
    }
    if (response.ok && body.files?.length) {
      return { ok: true, grant: { title: body.title || 'Case', files: body.files } }
    }
    if (body.error === 'expired') return { ok: false, reason: 'expired' }
    if (body.error === 'locked') return { ok: false, reason: 'locked', retryAt: body.retry_at }
    if (body.error === 'missing') return { ok: false, reason: 'missing' }
    if (body.error === 'pin' || response.status === 401) return { ok: false, reason: 'pin' }
    return { ok: false, reason: 'network' }
  } catch {
    return { ok: false, reason: 'network' }
  }
}
