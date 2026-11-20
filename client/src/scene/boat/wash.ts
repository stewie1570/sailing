/**
 * Prop wash for the twin screws. One ribbon per engine, parented to the hull,
 * so a turn carries it for free. The run from the screw to the rudder stays
 * straight. Past the blade the same ribbon yaws with the helm, and astern
 * wash reverses that bend. Length, brightness, and scroll follow that screw's
 * own lever. A stopped screw hides its ribbon.
 *
 * A few dozen vertices and one unlit material per screw. The lake shader is
 * left alone.
 */

import * as THREE from 'three'
import { RUDDER_LOCK } from './dynamics'

/** Below this the lever is in the stop notch and the ribbon is not drawn. */
export const WASH_ON = 0.02

const SCREW = { x: 0.72, y: 0.14, z: -4.48 }
/**
 * Where that screw's stream meets the blade. The tail hinges here.
 * The ribbon sits just above the swell. The lake surface is opaque from the
 * chase camera, so a streak left down at the screw never shows.
 */
const HINGE = { x: 0.34, y: 0.16, z: -6.45 }
/** Metres of tail aft of the hinge at full ahead. The transom is near z = -6.55. */
const TAIL = 5.2
const APPROACH = 4
const TAIL_SEGS = 8

export interface WashMotion {
  on: boolean
  /** 0 off, 1 full ahead or full astern. */
  strength: number
  /** +1 ahead, −1 astern, 0 stopped. */
  scrollSign: number
  /**
   * Yaw of the tail, radians. Positive swings the aft end to starboard,
   * which is where ahead wash goes on starboard helm.
   */
  kick: number
}

/** How one screw's wash should look this frame. The two screws do not share it. */
export function washMotion(throttle: number, rudder: number): WashMotion {
  const command = Number.isFinite(throttle) ? Math.min(1, Math.max(-1, throttle)) : 0
  const helm = Number.isFinite(rudder) ? Math.min(1, Math.max(-1, rudder)) : 0
  const mag = Math.abs(command)
  const on = mag > WASH_ON
  const scrollSign = command > 0 ? 1 : command < 0 ? -1 : 0
  return {
    on,
    strength: on ? mag : 0,
    scrollSign,
    kick: scrollSign * helm * RUDDER_LOCK,
  }
}

const vertexShader = /* glsl */ `
  attribute float aAlong;
  attribute float aSide;
  uniform float uKick;
  uniform float uStrength;
  uniform float uHinge;
  uniform float uHingeX;
  uniform float uHingeZ;
  varying float vAlong;
  varying float vSide;
  #include <fog_pars_vertex>

  void main() {
    vAlong = aAlong;
    vSide = aSide;
    // The run up to the blade stays put. Past it, the tail shortens with the
    // lever and yaws with the rudder. Same bend the blade mesh already uses.
    float t = smoothstep(uHinge, uHinge + 0.1, aAlong);
    float reach = mix(0.18, 1.0, uStrength);
    float dx = position.x - uHingeX;
    float dz = position.z - uHingeZ;
    dx *= mix(1.0, reach, t);
    dz *= mix(1.0, reach, t);
    float ang = uKick * t;
    float c = cos(ang);
    float s = sin(ang);
    vec3 pos = position;
    pos.x = uHingeX + dx * c + dz * s;
    pos.z = uHingeZ - dx * s + dz * c;
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  uniform float uScroll;
  uniform float uStrength;
  varying float vAlong;
  varying float vSide;
  #include <fog_pars_fragment>

  void main() {
    float streak = 0.62 + 0.38 * sin(vAlong * 22.0 - uScroll);
    float edge = 1.0 - smoothstep(0.42, 1.0, abs(vSide));
    float head = smoothstep(0.0, 0.03, vAlong);
    float tip = 1.0 - smoothstep(0.88, 1.0, vAlong);
    float alpha = uStrength * streak * edge * head * tip;
    vec3 col = mix(vec3(0.72, 0.86, 0.9), vec3(0.97, 0.98, 0.99), streak);
    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface EngineWash {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  hingeAlong: number
}

/** Ribbon for one screw. `side` is +1 port, −1 starboard. */
export function createEngineWash(side: 1 | -1): EngineWash {
  const stations = APPROACH + TAIL_SEGS
  const hingeAlong = APPROACH / stations
  const center: { x: number; y: number; z: number; along: number; width: number }[] = []
  for (let i = 0; i <= stations; i++) {
    const along = i / stations
    let x: number
    let y: number
    let z: number
    let width: number
    if (i <= APPROACH) {
      const u = i / APPROACH
      x = side * (SCREW.x + (HINGE.x - SCREW.x) * u)
      y = SCREW.y + (HINGE.y - SCREW.y) * u
      z = SCREW.z + (HINGE.z - SCREW.z) * u
      width = 0.28 + 0.36 * u
    } else {
      const u = (i - APPROACH) / TAIL_SEGS
      x = side * HINGE.x
      y = HINGE.y
      z = HINGE.z - TAIL * u
      width = 0.64 + 0.7 * u
    }
    center.push({ x, y, z, along, width })
  }

  const positions: number[] = []
  const along: number[] = []
  const across: number[] = []
  const indices: number[] = []
  for (let i = 0; i < center.length; i++) {
    const prev = center[Math.max(0, i - 1)]
    const next = center[Math.min(center.length - 1, i + 1)]
    let px = next.x - prev.x
    let pz = next.z - prev.z
    const len = Math.hypot(px, pz) || 1
    px /= len
    pz /= len
    const half = center[i].width * 0.5
    // Perpendicular in the horizontal plane, port side of the run first.
    positions.push(center[i].x - pz * half, center[i].y, center[i].z + px * half)
    along.push(center[i].along)
    across.push(-1)
    positions.push(center[i].x + pz * half, center[i].y, center[i].z - px * half)
    along.push(center[i].along)
    across.push(1)
    if (i > 0) {
      const a = (i - 1) * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1))
  geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(across, 1))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uScroll: { value: 0 },
        uStrength: { value: 0 },
        uKick: { value: 0 },
        uHinge: { value: hingeAlong },
        uHingeX: { value: side * HINGE.x },
        uHingeZ: { value: HINGE.z },
      },
    ]),
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = side > 0 ? 'port-wash' : 'starboard-wash'
  mesh.frustumCulled = false
  mesh.renderOrder = 3
  mesh.visible = false
  return { mesh, material, hingeAlong }
}

/** Scroll and bend one ribbon. Hidden while that screw is in the stop notch. */
export function poseEngineWash(wash: EngineWash, throttle: number, rudder: number, time: number) {
  const motion = washMotion(throttle, rudder)
  wash.mesh.visible = motion.on
  if (!motion.on) return
  const uniforms = wash.material.uniforms
  uniforms.uStrength.value = motion.strength
  uniforms.uKick.value = motion.kick
  uniforms.uScroll.value = time * motion.scrollSign * (6 + 18 * motion.strength)
}

export function disposeEngineWash(wash: EngineWash) {
  wash.mesh.geometry.dispose()
  wash.material.dispose()
}
