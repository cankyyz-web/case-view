import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { colorCss, colorForName, displayName, isCompanionFile, isMeshFile, sanitizeFileName } from './names'
import { buildSample } from './sample'

export type ViewName = 'default' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
export type ShadingMode = 'smooth' | 'flat'
export type SurfaceMode = 'solid' | 'vertex'
export type ProjectionMode = 'perspective' | 'ortho'
export type UpAxis = 'z' | 'y'

export type MeshInfo = {
  id: string
  name: string
  visible: boolean
  transparency: number
  wireframe: boolean
  color: string
}

type Entry = {
  id: string
  name: string
  color: number
  hasColors: boolean
  visible: boolean
  transparency: number
  wireframe: boolean
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
  map: THREE.Texture | null
}

const VIEW_DIRS: Record<Exclude<ViewName, 'default'>, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
}

const HOME_DIR = new THREE.Vector3(0.62, 0.38, 0.68).normalize()

export class ModelViewer {
  readonly canvas: HTMLCanvasElement
  hasVertexColors = false

  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private persp = new THREE.PerspectiveCamera(32, 1, 0.1, 5000)
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000)
  private camera: THREE.Camera
  private controls: OrbitControls
  private root = new THREE.Group()
  private key = new THREE.DirectionalLight(0xffffff, 1.25)
  private entries: Entry[] = []
  private blobUrls: string[] = []
  private shading: ShadingMode = 'smooth'
  private surface: SurfaceMode = 'solid'
  private projection: ProjectionMode = 'perspective'
  private upAxis: UpAxis = 'z'
  private background: 'light' | 'dark' = 'light'
  private frame = 0
  private observer: ResizeObserver
  private radius = 50
  private distance = 180
  private half = 80
  private anim: {
    p0: THREE.Vector3
    p1: THREE.Vector3
    t0: THREE.Vector3
    t1: THREE.Vector3
    start: number
    dur: number
  } | null = null
  private hold: { id: number; x: number; y: number; t: number; pos: THREE.Vector3; target: THREE.Vector3 } | null = null
  private pointers = new Set<number>()
  private pivot = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x2a62d6, transparent: true, opacity: 0.9, depthTest: false }),
  )
  private pivotLife = 0
  private onPivot?: () => void
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  private disposed = false
  private tmp = new THREE.Vector3()
  private center = new THREE.Vector3()

  constructor(canvas: HTMLCanvasElement, opts?: { onPivot?: () => void }) {
    this.canvas = canvas
    this.onPivot = opts?.onPivot
    const coarse = matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2))
    this.applyBackground()

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb7b1a8, 0.72))
    this.key.target.position.set(0, 0, 0)
    this.scene.add(this.key)
    this.scene.add(this.key.target)
    this.scene.add(this.root)
    this.pivot.visible = false
    this.pivot.renderOrder = 10
    this.scene.add(this.pivot)

    this.camera = this.persp
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.rotateSpeed = coarse ? 0.72 : 0.95
    this.controls.zoomSpeed = coarse ? 0.75 : 0.9
    this.controls.screenSpacePanning = true
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    }

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)

    this.observer = new ResizeObserver(() => this.resize())
    if (canvas.parentElement) this.observer.observe(canvas.parentElement)
    this.resize()
    this.frame = requestAnimationFrame(this.loop)
  }

  setFiles(files: Array<{ name: string; buffer: ArrayBuffer }>): { loaded: string[]; failed: string[] } {
    this.clearMeshes()
    const loaded: string[] = []
    const failed: string[] = []
    const assets = assetMap(files)
    files.forEach((file, index) => {
      if (!isMeshFile(file.name)) {
        if (!isCompanionFile(file.name)) failed.push(displayName(file.name))
        return
      }
      try {
        const parts = parseMesh(file.name, file.buffer, assets, this.blobUrls)
        if (parts.length === 0) throw new Error('empty')
        for (const part of parts) {
          this.addMesh(part.name, part.geometry, index, part.map)
          loaded.push(part.name)
        }
      } catch {
        failed.push(displayName(file.name))
      }
    })
    this.finishLoad()
    return { loaded, failed }
  }

  setSample(): void {
    this.clearMeshes()
    buildSample().forEach((item, index) => this.addMesh(item.name, item.geometry, index))
    this.finishLoad()
  }

  getMeshes(): MeshInfo[] {
    return this.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      visible: entry.visible,
      transparency: entry.transparency,
      wireframe: entry.wireframe,
      color: colorCss(entry.color),
    }))
  }

  setVisible(id: string, visible: boolean): void {
    const entry = this.entry(id)
    if (!entry) return
    entry.visible = visible
    this.applyMaterial(entry)
  }

  setTransparency(id: string, transparency: number): void {
    const entry = this.entry(id)
    if (!entry) return
    entry.transparency = Math.min(1, Math.max(0, transparency))
    this.applyMaterial(entry)
  }

  setWireframe(id: string, wireframe: boolean): void {
    const entry = this.entry(id)
    if (!entry) return
    entry.wireframe = wireframe
    this.applyMaterial(entry)
  }

  setAllVisible(visible: boolean): void {
    for (const entry of this.entries) {
      entry.visible = visible
      this.applyMaterial(entry)
    }
  }

  setShading(mode: ShadingMode): void {
    this.shading = mode
    this.refreshMaterials()
  }

  setSurface(mode: SurfaceMode): void {
    this.surface = mode
    this.refreshMaterials()
  }

  setProjection(mode: ProjectionMode): void {
    if (mode === this.projection) return
    const next = mode === 'ortho' ? this.ortho : this.persp
    next.position.copy(this.camera.position)
    next.up.copy(this.camera.up)
    this.camera = next
    this.controls.object = next
    this.projection = mode
    this.resize()
    this.controls.update()
  }

  setUpAxis(axis: UpAxis): void {
    this.upAxis = axis
    this.root.rotation.x = axis === 'z' ? -Math.PI / 2 : 0
    this.root.updateMatrixWorld(true)
    this.setView('default')
  }

  setBackground(mode: 'light' | 'dark'): void {
    this.background = mode
    this.applyBackground()
  }

  setView(view: ViewName): void {
    const box = new THREE.Box3().setFromObject(this.root)
    if (box.isEmpty()) return
    box.getCenter(this.center)
    const dir = (view === 'default' ? HOME_DIR : VIEW_DIRS[view]).clone()
    if (view === 'top') dir.z += 0.001
    if (view === 'bottom') dir.z -= 0.001
    dir.normalize()
    const position = this.center.clone().add(dir.multiplyScalar(this.distance))
    this.animateTo(position, this.center.clone())
  }

  resize(): void {
    const parent = this.canvas.parentElement
    if (!parent) return
    const width = parent.clientWidth
    const height = Math.max(parent.clientHeight, 1)
    if (width < 2) return
    this.renderer.setSize(width, height, false)
    const aspect = width / height
    this.persp.aspect = aspect
    this.persp.updateProjectionMatrix()
    this.ortho.top = this.half
    this.ortho.bottom = -this.half
    this.ortho.left = -this.half * aspect
    this.ortho.right = this.half * aspect
    this.ortho.updateProjectionMatrix()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerUp)
    this.clearMeshes()
    this.pivot.geometry.dispose()
    ;(this.pivot.material as THREE.Material).dispose()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }

  private entry(id: string): Entry | undefined {
    return this.entries.find((item) => item.id === id)
  }

  private clearMeshes(): void {
    const disposedMaps = new Set<THREE.Texture>()
    for (const entry of this.entries) {
      this.root.remove(entry.mesh)
      entry.mesh.geometry.dispose()
      if (entry.map && !disposedMaps.has(entry.map)) {
        entry.map.dispose()
        disposedMaps.add(entry.map)
      }
      entry.material.map = null
      entry.material.dispose()
    }
    for (const url of this.blobUrls) URL.revokeObjectURL(url)
    this.blobUrls = []
    this.entries = []
    this.hasVertexColors = false
  }

  private addMesh(name: string, geometry: THREE.BufferGeometry, index: number, map?: THREE.Texture | null): void {
    geometry.computeVertexNormals()
    const hasColors = geometry.hasAttribute('color')
    const color = colorForName(name, index)
    const texture = map ?? null
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.needsUpdate = true
    }
    const material = new THREE.MeshStandardMaterial({
      color: texture ? 0xffffff : color,
      map: texture,
      roughness: /teeth|tooth/i.test(name) ? 0.28 : /nerve/i.test(name) ? 0.42 : 0.64,
      metalness: 0,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    const entry: Entry = {
      id: `mesh-${this.entries.length}`,
      name,
      color,
      hasColors,
      visible: true,
      transparency: 0,
      wireframe: false,
      mesh,
      material,
      map: texture,
    }
    this.applyMaterial(entry)
    this.root.add(mesh)
    this.entries.push(entry)
    if (hasColors) this.hasVertexColors = true
  }

  private finishLoad(): void {
    this.root.rotation.x = this.upAxis === 'z' ? -Math.PI / 2 : 0
    this.root.updateMatrixWorld(true)
    this.fitDistances()
    this.setView('default')
  }

  private fitDistances(): void {
    const box = new THREE.Box3().setFromObject(this.root)
    if (box.isEmpty()) return
    const size = box.getSize(this.tmp)
    this.radius = Math.max(size.x, size.y, size.z, 1) * 0.5
    const aspect = this.persp.aspect > 0 ? this.persp.aspect : 1
    const vFov = (this.persp.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
    const distV = this.radius / Math.tan(vFov / 2)
    const distH = this.radius / Math.tan(hFov / 2)
    this.distance = Math.max(distV, distH) * 1.35
    this.half = this.radius * 1.6
    const near = Math.max(this.radius / 400, 0.01)
    const far = this.radius * 400
    this.persp.near = near
    this.persp.far = far
    this.ortho.near = -far
    this.ortho.far = far
    this.controls.minDistance = this.radius * 0.2
    this.controls.maxDistance = this.radius * 14
    this.pivot.scale.setScalar(Math.max(this.radius * 0.025, 0.4))
    this.resize()
  }

  private applyMaterial(entry: Entry): void {
    const useVertex = this.surface === 'vertex' && entry.hasColors
    entry.material.map = useVertex ? null : entry.map
    entry.material.color.set(useVertex || entry.map ? 0xffffff : entry.color)
    entry.material.vertexColors = useVertex
    entry.material.flatShading = this.shading === 'flat'
    entry.material.wireframe = entry.wireframe
    const opacity = 1 - entry.transparency
    entry.material.opacity = opacity
    entry.material.transparent = entry.transparency > 0.001
    entry.material.depthWrite = entry.transparency < 0.04
    entry.material.needsUpdate = true
    entry.mesh.visible = entry.visible
  }

  private refreshMaterials(): void {
    for (const entry of this.entries) this.applyMaterial(entry)
  }

  private applyBackground(): void {
    this.renderer.setClearColor(this.background === 'dark' ? 0x1c1f26 : 0xd7dbe1, 1)
  }

  private animateTo(position: THREE.Vector3, target: THREE.Vector3): void {
    const framed = this.camera.position.distanceTo(this.controls.target) > this.radius
    if (this.reduceMotion || !framed) {
      this.anim = null
      this.applyPose(position, target)
      return
    }
    this.anim = {
      p0: this.camera.position.clone(),
      p1: position,
      t0: this.controls.target.clone(),
      t1: target,
      start: performance.now(),
      dur: 320,
    }
  }

  private applyPose(position: THREE.Vector3, target: THREE.Vector3): void {
    this.persp.position.copy(position)
    this.ortho.position.copy(position)
    this.controls.target.copy(target)
    this.persp.lookAt(target)
    this.ortho.lookAt(target)
    this.controls.update()
  }

  private aimLight(): void {
    this.key.position.copy(this.camera.position)
    this.key.target.position.copy(this.controls.target)
    this.key.target.updateMatrixWorld()
  }

  private loop = (): void => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.loop)
    if (this.anim) {
      const u = Math.min(1, (performance.now() - this.anim.start) / this.anim.dur)
      const k = u < 1 ? 1 - (1 - u) ** 3 : 1
      const position = this.tmp.copy(this.anim.p0).lerp(this.anim.p1, k)
      const target = this.center.copy(this.anim.t0).lerp(this.anim.t1, k)
      this.persp.position.copy(position)
      this.ortho.position.copy(position)
      this.controls.target.copy(target)
      if (u >= 1) this.anim = null
    }
    if (this.pivotLife > 0) {
      this.pivotLife -= 1
      this.pivot.visible = true
      ;(this.pivot.material as THREE.MeshBasicMaterial).opacity = Math.min(0.95, this.pivotLife / 20)
      if (this.pivotLife <= 0) this.pivot.visible = false
    }
    this.controls.update()
    this.aimLight()
    this.renderer.render(this.scene, this.camera)
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    this.pointers.add(event.pointerId)
    if (this.anim) {
      this.applyPose(this.anim.p1, this.anim.t1)
      this.anim = null
    }
    if (this.pointers.size > 1) {
      this.hold = null
      return
    }
    this.hold = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: performance.now(),
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
    }
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.hold || event.pointerId !== this.hold.id) return
    const dx = event.clientX - this.hold.x
    const dy = event.clientY - this.hold.y
    if (dx * dx + dy * dy > 64) this.hold = null
  }

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId)
    const hold = this.hold
    this.hold = null
    if (!hold || event.pointerId !== hold.id) return
    if (performance.now() - hold.t < 520) return
    this.applyPose(hold.pos, hold.target)
    if (this.pickPivot(hold.x, hold.y)) this.onPivot?.()
  }

  private pickPivot(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.camera)
    const hits = ray.intersectObjects(
      this.entries.filter((entry) => entry.visible).map((entry) => entry.mesh),
      false,
    )
    if (!hits.length) return false
    this.controls.target.copy(hits[0].point)
    this.pivot.position.copy(hits[0].point)
    this.pivotLife = 28
    this.controls.update()
    return true
  }
}

