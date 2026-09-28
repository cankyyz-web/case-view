import { clear, el } from './dom'
import { displayName, formatBytes, isMeshFile } from './names'
import { randomPin } from '../supabase/functions/_shared/encrypter'
import type { ShareRecord } from './share'
import { mountStage, type StageSource } from './stage'

type DraftFile = { id: string; file: File }

const draft: { files: DraftFile[]; caseName: string; pin: string; hours: string } = {
  files: [],
  caseName: '',
  pin: '',
  hours: '168',
}

let previewSource: StageSource | null = null
let issued: { pin: string; link: string; expiresAt: string; fileCount: number } | null = null
const MAX_BYTES = 80 * 1024 * 1024

export function mountStudio(root: HTMLElement): () => void {
  if (location.hash === '#/preview') {
    if (!previewSource) {
      history.replaceState(null, '', `${location.pathname}${location.search}`)
    } else {
      const source = previewSource
      const title = draft.caseName.trim() || 'Preview'
      return mountStage(root, {
        title,
        source,
        onClose: () => {
          previewSource = null
          location.hash = '#/'
        },
      })
    }
  }

  clear(root)
  document.body.className = 'mode-studio'
  const page = el('main', { class: 'studio' })
  root.append(page)
  let dead = false

  const paintShares = async () => {
    const host = page.querySelector<HTMLElement>('#shares')
    if (!host || dead) return
    host.replaceChildren(el('p', { class: 'muted' }, ['Loading links…']))
    try {
      const response = await fetch('/api/shares')
      const body = (await response.json()) as { shares?: ShareRecord[]; error?: string }
      if (!response.ok) throw new Error(body.error || 'Could not load links.')
      if (dead) return
      host.replaceChildren()
      const rows = body.shares ?? []
      if (!rows.length) {
        host.append(el('p', { class: 'muted' }, ['No links yet.']))
        return
      }
      for (const row of rows) host.append(shareRow(row, paintShares))
    } catch (error) {
      if (dead) return
      host.replaceChildren(el('p', { class: 'error' }, [error instanceof Error ? error.message : 'Could not load links.']))
    }
  }

  const paint = () => {
    page.replaceChildren()
    page.append(header(), filesCard(), shareCard(paintShares))
    void paintShares()
    void fetch('/api/health')
      .then((response) => response.json())
      .then((body: { ok?: boolean; missing?: string[] }) => {
        if (dead || body.ok || !body.missing?.length) return
        page.prepend(
          el('section', { class: 'card' }, [
            el('h2', {}, ['Finish setup']),
            el('p', { class: 'error' }, [`Add these to webview/.env, then restart run.bat: ${body.missing.join(', ')}`]),
          ]),
        )
      })
      .catch(() => {})
  }
  paint()
  return () => {
    dead = true
  }
}

function header(): HTMLElement {
  return el('header', { class: 'studio-head' }, [
    el('p', { class: 'eyebrow' }, ['Case View']),
    el('h1', {}, ['Share a 3D case']),
    el('p', { class: 'hint' }, [
      'This page stays on your computer. The link it makes is the GitHub page, and that case link stops working when the time you pick runs out.',
    ]),
  ])
}

