import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

function archPoints(rx: number, ry: number, z: number, steps = 28): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = Math.PI * (i / steps)
    points.push(new THREE.Vector3(Math.cos(t) * rx, Math.sin(t) * ry, z))
  }
  return points
}

function tube(rx: number, ry: number, z: number, radius: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(archPoints(rx, ry, z))
  return new THREE.TubeGeometry(curve, 80, radius, 18, false)
}

function teeth(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 2; i <= 26; i += 3) {
    const t = Math.PI * (i / 28)
    const geometry = new THREE.SphereGeometry(2.35, 20, 14)
    geometry.scale(1.05, 1.2, 1.35)
    geometry.translate(Math.cos(t) * 30, Math.sin(t) * 18, 7.4)
    parts.push(geometry)
  }
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  if (!merged) throw new Error('Could not build the sample teeth')
  return merged
}

/** Small Z-up arches so the controls can be tried before any file is loaded. */
export function buildSample(): Array<{ name: string; geometry: THREE.BufferGeometry }> {
  return [
    { name: 'Upper jaw', geometry: tube(32, 20, 15.2, 4.6) },
    { name: 'Lower jaw', geometry: tube(30, 18.5, 0, 4.4) },
    { name: 'Teeth', geometry: teeth() },
    { name: 'Nerve', geometry: tube(22, 13, -3.2, 1.05) },
  ]
}
