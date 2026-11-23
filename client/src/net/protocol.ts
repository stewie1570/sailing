/** Room codes skip letters that look like digits, so a code read across the cockpit is unambiguous. */
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 4
export const PLAYER_ID_LENGTH = 8
/** The host enforces this. The server only refuses a roster larger than it. */
export const MAX_SAILORS = 8

const ALPHABET_SIZE = ROOM_ALPHABET.length

export interface Seat {
  playerId: string
  name: string
  host: boolean
  slot: number
}

export interface WindSample {
  blowYaw: number
  speed: number
  shifting: boolean
}

export interface RoomMessage {
  code: string
  seats: Seat[]
  wind: WindSample
}

/**
 * The pose a remote helm is allowed to see. It copies this. It does not
 * resimulate the owner's screws, sails, or pods.
 * `kind` picks the mesh. Pod azimuth and thrust are the ferry's visible
 * controls, the same way `rudder` is the sloop's. They are not forces.
 */
export interface ShipVisual {
  /** Missing on an older packet. Treat that as the sloop. */
  kind?: 'sail' | 'ferry'
  x: number
  z: number
  yaw: number
  rudder: number
  port: number
  starboard: number
  hoist: number
  boom: number
  jibHoist: number
  clew: number
  vane: number
  luff: number
  jibLuff: number
  /** 0 rolled up, 1 the spinnaker fully set. The jib is furled while this is out. */
  spinHoist: number
  spinLuff: number
  /** Metres per second along the bow. Negative is astern. */
  speed: number
  /** Metres per second, lateral. */
  sway: number
  /** Metres the hull is held under the swell. 0 is afloat. */
  sink: number
  /** Player id this helm is driving into, or empty when it claims nobody. */
  ram: string
  /** Ferry pods. 0 azimuth is ahead; positive aims that push toward port. Unused on a sloop. */
  bowAz?: number
  sternAz?: number
  bowThrust?: number
  sternThrust?: number
}

export interface ShipMessage extends ShipVisual {
  playerId: string
  name: string
}

export function filterCodeInput(raw: string): string {
  let out = ''
  for (const char of raw.toUpperCase()) {
    if (!ROOM_ALPHABET.includes(char)) continue
    out += char
    if (out.length === ROOM_CODE_LENGTH) break
  }
  return out
}

export function isRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((char) => ROOM_ALPHABET.includes(char))
}

function randomFromAlphabet(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) out += ROOM_ALPHABET[byte % ALPHABET_SIZE]
  return out
}

export function randomCode(): string {
  return randomFromAlphabet(ROOM_CODE_LENGTH)
}

export function randomPlayerId(): string {
  return randomFromAlphabet(PLAYER_ID_LENGTH)
}

/** One AIS text, ship to ship. Short enough to read at the helm. */
export const AIS_TEXT_MAX = 160

/** Strip control characters, trim, and cap the length. Empty means there is nothing to send. */
export function cleanHail(raw: string): string {
  let out = ''
  for (const char of raw) {
    const code = char.charCodeAt(0)
    if (code < 32 || code === 127) continue
    out += char
    if (out.length === AIS_TEXT_MAX) break
  }
  return out.trim()
}

/** Strip control characters and cap the length. Empty stays empty so a field can be mid-edit. */
export function cleanName(raw: string): string {
  let out = ''
  for (const char of raw) {
    const code = char.charCodeAt(0)
    if (code < 32 || code === 127) continue
    out += char
    if (out.length === 16) break
  }
  return out
}

export function sailorName(raw: string): string {
  const name = cleanName(raw).trim()
  return name.length === 0 ? 'Sailor' : name
}
