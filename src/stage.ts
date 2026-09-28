import { clear, el } from './dom'
import { ModelViewer, type MeshInfo, type ProjectionMode, type ShadingMode, type SurfaceMode, type UpAxis, type ViewName } from './viewer'

export type StageFile = { name: string; buffer: ArrayBuffer }

export type StageSource = { kind: 'sample' } | { kind: 'files'; files: StageFile[] }

export function mountStage(
  root: HTMLElement,
  opts: { title: string; source: StageSource; onClose?: () => void },
): () => void {
  clear(root)
  document.body.className = 'mode-view'

  const canvas = el('canvas')
  const objectsBtn = el('button', { class: 'chip objects-btn', type: 'button' }, ['Objects'])
  const settingsBtn = el('button', { class: 'chip', type: 'button' }, ['Settings'])
  const title = el('div', { class: 'title' }, [opts.title || 'Case'])
  const closeBtn = opts.onClose ? el('button', { class: 'chip close-btn', type: 'button' }, ['Close']) : null
  const topLeft = el('div', { class: 'top-left' }, closeBtn ? [closeBtn, objectsBtn] : [objectsBtn])
  const topbar = el('header', { class: 'topbar' }, [topLeft, title, settingsBtn])

  const list = el('div', { class: 'obj-list' })
  const master = el('input', { type: 'checkbox', class: 'master-check' })
  master.checked = true
  const panel = el('aside', { class: 'sheet objects' }, [
    el('div', { class: 'grabber' }),
    el('div', { class: 'sheet-head' }, [
      el('label', { class: 'master' }, [master, 'All objects']),
      el('h2', {}, ['Objects']),
    ]),
    list,
  ])

  const shading = selectField([
    ['smooth', 'Smooth'],
    ['flat', 'Flat'],
  ])
  const surface = selectField([
    ['solid', 'Solid color'],
    ['vertex', 'Vertex color'],
  ])
  const projection = selectField([
    ['ortho', 'Orthographic'],
    ['perspective', 'Perspective'],
  ])
  const upAxis = selectField([
    ['z', 'Z up (dental)'],
    ['y', 'Y up'],
  ])
  const background = selectField([
    ['light', 'Light'],
    ['dark', 'Dark'],
  ])
  const settings = el('aside', { class: 'sheet settings' }, [
    el('div', { class: 'grabber' }),
    el('h2', {}, ['Settings']),
    labeled('Shading', shading),
    labeled('Surface', surface),
    labeled('Projection', projection),
    labeled('Up axis', upAxis),
    labeled('Background', background),
    el('p', { class: 'hint' }, ['Press and hold the model to set the rotation point.']),
  ])

  const backdrop = el('button', { class: 'backdrop', type: 'button', 'aria-label': 'Close panel' })
  backdrop.hidden = true
  const toast = el('div', { class: 'toast' })
  toast.hidden = true
  const loading = el('div', { class: 'loading' }, [el('p', {}, ['Loading meshes…'])])

  const viewpad = el('div', { class: 'viewpad', role: 'group', 'aria-label': 'Standard views' }, [
    viewButton('top', 'Top view', '⌃'),
    el('div', { class: 'row' }, [
      viewButton('left', 'Left view', '‹'),
      viewButton('front', 'Front view', 'Front'),
      viewButton('right', 'Right view', '›'),
    ]),
    viewButton('bottom', 'Bottom view', '⌄'),
    el('div', { class: 'row' }, [viewButton('back', 'Back view', 'Back'), viewButton('default', 'Default view', 'Default')]),
  ])

  const stage = el('div', { class: 'stage' }, [canvas, topbar, backdrop, panel, settings, viewpad, loading, toast])
  root.append(stage)

  let toastTimer = 0
  const showToast = (text: string) => {
    toast.textContent = text
    toast.hidden = false
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      toast.hidden = true
    }, 1600)
  }

  const viewer = new ModelViewer(canvas, { onPivot: () => showToast('Rotation point set') })

  const mobileQuery = matchMedia('(max-width: 800px)')
  const syncBackdrop = () => {
    const sheetOpen = panel.classList.contains('open') || settings.classList.contains('open')
    backdrop.hidden = !(mobileQuery.matches && sheetOpen) && !(settings.classList.contains('open') && !mobileQuery.matches)
    stage.classList.toggle('sheet-open', mobileQuery.matches && sheetOpen)
  }
  const closeSheets = () => {
    panel.classList.remove('open')
    settings.classList.remove('open')
    syncBackdrop()
  }

  objectsBtn.addEventListener('click', () => {
    const open = panel.classList.toggle('open')
    if (open) settings.classList.remove('open')
    syncBackdrop()
  })
  settingsBtn.addEventListener('click', () => {
    const open = settings.classList.toggle('open')
    if (open && mobileQuery.matches) panel.classList.remove('open')
    syncBackdrop()
  })
  backdrop.addEventListener('click', closeSheets)
  closeBtn?.addEventListener('click', () => opts.onClose?.())
  const onLayout = () => {
    if (!mobileQuery.matches) panel.classList.remove('open')
    syncBackdrop()
  }
  mobileQuery.addEventListener('change', onLayout)

  const renderList = () => {
    const meshes = viewer.getMeshes()
    objectsBtn.textContent = meshes.length ? `Objects (${meshes.length})` : 'Objects'
    list.replaceChildren()
    if (!meshes.length) {
      list.append(el('p', { class: 'hint' }, ['No meshes loaded.']))
      return
    }
    for (const info of meshes) list.append(objectRow(info))
    syncMaster()
  }

  const syncMaster = () => {
    const boxes = [...list.querySelectorAll<HTMLInputElement>('.obj-check')]
    const on = boxes.filter((box) => box.checked).length
    master.checked = boxes.length > 0 && on === boxes.length
    master.indeterminate = on > 0 && on < boxes.length
  }

  const objectRow = (info: MeshInfo) => {
    const box = el('input', { type: 'checkbox', class: 'obj-check' })
    box.checked = info.visible
    box.addEventListener('change', () => {
      viewer.setVisible(info.id, box.checked)
      syncMaster()
    })
    const name = el('span', { class: 'obj-name' }, [info.name])
    const meshBtn = el('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': `View ${info.name} as mesh`,
      'aria-pressed': info.wireframe ? 'true' : 'false',
      title: 'Mesh',
    })
    meshBtn.append(meshIcon())
    meshBtn.addEventListener('click', () => {
      const next = meshBtn.getAttribute('aria-pressed') !== 'true'
      meshBtn.setAttribute('aria-pressed', next ? 'true' : 'false')
      viewer.setWireframe(info.id, next)
    })
    const slider = opacitySlider(info.name, info.transparency, (transparency) => {
      viewer.setTransparency(info.id, transparency)
    })
    const swatch = el('span', { class: 'swatch' })
    swatch.style.background = info.color
    return el('div', { class: 'obj' }, [
      el('div', { class: 'obj-row' }, [el('label', { class: 'obj-label' }, [box, swatch, name]), meshBtn]),
      slider,
    ])
  }

  master.addEventListener('change', () => {
    viewer.setAllVisible(master.checked)
    for (const box of list.querySelectorAll<HTMLInputElement>('.obj-check')) box.checked = master.checked
    master.indeterminate = false
  })

  shading.addEventListener('change', () => viewer.setShading(shading.value as ShadingMode))
  surface.addEventListener('change', () => {
    viewer.setSurface(surface.value as SurfaceMode)
    if (surface.value === 'vertex' && !viewer.hasVertexColors) showToast('These files have no vertex colors')
  })
  projection.addEventListener('change', () => viewer.setProjection(projection.value as ProjectionMode))
  upAxis.addEventListener('change', () => viewer.setUpAxis(upAxis.value as UpAxis))
  background.addEventListener('change', () => viewer.setBackground(background.value as 'light' | 'dark'))

  viewpad.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-view]')
    if (!button) return
    viewer.setView(button.dataset.view as ViewName)
  })

  if (opts.source.kind === 'sample') {
    viewer.setSample()
    loading.remove()
  } else {
    const result = viewer.setFiles(opts.source.files)
    loading.remove()
    if (!result.loaded.length) {
      const fail = el('div', { class: 'loading' }, [el('p', {}, ['These files could not be read as STL, PLY, or OBJ.'])])
      stage.append(fail)
    } else if (result.failed.length) {
      showToast(`Skipped ${result.failed.join(', ')}`)
    }
  }
  renderList()

  return () => {
    window.clearTimeout(toastTimer)
    mobileQuery.removeEventListener('change', onLayout)
    viewer.dispose()
  }
}

