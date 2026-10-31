import * as THREE from 'three'

/** Shape of client/public/map/mapdata.json produced by tools/mapgen. */
export interface MapDataJson {
  name: string
  image: { width: number; height: number }
  metersPerPixel: number
  worldSize: [number, number]
  height: { min: number; max: number; waterLevel: number }
  waterDepth: { offset: number; range: number }
  buoys: { type: 'port' | 'starboard'; x: number; z: number }[]
  harbors: { name: string; x: number; z: number; seaward: [number, number] }[]
}

export type TreeInstance = [x: number, z: number, scale: number]

export interface MapTextures {
  /** Painted colour of the land / lakebed, sRGB. */
  color: THREE.Texture
  /** 8-bit depth below the water surface, see mapdata.waterDepth for the encoding. Linear. */
  waterDepth: THREE.Texture
  /** Small tiling grey noise used for close-up surface detail. Linear. */
  detail: THREE.Texture
  /** Tileable tangent-space normal map for water ripples. Linear. */
  waterNormal: THREE.Texture
}

export class MapData {
  readonly name: string
  readonly width: number
  readonly height: number
  readonly metersPerPixel: number
  readonly worldWidth: number
  readonly worldDepth: number
  readonly waterLevel: number
  readonly buoys: MapDataJson['buoys']
  readonly harbors: MapDataJson['harbors']
  readonly trees: TreeInstance[]
  readonly textures: MapTextures
  readonly waterDepth: MapDataJson['waterDepth']
  /** Terrain height in metres per source pixel, row-major, image orientation (row 0 = north). */
  readonly heights: Float32Array
  /** 0 = deep water, 128 = shoal, 255 = land, per source pixel. */
  readonly classes: Uint8Array

  constructor(json: MapDataJson, heights: Float32Array, classes: Uint8Array, trees: TreeInstance[], textures: MapTextures) {
    this.name = json.name
    this.width = json.image.width
    this.height = json.image.height
    this.metersPerPixel = json.metersPerPixel
    this.worldWidth = json.worldSize[0]
    this.worldDepth = json.worldSize[1]
    this.waterLevel = json.height.waterLevel
    this.waterDepth = json.waterDepth
    this.buoys = json.buoys
    this.harbors = json.harbors
    this.trees = trees
    this.textures = textures
    this.heights = heights
    this.classes = classes
  }

  /** World x/z (metres, origin at map centre, +z = south) -> continuous pixel coordinates. */
  toPixel(x: number, z: number): [number, number] {
    return [x / this.metersPerPixel + this.width / 2, z / this.metersPerPixel + this.height / 2]
  }

  /** Bilinearly interpolated terrain height (metres above water level) at a world position. */
  heightAt(x: number, z: number): number {
    const [px, py] = this.toPixel(x, z)
    const fx = Math.min(Math.max(px - 0.5, 0), this.width - 1.001)
    const fy = Math.min(Math.max(py - 0.5, 0), this.height - 1.001)
    const x0 = Math.floor(fx), y0 = Math.floor(fy)
    const tx = fx - x0, ty = fy - y0
    const w = this.width, h = this.heights
    const i = y0 * w + x0
    const a = h[i], b = h[i + 1], c = h[i + w], d = h[i + w + 1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
  }

  isLand(x: number, z: number): boolean {
    const [px, py] = this.toPixel(x, z)
    const ix = Math.min(Math.max(Math.floor(px), 0), this.width - 1)
    const iy = Math.min(Math.max(Math.floor(py), 0), this.height - 1)
    return this.classes[iy * this.width + ix] === 255
  }
}

const BASE = '/map'

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  return res.json() as Promise<T>
}

/** Decode a PNG to raw RGBA bytes without any colour management so encoded data survives intact. */
async function decodePixels(url: string): Promise<ImageData> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  const blob = await res.blob()
  let source: ImageBitmap | HTMLImageElement
  try {
    source = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  } catch {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = URL.createObjectURL(blob)
    })
  }
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function loadTexture(url: string, srgb: boolean, anisotropy: number): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        // All map textures are addressed with v = 0 at the north (top) edge, matching the pixel grid.
        tex.flipY = false
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
        tex.anisotropy = anisotropy
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.generateMipmaps = true
        resolve(tex)
      },
      undefined,
      reject,
    )
  })
}

let cached: Promise<MapData> | null = null

/** Loads and decodes all map assets once; subsequent calls share the same promise. */
export function loadMapData(anisotropy = 2): Promise<MapData> {
  if (cached) return cached
  cached = (async () => {
    const [json, trees, heightPixels, color, waterDepth, detail, waterNormal] = await Promise.all([
      fetchJson<MapDataJson>(`${BASE}/mapdata.json`),
      fetchJson<TreeInstance[]>(`${BASE}/trees.json`),
      decodePixels(`${BASE}/heightmap.png`),
      loadTexture(`${BASE}/landcolor.jpg`, true, anisotropy),
      loadTexture(`${BASE}/waterdepth.png`, false, 1),
      loadTexture(`${BASE}/detail.png`, false, anisotropy),
      loadTexture(`${BASE}/waternormal.png`, false, anisotropy),
    ])
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping
    waterNormal.wrapS = waterNormal.wrapT = THREE.RepeatWrapping

    const n = heightPixels.width * heightPixels.height
    const heights = new Float32Array(n)
    const classes = new Uint8Array(n)
    const d = heightPixels.data
    const range = json.height.max - json.height.min
    for (let i = 0; i < n; i++) {
      const v = (d[i * 4] << 8) | d[i * 4 + 1]
      heights[i] = json.height.min + (v / 65535) * range
      classes[i] = d[i * 4 + 2]
    }
    return new MapData(json, heights, classes, trees, { color, waterDepth, detail, waterNormal })
  })()
  return cached
}
