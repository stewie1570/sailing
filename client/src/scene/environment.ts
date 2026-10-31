import * as THREE from 'three'

/**
 * Single source of truth for lighting so the sky dome, water reflection and terrain shading agree.
 * Colours are in linear space (the renderer tone-maps and encodes to sRGB on output).
 */
export const environment = {
  /** Late-afternoon sun from the south-west, ~28° elevation. */
  sunDirection: new THREE.Vector3(-0.55, 0.47, 0.62).normalize(),
  sunColor: new THREE.Color(1.0, 0.93, 0.82),
  sunIntensity: 1.7,
  skyZenith: new THREE.Color(0.055, 0.19, 0.52),
  skyHorizon: new THREE.Color(0.55, 0.68, 0.82),
  /** Ambient light arriving from above (sky) and below (ground bounce). */
  hemiSky: new THREE.Color(0.24, 0.31, 0.45),
  hemiGround: new THREE.Color(0.16, 0.15, 0.11),
  /** Fog is slightly blue-grey haze; density per metre (exp2). */
  fogColor: new THREE.Color(0.58, 0.69, 0.8),
  fogDensity: 0.000095,
  waterDeep: new THREE.Color(0.008, 0.045, 0.085),
  waterShallow: new THREE.Color(0.03, 0.26, 0.25),
}

/**
 * GLSL: analytic sky colour for a view direction. Used by the sky dome and sampled again by the water
 * shader for reflections, which is far cheaper than a reflection render target on old GPUs.
 * Requires uniforms: uSunDir, uSkyZenith, uSkyHorizon, uSunColor.
 */
export const skyGlsl = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSunColor;

  vec3 skyColor(vec3 dir, bool withSunDisc) {
    float t = clamp(dir.y, 0.0, 1.0);
    vec3 col = mix(uSkyHorizon, uSkyZenith, pow(t, 0.5));
    float sunAmt = max(dot(dir, uSunDir), 0.0);
    // broad warm glow around the sun, stronger near the horizon
    col += uSunColor * pow(sunAmt, 6.0) * 0.22 * (1.0 - 0.6 * t);
    // mie-ish forward scatter
    col += uSunColor * pow(sunAmt, 64.0) * 0.5;
    if (withSunDisc) {
      col += uSunColor * smoothstep(0.99955, 0.99975, sunAmt) * 12.0;
    }
    // below the horizon the dome fades to haze
    col = mix(col, uSkyHorizon * 0.9, smoothstep(0.0, -0.08, dir.y));
    return col;
  }
`

export function skyUniforms() {
  return {
    uSunDir: { value: environment.sunDirection },
    uSkyZenith: { value: environment.skyZenith },
    uSkyHorizon: { value: environment.skyHorizon },
    uSunColor: { value: environment.sunColor },
  }
}
