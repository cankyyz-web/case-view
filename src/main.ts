import './style.css'
import { el } from './dom'
import { mountWatch } from './watch'

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('Missing #app')

let cleanup = () => {}

function route(): { kind: 'watch'; token: string } | { kind: 'studio' } {
  const hash = location.hash.replace(/^#/, '')
  const match = hash.match(/^\/v\/([A-Za-z0-9][A-Za-z0-9._-]{0,79})$/)
  if (match) return { kind: 'watch', token: match[1] }
  return { kind: 'studio' }
}

async function render(): Promise<void> {
  cleanup()
  const next = route()
  document.title = next.kind === 'watch' ? 'Enter PIN · Case View' : 'Case View'
  if (next.kind === 'watch') {
    cleanup = mountWatch(app!, next.token)
    return
  }
  if (import.meta.env.DEV) {
    const { mountStudio } = await import('./studio')
    cleanup = mountStudio(app!)
    return
  }
  cleanup = mountPublicHome(app!)
}

function mountPublicHome(root: HTMLElement): () => void {
  root.replaceChildren(
    el('main', { class: 'gate' }, [
      el('section', { class: 'gate-card' }, [
        el('p', { class: 'eyebrow' }, ['Case View']),
        el('h1', {}, ['Open your link']),
        el('p', { class: 'hint' }, ['The address you were sent opens the case after the PIN. This page on its own has no files.']),
      ]),
    ]),
  )
  document.body.className = 'mode-gate'
  return () => {}
}

window.addEventListener('hashchange', render)
render()
