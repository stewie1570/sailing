export type HelmDir = 'forward' | 'back' | 'port' | 'starboard'

const held: Record<HelmDir, Set<string>> = {
  forward: new Set(),
  back: new Set(),
  port: new Set(),
  starboard: new Set(),
}

/** One source (keys, on-screen pad) can hold a direction without clearing the other. */
export function setHelm(source: string, dir: HelmDir, down: boolean) {
  const set = held[dir]
  if (down) set.add(source)
  else set.delete(source)
}

export function clearHelmSource(source: string) {
  for (const set of Object.values(held)) set.delete(source)
}

/** Throttle +1 ahead / −1 astern. Turn +1 to port, which increases yaw. */
export function helmInput(): { throttle: number; turn: number } {
  const throttle = (held.forward.size > 0 ? 1 : 0) - (held.back.size > 0 ? 1 : 0)
  const turn = (held.port.size > 0 ? 1 : 0) - (held.starboard.size > 0 ? 1 : 0)
  return { throttle, turn }
}