function meshKind(filename: string, buffer: ArrayBuffer): 'stl' | 'ply' | 'obj' {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'stl' || ext === 'ply' || ext === 'obj') return ext
  if (buffer.byteLength >= 84) {
    const count = new DataView(buffer).getUint32(80, true)
    if (count > 0 && buffer.byteLength === 84 + count * 50) return 'stl'
  }
  const head = new TextDecoder()
    .decode(buffer.slice(0, Math.min(buffer.byteLength, 512)))
    .trimStart()
    .toLowerCase()
  if (head.startsWith('ply')) return 'ply'
  if (head.startsWith('solid')) return 'stl'
  if (/^(#|mtllib |usemtl |o |g |v |vn |vt |f )/m.test(head)) return 'obj'
  throw new Error(`Unsupported file ${filename}`)
}

type MeshPart = { name: string; geometry: THREE.BufferGeometry; map: THREE.Texture | null }

function assetMap(files: Array<{ name: string; buffer: ArrayBuffer }>): Map<string, ArrayBuffer> {
  const assets = new Map<string, ArrayBuffer>()
  for (const file of files) {
    const base = (file.name.split(/[/\\]/).pop() || file.name).toLowerCase()
    assets.set(base, file.buffer)
    assets.set(sanitizeFileName(base).toLowerCase(), file.buffer)
  }
  return assets
}

function lookupAsset(assets: Map<string, ArrayBuffer>, ref: string): ArrayBuffer | undefined {
  const base = (ref.split(/[/\\]/).pop() || ref).trim().toLowerCase()
  return assets.get(base) || assets.get(sanitizeFileName(base).toLowerCase())
}

function imageType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}

