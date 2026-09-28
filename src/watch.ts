import { mountGate } from './gate'
import { verifyPin, type Grant } from './share'
import { mountStage, type StageFile } from './stage'

export function mountWatch(root: HTMLElement, token: string): () => void {
  let disposed = false
  let gate = mountGate(root, async (pin) => {
    const result = await verifyPin(token, pin)
    if (disposed) return
    if (!result.ok) {
      gate.setMessage(messageFor(result.reason, result.retryAt))
      gate.reset()
      return
    }
    gate.setMessage('Opening case…', 'info')
    try {
      const files = await downloadGrant(result.grant, (text) => {
        if (!disposed) gate.setMessage(text, 'info')
      })
      if (disposed) return
      gate.destroy()
      stageCleanup = mountStage(root, { title: result.grant.title, source: { kind: 'files', files } })
    } catch {
      if (disposed) return
      gate.setMessage('The files could not be downloaded. Check the connection and try the PIN again.')
      gate.reset()
    }
  })
  let stageCleanup = () => {}

  return () => {
    disposed = true
    gate.destroy()
    stageCleanup()
  }
}

function messageFor(reason: string, retryAt?: string): string {
  if (reason === 'expired') return 'This link has expired.'
  if (reason === 'missing') return 'This link is not valid.'
  if (reason === 'config') return 'This viewer is not connected to storage yet.'
  if (reason === 'network') return 'The PIN could not be checked. Try again.'
  if (reason === 'locked') {
    if (!retryAt) return 'Too many attempts. Try again later.'
    const when = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(retryAt))
    return `Too many attempts. Try again after ${when}.`
  }
  return 'Incorrect PIN.'
}

async function downloadGrant(grant: Grant, onStatus: (text: string) => void): Promise<StageFile[]> {
  const files: StageFile[] = []
  for (let index = 0; index < grant.files.length; index += 1) {
    const file = grant.files[index]
    if (!/^https?:\/\//i.test(file.url)) throw new Error('Bad file URL')
    onStatus(`Loading ${index + 1} of ${grant.files.length} · ${file.name}`)
    const response = await fetch(file.url)
    if (!response.ok) throw new Error(`Download failed (${response.status})`)
    const total = Number(response.headers.get('content-length')) || 0
    if (!response.body) {
      files.push({ name: file.name, buffer: await response.arrayBuffer() })
      continue
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0
    while (true) {
      const step = await reader.read()
      if (step.done) break
      chunks.push(step.value)
      loaded += step.value.byteLength
      const pct = total ? ` ${Math.round((100 * loaded) / total)}%` : ''
      onStatus(`Loading ${index + 1} of ${grant.files.length} · ${file.name}${pct}`)
    }
    const buffer = new Uint8Array(loaded)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.byteLength
    }
    files.push({ name: file.name, buffer: buffer.buffer })
  }
  return files
}
