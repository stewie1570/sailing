import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { MapData } from '../map/mapData'
import { environment, skyGlsl, skyUniforms } from './environment'
import { telemetry } from './boat/telemetry'
import { WIND_SPEED_MAX, WIND_SPEED_MIN, getWind } from './boat/wind'
import { QUALITY_PRESETS, useQuality } from './quality'

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying float vSwell;
  #include <fog_pars_vertex>

  // Standing swell. Crests stay put. The clock varies slowly across the lake so
  // the whole surface does not rise on one beat. Same constants as swell() in
  // physics.ts. The wavelength stays long enough for the coarse water mesh.
  float swell(vec2 p, float t) {
    float a = sin(dot(p, vec2(0.0031, 0.0022)));
    float b = sin(dot(p, vec2(-0.0017, 0.0026)));
    float phase = a * 1.15 + b * 0.8;
    float rate = 0.55 + 0.45 * (a * 0.5 + 0.5);
    return 0.07 * sin(dot(p, vec2(0.021, 0.013))) * sin(t * 0.26 * rate + phase)
         + 0.05 * sin(dot(p, vec2(-0.011, 0.027))) * sin(t * 0.18 * rate + phase * 0.67 + 1.7);
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
  uniform vec2 uGearPos;   // world xz of the screws and rudder
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
  // Where this patch of water is in its cycle, and how fast that cycle runs.
  // Broad lazy regions, with a shorter phase so water near the boat is not one
  // shimmer. Three sines, reused for every wave. No extra texture read.
  vec2 patchClock(vec2 p, float gust) {
    float slow = sin(dot(p, vec2(0.011, 0.008)));
    float a = sin(dot(p, vec2(0.052, 0.034)));
    float b = sin(dot(p, vec2(-0.081, 0.063)));
    float phase = a * 2.4 + b * 1.8;
    float rate = (0.32 + 0.68 * (slow * 0.5 + 0.5)) * mix(0.6, 1.0, gust);
    return vec2(phase, rate);
  }
  // Wind-aligned chop that heaves in place. The crest lines do not travel.
  vec2 windWaveSlope(vec2 p, float t, float foot, float gust, vec2 clk) {
    vec2 g = vec2(0.0);
    vec2 d; float k, a, w;
    vec2 q = p + (gust - 0.5) * 9.0; // fixed bend so crests are not perfectly straight
    d = uWindDir; k = 6.2831 / 14.0; a = 0.026 * uWindGain; w = waveWeight(14.0, foot); g += w * d * k * a * cos(dot(d, q) * k) * sin(t * 0.62 * clk.y + clk.x);
    d = vec2(uWindDir.x * 0.80 - uWindDir.y * 0.60, uWindDir.x * 0.60 + uWindDir.y * 0.80);
    k = 6.2831 / 7.5; a = 0.014 * uWindGain; w = waveWeight(7.5, foot); g += w * d * k * a * cos(dot(d, q) * k) * sin(t * 0.93 * clk.y + clk.x * 0.61 + 2.2);
    return g;
  }

  // Normal-map ripples rock up and down where they sit. The sample point never
  // slides, so the pattern cannot drift across the water. Mipmapping averages
  // the normals toward flat at distance.
  vec2 rippleSlope(vec2 p, float t, vec2 clk) {
    vec2 uv1 = p / 19.0;
    vec2 uv2 = p / 6.5;
    vec2 uv3 = p / 1.7;
    vec3 m1 = texture2D(uNormalMap, uv1).xyz * 2.0 - 1.0;
    vec3 m2 = texture2D(uNormalMap, uv2).xyz * 2.0 - 1.0;
    vec3 m3 = texture2D(uNormalMap, uv3).xyz * 2.0 - 1.0;
    vec2 n1 = m1.xy * sin(t * 0.50 * clk.y + clk.x + m1.z * 6.2831);
    vec2 n2 = m2.xy * sin(t * 0.85 * clk.y + clk.x * 1.3 + m2.z * 6.2831);
    vec2 n3 = m3.xy * sin(t * 1.25 * clk.y + clk.x * 0.7 + 1.1 + m3.z * 6.2831);
    return n1 * 0.42 + n2 * 0.27 + n3 * 0.14;
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
    vec2 clk = patchClock(vWorldPos.xz, gust);
    vec2 slope = windWaveSlope(vWorldPos.xz, uTime, foot, gust, clk) + rippleSlope(vWorldPos.xz, uTime, clk) * uRippleStrength;
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

    // Absorption is slow through the first few metres so the colour stays a clear
    // teal over the screws instead of dropping straight to the deep dye.
    float absorb = 1.0 - exp(-max(depth, 0.0) / 8.0);
    vec3 body = mix(uShallowColor, uDeepColor, absorb);
    float ndl = max(dot(N, uSunDir), 0.0);
    body *= 0.75 + 0.5 * ndl;

    // Shore shallows show the bottom. That same ramp used to reach solid by a
    // couple of metres, which hid the rudder and screws in open water.
    float shoreAlpha = smoothstep(-0.15, 2.5, depth);
    float foamNoise = texture2D(uDetailMap, vWorldPos.xz / 18.0).r;
    float foamBand = (1.0 - smoothstep(0.0, 0.9, depth)) * smoothstep(-0.25, 0.05, depth);
    float foam = foamBand * smoothstep(0.35, 0.75, foamNoise + 0.25 * vSwell * 3.0) * rippleFade;

    // V.y is the view against a flat surface, so ripple normals cannot flicker
    // the opening. Close overhead views clear the foreground. The patch around
    // the running gear stays clear from a lower quarter view as well.
    float close = 1.0 - smoothstep(12.0, 64.0, dist);
    float overhead = smoothstep(0.08, 0.36, V.y);
    float gearDist = length(vWorldPos.xz - uGearPos);
    float nearGear = 1.0 - smoothstep(1.2, 8.5, gearDist);
    float window = max(close * overhead, nearGear * smoothstep(0.04, 0.18, V.y));
    // Tint what shows through. A deep-water body colour here would ink it back out.
    body = mix(body, mix(uShallowColor, body, 0.25) * 1.2, window);

    vec3 col = mix(body, reflection, F * mix(1.0, 0.35, window));
    col = mix(col, vec3(0.85, 0.88, 0.9), foam);
    float solidAlpha = max(shoreAlpha, F * 0.9);
    // Shallows stay more transparent than the cap. Gear water is the clearest.
    float openAlpha = min(shoreAlpha, mix(0.36, 0.18, nearGear));
    float alpha = mix(solidAlpha, openAlpha, window);
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
          uRippleStrength: { value: 0.28 },
          uWindDir: { value: new THREE.Vector2(0, 1) },
          uWindGain: { value: 1.2 },
          uGearPos: { value: new THREE.Vector2(1e5, 1e5) },
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
    if (telemetry.ready) {
      // Stern gear, boat-local (0, -5.2) rotated by yaw into world xz.
      const gear = material.uniforms.uGearPos.value as THREE.Vector2
      gear.set(
        telemetry.x - 5.2 * Math.sin(telemetry.yaw),
        telemetry.z - 5.2 * Math.cos(telemetry.yaw),
      )
    }
    const span = WIND_SPEED_MAX - WIND_SPEED_MIN
    // Chop follows the 6–30 kn band. The quiet end still keeps a little texture.
    material.uniforms.uWindGain.value = 0.95 + 0.8 * ((wind.speed - WIND_SPEED_MIN) / span)
    const cam = state.camera as THREE.PerspectiveCamera
    const heightPx = state.size.height * state.viewport.dpr
    material.uniforms.uPixelAngle.value = (cam.fov * Math.PI) / 180 / heightPx
  })

  return <mesh geometry={geometry} material={material} position={[0, map.waterLevel, 0]} frustumCulled={false} renderOrder={10} />
}
