import { clear, el } from './dom'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back']

export type GateController = {
  setMessage: (message: string, kind?: 'error' | 'info') => void
  reset: () => void
  destroy: () => void
}

export function mountGate(root: HTMLElement, onSubmit: (pin: string) => Promise<void>): GateController {
  clear(root)
  document.body.className = 'mode-gate'

  const dots = el('div', { class: 'dots', 'aria-label': 'PIN progress' }, [
    el('span'),
    el('span'),
    el('span'),
    el('span'),
  ])
  const message = el('p', { class: 'gate-message', role: 'alert' })
  const pad = el('div', { class: 'pad' })
  const card = el('form', { class: 'gate-card' }, [
    el('p', { class: 'eyebrow' }, ['Case View']),
    el('h1', {}, ['Enter PIN']),
    el('p', { class: 'hint' }, ['Four digits from the person who sent this link.']),
    dots,
    message,
    pad,
  ])
  root.append(el('main', { class: 'gate' }, [card]))

  let pin = ''
  let busy = false
  const marks = [...dots.querySelectorAll('span')]

  const paint = () => {
    marks.forEach((mark, index) => mark.classList.toggle('filled', index < pin.length))
  }

  const setBusy = (value: boolean) => {
    busy = value
    for (const button of pad.querySelectorAll('button')) button.disabled = value
  }

  const push = (digit: string) => {
    if (busy || pin.length >= 4) return
    pin += digit
    paint()
    if (pin.length === 4) void submit()
  }

  const pop = () => {
    if (busy || !pin) return
    pin = pin.slice(0, -1)
    paint()
  }

  async function submit(): Promise<void> {
    if (busy || pin.length !== 4) return
    const current = pin
    setBusy(true)
    message.textContent = 'Checking PIN…'
    message.className = 'gate-message info'
    try {
      await onSubmit(current)
    } finally {
      setBusy(false)
    }
  }

  for (const key of KEYS) {
    if (!key) {
      pad.append(el('span'))
      continue
    }
    const button = el('button', { type: 'button', 'aria-label': key === 'back' ? 'Backspace' : key }, [
      key === 'back' ? '←' : key,
    ])
    button.addEventListener('click', () => {
      navigator.vibrate?.(10)
      if (key === 'back') pop()
      else push(key)
    })
    pad.append(button)
  }

  card.addEventListener('submit', (event) => {
    event.preventDefault()
    void submit()
  })

  const onKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (/^\d$/.test(event.key)) {
      event.preventDefault()
      push(event.key)
    } else if (event.key === 'Backspace') {
      event.preventDefault()
      pop()
    }
  }
  const onPaste = (event: ClipboardEvent) => {
    const digits = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 4) ?? ''
    if (digits.length !== 4) return
    event.preventDefault()
    pin = digits
    paint()
    void submit()
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('paste', onPaste)

  return {
    setMessage(text, kind = 'error') {
      message.textContent = text
      message.className = `gate-message ${kind}`
      if (kind === 'error') {
        navigator.vibrate?.(40)
        dots.classList.remove('shake')
        void dots.offsetWidth
        dots.classList.add('shake')
      }
    },
    reset() {
      pin = ''
      paint()
    },
    destroy() {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    },
  }
}
