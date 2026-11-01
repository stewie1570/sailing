import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { MapData } from '../map/mapData'
import { environment, skyGlsl, skyUniforms } from './environment'
import { WIND_SPEED_MAX, WIND_SPEED_MIN, getWind } from './boat/wind'
import { QUALITY_PRESETS, useQuality } from './quality'

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying float vSwell;
  #include <fog_pars_vertex>

  // Standing swell. The crests stay put and only the height oscillates, so the
  // pattern does not travel across the lake.
  float swell(vec2 p, float t) {
    return 0.10 * sin(dot(p, vec2(0.021, 0.013))) * sin(t * 0.55)
         + 0.07 * sin(dot(p, vec2(-0.011, 0.027))) * sin(t * 0.41);
  }

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float s = swell(wp.xz, uTime);
    wp.y += s;
    vSwell = s;
    vWorldPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uDepthMap;
  uniform sampler2D uDetailMap;
  uniform vec2 uMapOrigin;    // world xz of pixel (0,0)
  uniform vec2 uMapSize;      // world size of the map in metres
  uniform float uDepthOffset; // metres above water encoded as 0
  uniform float uDepthRange;  // metres spanned by 0..1
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform float uSunIntensity;
  uniform float uPixelAngle;  // radians subtended by one pixel
  uniform sampler2D uNormalMap;
  uniform float uRippleStrength;
  uniform vec2 uWindDir;   // world xz, the way the air is moving
  uniform float uWindGain; // chop scale, about 1 in a moderate breeze
  varying vec3 vWorldPos;
  varying float vSwell;
  #include <fog_pars_fragment>
  ${skyGlsl}

  // Small wind ripples: height gradient of a handful of directional sines. Each wave fades out once the
  // pixel footprint on the surface approaches its wavelength, which is what stops moiré at distance.
  // 'foot' is the approximate ground size of one pixel in metres.
  float waveWeight(float wavelength, float foot) {
    return 1.0 - smoothstep(0.18 * wavelength, 0.5 * wavelength, foot);
  }
  // Wind-aligned chop that heaves in place. The crest lines do not travel.
  vec2 windWaveSlope(vec2 p, float t, float foot, float warp) {
    vec2 g = vec2(0.0);
    vec2 d; float k, a, w;
    vec2 q = p + warp * 9.0; // fixed bend so crests are not perfectly straight
    d = uWindDir; k = 6.2831 / 14.0; a = 0.04 * uWindGain; w = waveWeight(14.0, foot); g += w * d * k * a * cos(dot(d, q) * k) * sin(t * 1.6);
    d = vec2(uWindDir.x * 0.80 - uWindDir.y * 0.60, uWindDir.x * 0.60 + uWindDir.y * 0.80);
    k = 6.2831 / 7.5; a = 0.022 * uWindGain; w = waveWeight(7.5, foot); g += w * d * k * a * cos(dot(d, q) * k) * sin(t * 2.1);
    return g;
  }

  // Normal-map ripples rock up and down where they sit. The sample point never
  // slides, so the pattern cannot drift across the water. Mipmapping averages
  // the normals toward flat at distance.
  vec2 rippleSlope(vec2 p, float t) {
    vec2 uv1 = p / 19.0;
    vec2 uv2 = p / 6.5;
    vec2 uv3 = p / 1.7;
    vec3 m1 = texture2D(uNormalMap, uv1).xyz * 2.0 - 1.0;
    vec3 m2 = texture2D(uNormalMap, uv2).xyz * 2.0 - 1.0;
    vec3 m3 = texture2D(uNormalMap, uv3).xyz * 2.0 - 1.0;
    vec2 n1 = m1.xy * sin(t * 1.6 + m1.z * 6.2831);
    vec2 n2 = m2.xy * sin(t * 2.2 + m2.z * 6.2831);
    vec2 n3 = m3.xy * sin(t * 2.9 + m3.z * 6.2831);
    return n1 * 0.55 + n2 * 0.35 + n3 * 0.18;
  }

  void main() {
    vec3 toCam = cameraPosition - vWorldPos;
    float dist = length(toCam);
    vec3 V = toCam / dist;

    // Depth under this point of the surface (negative over land).
    vec2 uv = (vWorldPos.xz - uMapOrigin) / uMapSize;
    float encoded = texture2D(uDepthMap, clamp(uv, 0.0, 1.0)).r;
    float depth = encoded * uDepthRange - uDepthOffset;
    bool outside = any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)));
    if (outside) depth = 40.0;

    // Approximate ground footprint of one pixel (metres): grows with distance and at grazing angles.
    float foot = dist * uPixelAngle / max(V.y, 0.04);
    float rippleFade = 1.0 - smoothstep(3000.0, 9000.0, dist);
    // Low-frequency variation: breaks up the regular wave pattern and gives calm/ruffled patches (cat's paws).
    float gust = texture2D(uDetailMap, vWorldPos.xz / 420.0).r;
    vec2 slope = windWaveSlope(vWorldPos.xz, uTime, foot, gust - 0.5) + rippleSlope(vWorldPos.xz, uTime) * uRippleStrength;
    slope *= rippleFade * mix(0.55, 1.25, gust);
    // calm water in the lee near shore, choppier out in the lake
    slope *= mix(0.35, 1.0, clamp(depth / 6.0, 0.0, 1.0));
    // Where ripples are no longer resolved the surface should still read as rough, not mirror-flat:
    // broaden the specular lobe instead (see below).
    float roughness = clamp(foot / 4.0, 0.0, 1.0);
    vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

    // Fresnel (Schlick), n = 1.33
    float cosT = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

    vec3 R = reflect(-V, N);
    R.y = abs(R.y); // never reflect below the horizon
    vec3 reflection = skyColor(R, false);
    // sun glitter: tight lobe up close where ripples are resolved, broader (and dimmer) far away where
    // the unresolved ripples would statistically scatter the highlight into a glitter path.
    vec3 H = normalize(V + uSunDir);
    float shininess = mix(1200.0, 90.0, roughness);
    float spec = pow(max(dot(N, H), 0.0), shininess) * (shininess + 2.0) / 1200.0;
    reflection += uSunColor * spec * uSunIntensity * 2.8;

    // Water body colour: absorption with depth, slight brightening where sunlight hits ripples.
    float absorb = 1.0 - exp(-max(depth, 0.0) / 5.5);
    vec3 body = mix(uShallowColor, uDeepColor, absorb);
    float ndl = max(dot(N, uSunDir), 0.0);
    body *= 0.75 + 0.5 * ndl;

    // Transparency toward the shore so the sandy lakebed reads through, with a foam line at the edge.
    float shoreAlpha = smoothstep(-0.15, 2.5, depth);
    float foamNoise = texture2D(uDetailMap, vWorldPos.xz / 18.0).r;
    float foamBand = (1.0 - smoothstep(0.0, 0.9, depth)) * smoothstep(-0.25, 0.05, depth);
    float foam = foamBand * smoothstep(0.35, 0.75, foamNoise + 0.25 * vSwell * 3.0) * rippleFade;

    vec3 col = mix(body, reflection, F);
    col = mix(col, vec3(0.85, 0.88, 0.9), foam);
    float alpha = max(shoreAlpha, F * 0.9);
    alpha = max(alpha, foam);
    alpha *= smoothstep(-0.6, -0.2, depth); // fully hidden over land

    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function Water({ map }: { map: MapData }) {
  const quality = useQuality()
  const preset = QUALITY_PRESETS[quality]

  // The surface extends beyond the map so the horizon is always water or hills, never a hard edge.
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(map.worldWidth * 3, map.worldDepth * 3, preset.waterSegments[0], preset.waterSegments[1])
    geo.rotateX(-Math.PI / 2)
    return geo
  }, [map, preset.waterSegments])

  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      fog: true,
      transparent: true,
      depthWrite: false,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        skyUniforms(),
        {
          uTime: { value: 0 },
          uDepthMap: { value: null },
          uDetailMap: { value: null },
          uMapOrigin: { value: new THREE.Vector2(-map.worldWidth / 2, -map.worldDepth / 2) },
          uMapSize: { value: new THREE.Vector2(map.worldWidth, map.worldDepth) },
          uDepthOffset: { value: map.waterDepth.offset },
          uDepthRange: { value: map.waterDepth.range },
          uDeepColor: { value: environment.waterDeep },
          uShallowColor: { value: environment.waterShallow },
          uSunIntensity: { value: environment.sunIntensity },
          uPixelAngle: { value: 0.001 },
          uNormalMap: { value: null },
          uRippleStrength: { value: 0.35 },
          uWindDir: { value: new THREE.Vector2(0, 1) },
          uWindGain: { value: 1.2 },
        },
      ]),
    })
    mat.uniforms.uDepthMap.value = map.textures.waterDepth
    mat.uniforms.uDetailMap.value = map.textures.detail
    mat.uniforms.uNormalMap.value = map.textures.waterNormal
    return mat
  }, [map])

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
    const wind = getWind()
    const dir = material.uniforms.uWindDir.value as THREE.Vector2
    dir.set(Math.sin(wind.blowYaw), Math.cos(wind.blowYaw))
    const span = WIND_SPEED_MAX - WIND_SPEED_MIN
    // The speed band itself is a fresh breeze, so even the quiet end chops the surface.
    material.uniforms.uWindGain.value = 0.95 + 0.8 * ((wind.speed - WIND_SPEED_MIN) / span)
    const cam = state.camera as THREE.PerspectiveCamera
    const heightPx = state.size.height * state.viewport.dpr
    material.uniforms.uPixelAngle.value = (cam.fov * Math.PI) / 180 / heightPx
  })

  return <mesh geometry={geometry} material={material} position={[0, map.waterLevel, 0]} frustumCulled={false} renderOrder={10} />
}