function opacitySlider(name: string, transparency: number, onChange: (transparency: number) => void): HTMLElement {
  const line = el('span', { class: 'opacity-line' })
  const fill = el('span', { class: 'opacity-fill' })
  const thumb = el('span', { class: 'opacity-thumb' })
  const track = el(
    'div',
    {
      class: 'opacity',
      role: 'slider',
      tabindex: '0',
      'aria-label': `${name} opacity`,
      'aria-valuemin': '0',
      'aria-valuemax': '100',
    },
    [line, fill, thumb],
  )
  const paint = (opacity: number, emit: boolean) => {
    const next = Math.min(100, Math.max(0, Math.round(opacity)))
    fill.style.width = `${next}%`
    thumb.style.left = `${next}%`
    track.setAttribute('aria-valuenow', String(next))
    if (emit) onChange(1 - next / 100)
  }
  paint(Math.round((1 - transparency) * 100), false)

  let pointer = -1
  let originX = 0
  let originY = 0
  let dragging = false
  const valueAt = (clientX: number) => {
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return 100
    return ((clientX - rect.left) / rect.width) * 100
  }
  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointer = event.pointerId
    originX = event.clientX
    originY = event.clientY
    dragging = false
  })
  track.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer) return
    const dx = event.clientX - originX
    const dy = event.clientY - originY
    if (!dragging) {
      if (Math.hypot(dx, dy) < 8) return
      if (Math.abs(dy) > Math.abs(dx)) {
        pointer = -1
        return
      }
      dragging = true
      track.setPointerCapture(event.pointerId)
    }
    paint(valueAt(event.clientX), true)
  })
  track.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointer) return
    const dx = event.clientX - originX
    const dy = event.clientY - originY
    if (!dragging && Math.abs(dy) <= Math.abs(dx) && Math.hypot(dx, dy) < 8) paint(valueAt(event.clientX), true)
    pointer = -1
    dragging = false
  })
  track.addEventListener('pointercancel', () => {
    pointer = -1
    dragging = false
  })
  track.addEventListener('keydown', (event) => {
    const current = Number(track.getAttribute('aria-valuenow') || '100')
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      paint(current + 5, true)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      paint(current - 5, true)
    }
  })
  return track
}

function labeled(text: string, control: HTMLElement): HTMLLabelElement {
  return el('label', { class: 'field' }, [el('span', {}, [text]), control])
}

function selectField(options: Array<[string, string]>): HTMLSelectElement {
  const select = el('select')
  for (const [value, label] of options) {
    const option = el('option', { value }, [label])
    select.append(option)
  }
  return select
}

function viewButton(view: ViewName, label: string, text: string): HTMLButtonElement {
  return el('button', { type: 'button', 'data-view': view, 'aria-label': label, title: label }, [text])
}

function meshIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M4 18 12 4l8 14H4Zm8-14v14M8.2 12.2h7.6')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.6')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
}
