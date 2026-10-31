import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { skyGlsl, skyUniforms } from './environment'

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position; // unit sphere centred on the camera
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_Position.z = gl_Position.w * 0.9999; // push to the far plane so the near plane never clips it
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D uCloudMap;
  uniform float uTime;
  varying vec3 vDir;
  ${skyGlsl}

  void main() {
    vec3 dir = normalize(vDir);
    vec3 col = skyColor(dir, true);

    // Cheap cloud layer: project the view ray onto a plane 1500 m up and sample tiling noise twice.
    if (dir.y > 0.01) {
      vec2 p = dir.xz / dir.y * 1.5;
      float dens = texture2D(uCloudMap, p * 0.03 + vec2(uTime * 0.0015, uTime * 0.0006)).r;
      dens = dens * 0.65 + 0.35 * texture2D(uCloudMap, p * 0.11 + vec2(-uTime * 0.003, uTime * 0.001)).r;
      float cloud = smoothstep(0.52, 0.72, dens);
      float horizonFade = smoothstep(0.01, 0.12, dir.y);
      cloud *= horizonFade;
      // lit from the sun side, grey underneath
      float lit = 0.6 + 0.4 * max(dot(dir, uSunDir), 0.0);
      vec3 cloudCol = mix(vec3(0.55, 0.6, 0.68), vec3(1.05, 1.0, 0.95), lit);
      col = mix(col, cloudCol, cloud * 0.9);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function Sky({ cloudMap }: { cloudMap: THREE.Texture }) {
  const mesh = useRef<THREE.Mesh>(null)
  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: { ...skyUniforms(), uCloudMap: { value: cloudMap }, uTime: { value: 0 } },
    })
    return mat
  }, [cloudMap])

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
    if (mesh.current) mesh.current.position.copy(state.camera.position)
  })

  return (
    <mesh ref={mesh} material={material} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[1, 24, 12]} />
    </mesh>
  )
}
