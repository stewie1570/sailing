import * as THREE from 'three'
import type { MapData } from '../map/mapData'

/**
 * Builds an indexed grid over the whole map and displaces it on the CPU from the decoded heightmap.
 * One static mesh, one draw call; normals are precomputed so the vertex shader is trivial.
 */
export function buildTerrainGeometry(map: MapData, segX: number, segZ: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(map.worldWidth, map.worldDepth, segX, segZ)
  // PlaneGeometry lies in the XY plane facing +Z; rotate so it lies in XZ with +Y up. After rotation
  // the original +Y axis points to -Z (north), which matches image row 0 = north.
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    pos.setY(i, map.heightAt(x, z))
    // uv.v = 0 at the north edge (textures are loaded with flipY = false)
    uv.setXY(i, (x + map.worldWidth / 2) / map.worldWidth, (z + map.worldDepth / 2) / map.worldDepth)
  }
  pos.needsUpdate = true
  uv.needsUpdate = true
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}