function filesCard(): HTMLElement {
  const list = el('div', { class: 'stack', id: 'file-list' })
  const note = el('p', { class: 'error' })
  const fileInput = el('input', { type: 'file', accept: '.stl,.ply,.obj', multiple: 'true' })
  fileInput.hidden = true
  const folderInput = el('input', { type: 'file', multiple: 'true' })
  folderInput.multiple = true
  folderInput.setAttribute('webkitdirectory', '')
  folderInput.hidden = true

  const drop = el('div', { class: 'drop' }, [
    el('strong', {}, ['Drop meshes here']),
    el('p', { class: 'hint' }, ['STL, PLY, and OBJ. Chosen files show up in the list, then upload when you create the link.']),
    el('div', { class: 'row-actions' }, [
      el('button', { class: 'ghost', type: 'button', id: 'browse' }, ['Add files']),
      el('button', { class: 'ghost', type: 'button', id: 'folder' }, ['Add folder']),
    ]),
  ])

  const renderFiles = () => {
    list.replaceChildren()
    if (!draft.files.length) {
      list.append(el('p', { class: 'muted' }, ['No files yet.']))
      return
    }
    for (const item of draft.files) {
      const remove = el('button', { class: 'ghost', type: 'button' }, ['Remove'])
      remove.addEventListener('click', () => {
        draft.files = draft.files.filter((file) => file.id !== item.id)
        renderFiles()
      })
      list.append(
        el('div', { class: 'file-row' }, [
          el('span', {}, [`${displayName(item.file.name)} · ${formatBytes(item.file.size)}`]),
          remove,
        ]),
      )
    }
  }

  const addFiles = (incoming: Iterable<File>) => {
    const skipped: string[] = []
    for (const file of incoming) {
      if (!isMeshFile(file.name)) continue
      if (file.size > MAX_BYTES) {
        skipped.push(file.name)
        continue
      }
      draft.files.push({ id: crypto.randomUUID(), file })
    }
    if (!draft.caseName) {
      const fromFolder = [...incoming].find((file) => file.webkitRelativePath.includes('/'))
      const folder = fromFolder?.webkitRelativePath.split('/')[0]
      if (folder) draft.caseName = folder
    }
    note.textContent = skipped.length ? `${skipped.join(', ')} is over 80 MB.` : ''
    renderFiles()
    const caseInput = document.querySelector<HTMLInputElement>('#case-folder')
    if (caseInput && !caseInput.value && draft.caseName) caseInput.value = draft.caseName
  }

  drop.addEventListener('dragover', (event) => {
    event.preventDefault()
    drop.classList.add('over')
  })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', (event) => {
    event.preventDefault()
    drop.classList.remove('over')
    addFiles(event.dataTransfer?.files ?? [])
  })
  drop.querySelector('#browse')?.addEventListener('click', () => fileInput.click())
  drop.querySelector('#folder')?.addEventListener('click', () => folderInput.click())
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files ?? [])
    fileInput.value = ''
  })
  folderInput.addEventListener('change', () => {
    addFiles(folderInput.files ?? [])
    folderInput.value = ''
  })

  const preview = el('button', { class: 'ghost', type: 'button' }, ['Preview files'])
  const sample = el('button', { class: 'ghost', type: 'button' }, ['Preview sample'])
  preview.addEventListener('click', () => void openPreview())
  sample.addEventListener('click', () => {
    previewSource = { kind: 'sample' }
    location.hash = '#/preview'
  })

  renderFiles()
  return el('section', { class: 'card' }, [
    el('h2', {}, ['Files']),
    drop,
    fileInput,
    folderInput,
    list,
    note,
    el('div', { class: 'row-actions' }, [preview, sample]),
  ])
}

async function openPreview(): Promise<void> {
  if (!draft.files.length) return
  const files = []
  for (const item of draft.files) {
    files.push({ name: item.file.name, buffer: await item.file.arrayBuffer() })
  }
  previewSource = { kind: 'files', files }
  location.hash = '#/preview'
}