function materialsForObj(filename: string, text: string, assets: Map<string, ArrayBuffer>, blobUrls: string[]) {
  const named = text.match(/^mtllib\s+(.+)$/im)?.[1]?.trim()
  const stem = (filename.split(/[/\\]/).pop() || filename).replace(/\.[^.]+$/, '')
  const mtl = (named && lookupAsset(assets, named)) || lookupAsset(assets, `${stem}.mtl`)
  if (!mtl) return null
  const blobs = new Map<string, string>()
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    const base = decodeURIComponent(url.split(/[?#]/)[0].split(/[/\\]/).pop() || url)
    const image = lookupAsset(assets, base)
    if (!image) return url
    const key = base.toLowerCase()
    let blobUrl = blobs.get(key)
    if (!blobUrl) {
      blobUrl = URL.createObjectURL(new Blob([new Uint8Array(image)], { type: imageType(base) }))
      blobs.set(key, blobUrl)
      blobUrls.push(blobUrl)
    }
    return blobUrl
  })
  const creator = new MTLLoader(manager).parse(new TextDecoder().decode(mtl), '')
  creator.preload()
  return creator
}

function materialMap(material: THREE.Material | THREE.Material[]): THREE.Texture | null {
  const first = Array.isArray(material) ? material[0] : material
  const map = (first as THREE.MeshPhongMaterial).map
  return map ?? null
}

function parseMesh(
  filename: string,
  buffer: ArrayBuffer,
  assets: Map<string, ArrayBuffer>,
  blobUrls: string[],
): MeshPart[] {
  const kind = meshKind(filename, buffer)
  const label = displayName(filename)
  if (kind === 'stl') {
    return [{ name: label, geometry: new STLLoader().parse(buffer), map: null }]
  }
  if (kind === 'ply') {
    return [{ name: label, geometry: new PLYLoader().parse(buffer), map: null }]
  }
  if (kind === 'obj') {
    const text = new TextDecoder().decode(buffer)
    const loader = new OBJLoader()
    const materials = materialsForObj(filename, text, assets, blobUrls)
    if (materials) loader.setMaterials(materials)
    const root = loader.parse(text)
    root.updateMatrixWorld(true)
    const parts: MeshPart[] = []
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const geometry = mesh.geometry.clone()
      geometry.applyMatrix4(mesh.matrixWorld)
      parts.push({
        name: mesh.name ? displayName(mesh.name) : label,
        geometry,
        map: materialMap(mesh.material),
      })
    })
    if (parts.length === 1) parts[0].name = label
    return parts
  }
  throw new Error(`Unsupported file ${filename}`)
}
