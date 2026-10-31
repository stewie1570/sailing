import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { MapData } from '../map/mapData'
import { environment } from './environment'
import { QUALITY_PRESETS, useQuality } from './quality'
import { buildTerrainGeometry } from './terrainGeometry'

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D uColorMap;
  uniform sampler2D uDetailMap;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  uniform vec3 uHemiSky;
  uniform vec3 uHemiGround;
  uniform float uFineDetail;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  #include <fog_pars_fragment>

  void main() {
    vec3 albedo = texture2D(uColorMap, vUv).rgb;

    // Break up the 23 m/px painted texture near the camera with tiling noise at two scales.
    float dist = distance(cameraPosition, vWorldPos);
    float detailFade = 1.0 - smoothstep(600.0, 3000.0, dist);
    float d1 = texture2D(uDetailMap, vWorldPos.xz / 55.0).r;
    float detail = mix(1.0, 0.72 + 0.56 * d1, detailFade * 0.8);
    if (uFineDetail > 0.5) {
      float d2 = texture2D(uDetailMap, vWorldPos.xz / 9.0).r;
      detail *= mix(1.0, 0.85 + 0.3 * d2, (1.0 - smoothstep(80.0, 500.0, dist)) * 0.8);
    }
    albedo *= detail;

    // Steep slopes read as rock; the lakebed is already coloured in the texture.
    vec3 n = normalize(vNormal);
    float slope = 1.0 - n.y;
    vec3 rock = vec3(0.30, 0.28, 0.25) * (0.7 + 0.6 * d1);
    albedo = mix(albedo, rock, smoothstep(0.28, 0.5, slope) * step(0.0, vWorldPos.y));

    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 hemi = mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5);
    vec3 light = uSunColor * uSunIntensity * ndl + hemi;
    vec3 col = albedo * light;

    // Submerged terrain: tint and darken with depth so the lakebed reads through the water correctly.
    float depth = max(-vWorldPos.y, 0.0);
    col *= mix(1.0, 0.35, clamp(depth / 12.0, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function Terrain({ map }: { map: MapData }) {
  const quality = useQuality()
  const preset = QUALITY_PRESETS[quality]

  const geometry = useMemo(
    () => buildTerrainGeometry(map, preset.terrainSegments[0], preset.terrainSegments[1]),
    [map, preset.terrainSegments],
  )

  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uColorMap: { value: null },
          uDetailMap: { value: null },
          uSunDir: { value: environment.sunDirection },
          uSunColor: { value: environment.sunColor },
          uSunIntensity: { value: environment.sunIntensity },
          uHemiSky: { value: environment.hemiSky },
          uHemiGround: { value: environment.hemiGround },
          uFineDetail: { value: 1 },
        },
      ]),
    })
    // UniformsUtils.merge clones values; assign textures afterwards so they are shared, not cloned.
    mat.uniforms.uColorMap.value = map.textures.color
    mat.uniforms.uDetailMap.value = map.textures.detail
    return mat
  }, [map])

  useEffect(() => {
    material.uniforms.uFineDetail.value = preset.fineDetail ? 1 : 0
  }, [material, preset.fineDetail])

  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}