function shareCard(refreshShares: () => Promise<void>): HTMLElement {
  const caseName = el('input', { id: 'case-folder', type: 'text', maxlength: '80', placeholder: 'Case folder' })
  caseName.value = draft.caseName
  caseName.addEventListener('input', () => {
    draft.caseName = caseName.value
  })
  const pin = el('input', {
    id: 'pin',
    type: 'text',
    inputmode: 'numeric',
    maxlength: '4',
    placeholder: '4-digit PIN',
    autocomplete: 'off',
  })
  pin.value = draft.pin
  pin.addEventListener('input', () => {
    pin.value = pin.value.replace(/\D/g, '').slice(0, 4)
    draft.pin = pin.value
  })
  const generate = el('button', { class: 'ghost', type: 'button' }, ['Generate'])
  generate.addEventListener('click', () => {
    draft.pin = randomPin()
    pin.value = draft.pin
  })
  const expiry = el('select', { id: 'expiry' })
  for (const [value, label] of [
    ['1', '1 hour'],
    ['24', '24 hours'],
    ['168', '7 days'],
    ['720', '30 days'],
  ] as const) {
    expiry.append(el('option', { value }, [label]))
  }
  expiry.value = draft.hours
  expiry.addEventListener('change', () => {
    draft.hours = expiry.value
  })
  const status = el('p', { class: 'muted' })
  const result = el('div', { class: 'stack' })
  if (issued) result.append(resultCard(issued.pin, issued.link, issued.expiresAt, issued.fileCount))
  const button = el('button', { class: 'primary', type: 'button' }, ['Create link'])
  const shares = el('div', { class: 'stack', id: 'shares' })

  button.addEventListener('click', async () => {
    status.className = 'muted'
    result.replaceChildren()
    if (!caseName.value.trim()) {
      status.className = 'error'
      status.textContent = 'Name the case folder.'
      return
    }
    button.disabled = true
    status.className = 'muted'
    status.textContent = draft.files.length ? 'Uploading files and sealing the link…' : 'Signing the files already in this case folder…'
    try {
      const body = new FormData()
      body.set('caseName', caseName.value)
      body.set('pin', pin.value)
      body.set('hours', expiry.value)
      for (const item of draft.files) body.append('files', item.file, item.file.name)
      const response = await fetch('/api/create-link', { method: 'POST', body })
      const created = (await response.json()) as {
        pin?: string
        link?: string
        expiresAt?: string
        fileCount?: number
        error?: string
      }
      if (!response.ok || !created.link || !created.pin || !created.expiresAt) {
        throw new Error(created.error || 'The link could not be created.')
      }
      const ready = {
        pin: created.pin,
        link: created.link,
        expiresAt: created.expiresAt,
        fileCount: created.fileCount || 0,
      }
      status.textContent = ''
      draft.pin = ready.pin
      pin.value = ready.pin
      issued = ready
      result.append(resultCard(ready.pin, ready.link, ready.expiresAt, ready.fileCount))
      await refreshShares()
    } catch (error) {
      status.className = 'error'
      status.textContent = error instanceof Error ? error.message : 'The link could not be created.'
    } finally {
      button.disabled = false
    }
  })

  return el('section', { class: 'stack' }, [
    el('section', { class: 'card' }, [
      el('h2', {}, ['Link']),
      el('p', { class: 'hint' }, ['Type a PIN or generate one. Leave it blank and a code is made when the link is created.']),
      caseName,
      el('div', { class: 'copy-row' }, [pin, generate]),
      expiry,
      button,
      status,
      result,
    ]),
    el('section', { class: 'card' }, [el('h2', {}, ['Links']), shares]),
  ])
}

function resultCard(pin: string, link: string, expiresAt: string, fileCount: number): HTMLElement {
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(expiresAt))
  return el('div', { class: 'stack' }, [
    el('p', { class: 'hint' }, [`PIN ${pin}. It is not stored.`]),
    el('div', { class: 'pin-code' }, [pin]),
    copyRow('Copy link', link),
    el('p', { class: 'muted' }, [
      `${fileCount} file${fileCount === 1 ? '' : 's'} in this link. It stops opening the files at ${when}.`,
    ]),
  ])
}

function copyRow(label: string, value: string): HTMLElement {
  const input = el('input', { readonly: 'true' })
  input.value = value
  const button = el('button', { class: 'ghost', type: 'button' }, [label])
  button.addEventListener('click', async () => {
    input.select()
    try {
      await navigator.clipboard.writeText(value)
      button.textContent = 'Copied'
    } catch {
      button.textContent = 'Select the text'
    }
    window.setTimeout(() => {
      button.textContent = label
    }, 1400)
  })
  return el('div', { class: 'copy-row' }, [input, button])
}

function shareRow(row: ShareRecord, onChange: () => Promise<void>): HTMLElement {
  const expiry = new Date(row.expires_at)
  const expired = expiry.getTime() <= Date.now()
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(expiry)
  const revoke = el('button', { class: 'danger', type: 'button' }, ['Revoke'])
  revoke.addEventListener('click', async () => {
    if (!confirm('Revoke this link? The case files stay in the bucket.')) return
    revoke.disabled = true
    try {
      const response = await fetch('/api/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error || 'Could not revoke the link.')
      await onChange()
      revoke.closest('.share-row')?.remove()
    } catch (error) {
      revoke.disabled = false
      alert(error instanceof Error ? error.message : 'Could not revoke the link.')
    }
  })
  return el('div', { class: 'share-row' }, [
    el('span', {}, [`${row.title || 'Case'} · ${expired ? 'Expired' : 'Expires'} ${when}`]),
    revoke,
  ])
}
