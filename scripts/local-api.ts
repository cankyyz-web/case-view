import type { IncomingMessage, ServerResponse } from 'node:http'
import Busboy from 'busboy'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomPin, sealShare } from '../supabase/functions/_shared/encrypter'
import { caseFolderName, displayName, isMeshFile, uniqueFileName } from '../src/names'

const BUCKET = 'cases'
const HOUR_MS = 60 * 60 * 1000

type Upload = { filename: string; buffer: Buffer }

function env(name: string): string {
  return process.env[name]?.trim() ?? ''
}

function supabaseUrl(): string {
  return (env('VITE_SUPABASE_URL') || env('SUPABASE_URL')).replace(/\/$/, '')
}

function viewerOrigin(): string {
  return env('VITE_PUBLIC_ORIGIN').replace(/\/$/, '')
}

function admin(): SupabaseClient {
  const url = supabaseUrl()
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('Add SUPABASE_SERVICE_ROLE_KEY to webview/.env. It stays on this computer.')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function viewerLink(id: string): string {
  const origin = viewerOrigin()
  if (!origin) {
    throw new Error('Set VITE_PUBLIC_ORIGIN in webview/.env to your GitHub Pages address.')
  }
  return `${origin}/#/v/${id}`
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function readForm(req: IncomingMessage): Promise<{ fields: Record<string, string>; files: Upload[] }> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {}
    const files: Upload[] = []
    const busboy = Busboy({
      headers: req.headers,
      limits: { files: 40, fileSize: 80 * 1024 * 1024 },
    })
    busboy.on('field', (name, value) => {
      fields[name] = value
    })
    busboy.on('file', (_name, stream, info) => {
      const chunks: Buffer[] = []
      let tooBig = false
      stream.on('limit', () => {
        tooBig = true
      })
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => {
        if (!tooBig && info.filename) files.push({ filename: info.filename, buffer: Buffer.concat(chunks) })
      })
    })
    busboy.on('error', reject)
    busboy.on('finish', () => resolve({ fields, files }))
    req.pipe(busboy)
  })
}

async function signCaseFolder(client: SupabaseClient, folder: string, hours: number) {
  const { data, error } = await client.storage.from(BUCKET).list(folder, { limit: 100 })
  if (error) throw new Error(error.message)
  const paths = (data ?? [])
    .filter((item) => item.id && item.name && isMeshFile(item.name))
    .map((item) => `${folder}/${item.name}`)
  if (!paths.length) throw new Error('This case folder has no STL, PLY, or OBJ files.')
  const expiresIn = Math.max(60, Math.round(hours * 3600))
  const { data: signed, error: signError } = await client.storage.from(BUCKET).createSignedUrls(paths, expiresIn)
  if (signError) throw new Error(signError.message)
  return (signed ?? []).map((item) => {
    if (item.error || !item.signedUrl) throw new Error(item.error || 'Could not sign a case file.')
    const filename = item.path?.split('/').pop() || 'mesh'
    return { name: displayName(filename), url: item.signedUrl }
  })
}

async function createLink(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const client = admin()
  const { fields, files } = await readForm(req)
  const folder = caseFolderName(fields.caseName || '')
  if (!folder) throw new Error('Name the case folder.')
  const typed = (fields.pin || '').trim()
  if (typed && !/^\d{4}$/.test(typed)) throw new Error('Use a 4-digit PIN, or leave it blank to generate one.')
  const pin = typed || randomPin()
  const hours = Number(fields.hours || '168')
  if (!Number.isFinite(hours) || hours <= 0) throw new Error('Pick how long the link lasts.')

  const used = new Set<string>()
  for (const file of files) {
    if (!isMeshFile(file.filename)) continue
    const storedName = uniqueFileName(file.filename, used)
    const path = `${folder}/${storedName}`
    const { error } = await client.storage.from(BUCKET).upload(path, file.buffer, {
      contentType: 'application/octet-stream',
      upsert: true,
    })
    if (error) throw new Error(error.message)
  }

  const signed = await signCaseFolder(client, folder, hours)
  const sealed = await sealShare(pin, { v: 1, title: folder, files: signed })
  const shareId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + hours * HOUR_MS).toISOString()
  const { error } = await client.from('shares').insert({
    id: shareId,
    title: folder,
    salt: sealed.salt,
    iv: sealed.iv,
    ciphertext: sealed.ciphertext,
    expires_at: expiresAt,
  })
  if (error) {
    const hint = /owner_id|not-null|violates/.test(error.message)
      ? ' Open supabase/schema.sql, copy it, and run it again in the Supabase SQL editor.'
      : ''
    throw new Error(`${error.message}${hint}`)
  }
  send(res, 200, { pin, link: viewerLink(shareId), expiresAt, fileCount: signed.length })
}

export async function handleLocalApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (!url.pathname.startsWith('/api/')) return false

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const missing = [
        !supabaseUrl() ? 'VITE_SUPABASE_URL' : '',
        !env('VITE_SUPABASE_ANON_KEY') ? 'VITE_SUPABASE_ANON_KEY' : '',
        !env('SUPABASE_SERVICE_ROLE_KEY') ? 'SUPABASE_SERVICE_ROLE_KEY' : '',
        !viewerOrigin() ? 'VITE_PUBLIC_ORIGIN' : '',
      ].filter(Boolean)
      send(res, 200, { ok: missing.length === 0, missing, publicOrigin: viewerOrigin() })
      return true
    }

    if (req.method === 'GET' && url.pathname === '/api/shares') {
      const client = admin()
      const { data, error } = await client
        .from('shares')
        .select('id, title, expires_at, created_at, failed_attempts, locked_until')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      send(res, 200, { shares: data ?? [] })
      return true
    }

    if (req.method === 'POST' && url.pathname === '/api/revoke') {
      const body = (await readJson(req)) as { id?: string }
      if (!body.id) throw new Error('Missing link id.')
      const client = admin()
      const { error } = await client.from('shares').delete().eq('id', body.id)
      if (error) throw new Error(error.message)
      send(res, 200, { ok: true })
      return true
    }

    if (req.method === 'POST' && url.pathname === '/api/create-link') {
      await createLink(req, res)
      return true
    }

    send(res, 404, { error: 'Unknown request.' })
  } catch (error) {
    send(res, 400, { error: error instanceof Error ? error.message : 'The link could not be created.' })
  }
  return true
}
