const LABELS: Record<string, string> = {
  upper_jaw: 'Upper jaw',
  lower_jaw: 'Lower jaw',
  teeth: 'Teeth',
  teeth_combined: 'Teeth',
  nerve: 'Nerve',
  nerve2: 'Nerve 2',
  sinus: 'Sinus',
  sinus_l: 'Sinus left',
  sinus_r: 'Sinus right',
  soft_tissue: 'Soft tissue',
  pharynx: 'Pharynx',
  pdl: 'PDL',
  ios_upper: 'IOS upper',
  ios_lower: 'IOS lower',
  ios_scan: 'IOS scan',
}

const COLORS: Array<[RegExp, number]> = [
  [/upper.?jaw|ios.?upper/i, 0xf4efe4],
  [/lower.?jaw|ios.?lower/i, 0xe8cfc0],
  [/teeth|tooth/i, 0xfffaf4],
  [/nerve/i, 0xe6c84a],
  [/sinus/i, 0x8eb6d6],
  [/pharynx/i, 0xd07a88],
  [/soft|gingiva|tissue/i, 0xe7a0a8],
  [/pdl/i, 0xc98b96],
  [/ios|scan/i, 0xe6d5c3],
]

const FALLBACK = [0xf3efe6, 0xf0d7c4, 0xd5e2ea, 0xe7c2b8, 0xc9d4c5, 0xf2e2c4]

export function displayName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() || filename
  const stem = base.replace(/\.[^.]+$/, '')
  const key = stem.toLowerCase()
  if (LABELS[key]) return LABELS[key]
  const pretty = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return pretty || 'Mesh'
}

export function colorForName(name: string, index: number): number {
  for (const [pattern, color] of COLORS) {
    if (pattern.test(name)) return color
  }
  return FALLBACK[index % FALLBACK.length]
}

export function colorCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}

export function caseFolderName(name: string): string {
  const clean = name
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9._ -]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return clean.slice(0, 80)
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'mesh'
  const clean = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_')
  return clean.slice(0, 80) || 'mesh.stl'
}

export function uniqueFileName(name: string, used: Set<string>): string {
  let next = sanitizeFileName(name)
  const dot = next.lastIndexOf('.')
  const stem = dot > 0 ? next.slice(0, dot) : next
  const ext = dot > 0 ? next.slice(dot) : ''
  let i = 2
  while (used.has(next.toLowerCase())) {
    next = `${stem}_${i}${ext}`
    i += 1
  }
  used.add(next.toLowerCase())
  return next
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const MESH_EXT = new Set(['stl', 'ply', 'obj'])
const COMPANION_EXT = new Set(['mtl', 'jpg', 'jpeg', 'png', 'webp'])

export function fileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function isMeshFile(name: string): boolean {
  return MESH_EXT.has(fileExtension(name))
}

export function isCompanionFile(name: string): boolean {
  return COMPANION_EXT.has(fileExtension(name))
}

export function isCaseFile(name: string): boolean {
  return isMeshFile(name) || isCompanionFile(name)
}
