import { boatShape, type BoatShape } from './geometry'
import { ferryShape } from './ferryGeometry'
import { vesselKind, type VesselKind } from './vessel'

/** Static outline for a hull. Remote boats are tested with this, not resimulated. */
export function hullShape(kind: VesselKind | string | undefined): BoatShape {
  return vesselKind(kind) === 'ferry' ? ferryShape() : boatShape()
}
