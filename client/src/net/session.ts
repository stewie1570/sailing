import * as signalR from '@microsoft/signalr'
import { useSyncExternalStore } from 'react'
import { resetHelm } from '../scene/boat/helm'
import { resetSail } from '../scene/boat/sail'
import { followWind, getWind, releaseWind, resetWind } from '../scene/boat/wind'
import {
  MAX_SAILORS,
  isRoomCode,
  randomCode,
  randomPlayerId,
  sailorName,
  type RoomMessage,
  type Seat,
  type ShipMessage,
  type ShipVisual,
  type WindSample,
} from './protocol'

export type PlayRole = 'solo' | 'host' | 'guest'
export type LinkStatus = 'off' | 'connecting' | 'up' | 'down'

export interface SessionState {
  phase: 'menu' | 'connecting' | 'sailing'
  role: PlayRole | null
  code: string | null
  playerId: string
  name: string
  error: string | null
  notice: string | null
  latencyMs: number | null
  link: LinkStatus
  roster: readonly Seat[]
}

const NAME_KEY = 'sailing.sailor'
const JOIN_WAIT_MS = 4000
const SHIP_MS = 100
const WIND_MS = 250
const ROSTER_MS = 100
const STALE_SHIP_MS = 3000

interface RemoteShip extends ShipMessage {
  at: number
}

let state: SessionState = {
  phase: 'menu',
  role: null,
  code: null,
  playerId: randomPlayerId(),
  name: loadName(),
  error: null,
  notice: null,
  latencyMs: null,
  link: 'off',
  roster: [],
}

const listeners = new Set<() => void>()

function update(patch: Partial<SessionState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

export function useSession(): SessionState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

/** Spawn index for this device. Captured when the lake mounts; later roster edits must not move the hull. */
export function useMySlot(): number {
  const session = useSession()
  if (session.role !== 'guest') return 0
  return session.roster.find((seat) => seat.playerId === session.playerId)?.slot ?? 0
}

const ships = new Map<string, RemoteShip>()
let shipOrder: readonly string[] = []
const shipListeners = new Set<() => void>()

export function useRemoteShipIds(): readonly string[] {
  return useSyncExternalStore(
    (cb) => {
      shipListeners.add(cb)
      return () => shipListeners.delete(cb)
    },
    () => shipOrder,
  )
}

export function remoteShip(playerId: string): RemoteShip | undefined {
  return ships.get(playerId)
}

export function shipIsFresh(playerId: string, now = performance.now()): boolean {
  const ship = ships.get(playerId)
  return !!ship && now - ship.at < STALE_SHIP_MS
}

const localShip: ShipVisual & { fresh: boolean } = {
  fresh: false,
  x: 0,
  z: 0,
  yaw: 0,
  rudder: 0,
  port: 0,
  starboard: 0,
  hoist: 0,
  boom: 0,
  jibHoist: 0,
  clew: 0,
  vane: 0,
  luff: 0,
  jibLuff: 0,
}

/** Written every sim frame. The network loop copies it; the sim does not wait on the socket. */
export function noteLocalShip(
  x: number,
  z: number,
  yaw: number,
  rudder: number,
  port: number,
  starboard: number,
  hoist: number,
  boom: number,
  jibHoist: number,
  clew: number,
  vane: number,
  luff: number,
  jibLuff: number,
) {
  localShip.x = x
  localShip.z = z
  localShip.yaw = yaw
  localShip.rudder = rudder
  localShip.port = port
  localShip.starboard = starboard
  localShip.hoist = hoist
  localShip.boom = boom
  localShip.jibHoist = jibHoist
  localShip.clew = clew
  localShip.vane = vane
  localShip.luff = luff
  localShip.jibLuff = jibLuff
  localShip.fresh = true
}

let connection: signalR.HubConnection | null = null
let op = 0
let suppressClose = 0
let hostSeats: Seat[] = []
let joinTimer: ReturnType<typeof setTimeout> | null = null
let joinExtended = false
let rosterTimer: ReturnType<typeof setTimeout> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
let shipTimer: ReturnType<typeof setInterval> | null = null
let windTimer: ReturnType<typeof setInterval> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let nextPresentAt = 0

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberName(raw: string) {
  const name = sailorName(raw)
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    /* private mode */
  }
  return name
}

function clearShips() {
  if (ships.size === 0) return
  ships.clear()
  shipOrder = []
  shipListeners.forEach((listener) => listener())
}

function rememberShip(ship: ShipMessage) {
  if (ship.playerId === state.playerId) return
  const known = ships.get(ship.playerId)
  if (known) {
    known.name = ship.name
    known.x = ship.x
    known.z = ship.z
    known.yaw = ship.yaw
    known.rudder = ship.rudder
    known.port = ship.port
    known.starboard = ship.starboard
    known.hoist = ship.hoist
    known.boom = ship.boom
    known.jibHoist = ship.jibHoist
    known.clew = ship.clew
    known.vane = ship.vane
    known.luff = ship.luff
    known.jibLuff = ship.jibLuff
    known.at = performance.now()
    return
  }
  ships.set(ship.playerId, { ...ship, at: performance.now() })
  shipOrder = [...ships.keys()]
  shipListeners.forEach((listener) => listener())
}

function forgetShip(playerId: string) {
  if (!ships.delete(playerId)) return
  shipOrder = [...ships.keys()]
  shipListeners.forEach((listener) => listener())
}

function clearJoinTimeout() {
  if (joinTimer) clearTimeout(joinTimer)
  joinTimer = null
}

function armJoinTimeout() {
  clearJoinTimeout()
  joinTimer = setTimeout(() => {
    joinTimer = null
    if (state.phase === 'sailing') return
    void drop('No room with that code.')
  }, JOIN_WAIT_MS)
}

function clearRoomClose() {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = null
}

function armRoomClose() {
  if (closeTimer) return
  closeTimer = setTimeout(() => {
    closeTimer = null
    if (state.role !== 'guest') return
    void drop('The host left.')
  }, 5000)
}

function stopOutbound() {
  if (shipTimer) clearInterval(shipTimer)
  if (windTimer) clearInterval(windTimer)
  shipTimer = null
  windTimer = null
  if (rosterTimer) clearTimeout(rosterTimer)
  rosterTimer = null
}

function stopPing() {
  if (pingTimer) clearInterval(pingTimer)
  pingTimer = null
}

async function shutdown() {
  clearJoinTimeout()
  clearRoomClose()
  stopOutbound()
  stopPing()
  const conn = connection
  connection = null
  if (!conn) return
  suppressClose++
  try {
    await conn.stop()
  } catch {
    /* already stopped */
  } finally {
    suppressClose--
  }
}

function resetMatch(notice: string | null) {
  hostSeats = []
  localShip.fresh = false
  clearShips()
  releaseWind()
  clearJoinTimeout()
  clearRoomClose()
  update({
    phase: 'menu',
    role: null,
    code: null,
    error: null,
    notice,
    latencyMs: null,
    link: 'off',
    roster: [],
  })
}

function faultText(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const message = err.message.trim()
    if (message && message.length < 140 && !/negotiation|websocket|network|failed to fetch/i.test(message)) {
      return message
    }
  }
  return fallback
}

function publishRoster() {
  update({ roster: hostSeats.map((seat) => ({ ...seat })) })
}

function freeSlot(seats: readonly Seat[]): number {
  const used = new Set(seats.map((seat) => seat.slot))
  let slot = 0
  while (used.has(slot)) slot++
  return slot
}

function scheduleRosterBroadcast() {
  if (rosterTimer) return
  rosterTimer = setTimeout(() => {
    rosterTimer = null
    void broadcastRoster()
  }, ROSTER_MS)
}

async function broadcastRoster() {
  const conn = connection
  if (!conn || state.role !== 'host' || state.code == null) return
  if (conn.state !== signalR.HubConnectionState.Connected) return
  const wind = getWind()
  const message: RoomMessage = {
    code: state.code,
    seats: hostSeats.map((seat) => ({ ...seat })),
    wind: { blowYaw: round(wind.blowYaw, 4), speed: round(wind.speed, 3), shifting: wind.shifting },
  }
  try {
    await conn.invoke('Room', message)
  } catch {
    /* the next change sends another snapshot */
  }
}

function acceptHost() {
  hostSeats = [{ playerId: state.playerId, name: state.name, host: true, slot: 0 }]
  publishRoster()
  update({ phase: 'sailing', link: 'up', error: null, notice: null })
  startOutbound()
  scheduleRosterBroadcast()
}

function startOutbound() {
  stopOutbound()
  shipTimer = setInterval(() => void sendShip(), SHIP_MS)
  if (state.role === 'host') windTimer = setInterval(() => void sendWind(), WIND_MS)
}

async function sendShip() {
  const conn = connection
  if (!localShip.fresh || !conn || state.phase !== 'sailing') return
  if (state.role !== 'host' && state.role !== 'guest') return
  if (conn.state !== signalR.HubConnectionState.Connected) return
  const message: ShipMessage = {
    playerId: state.playerId,
    name: state.name,
    x: round(localShip.x, 2),
    z: round(localShip.z, 2),
    yaw: round(localShip.yaw, 4),
    rudder: round(localShip.rudder, 3),
    port: round(localShip.port, 3),
    starboard: round(localShip.starboard, 3),
    hoist: round(localShip.hoist, 3),
    boom: round(localShip.boom, 4),
    jibHoist: round(localShip.jibHoist, 3),
    clew: round(localShip.clew, 4),
    vane: round(localShip.vane, 4),
    luff: round(localShip.luff, 3),
    jibLuff: round(localShip.jibLuff, 3),
  }
  try {
    await conn.invoke('Ship', message)
  } catch {
    /* next tick */
  }
}

async function sendWind() {
  const conn = connection
  if (!conn || state.role !== 'host' || conn.state !== signalR.HubConnectionState.Connected) return
  const wind = getWind()
  const message: WindSample = {
    blowYaw: round(wind.blowYaw, 4),
    speed: round(wind.speed, 3),
    shifting: wind.shifting,
  }
  try {
    await conn.invoke('Wind', message)
  } catch {
    /* next tick */
  }
}

function round(value: number, places: number) {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

function onPeerArrived(playerId: string, name: string, hostClaim: boolean) {
  if (state.role !== 'host' || playerId === state.playerId) return
  if (hostClaim) {
    void dismiss(playerId, 'taken')
    return
  }
  const existing = hostSeats.find((seat) => seat.playerId === playerId)
  if (existing) {
    existing.name = name
    publishRoster()
    scheduleRosterBroadcast()
    return
  }
  if (hostSeats.length >= MAX_SAILORS) {
    void dismiss(playerId, 'full')
    return
  }
  hostSeats.push({ playerId, name, host: false, slot: freeSlot(hostSeats) })
  publishRoster()
  scheduleRosterBroadcast()
}

function onPeerLeft(playerId: string) {
  forgetShip(playerId)
  if (state.role === 'host') {
    const next = hostSeats.filter((seat) => seat.playerId !== playerId)
    if (next.length === hostSeats.length) return
    hostSeats = next
    publishRoster()
    scheduleRosterBroadcast()
    return
  }
  if (state.role === 'guest' && state.roster.some((seat) => seat.playerId === playerId && seat.host)) {
    armRoomClose()
  }
}

function onRoom(room: RoomMessage) {
  if (state.role !== 'guest' || room.code !== state.code) return
  const seats = Array.isArray(room.seats) ? room.seats : []
  const wind = room.wind
  if (wind && Number.isFinite(wind.blowYaw) && Number.isFinite(wind.speed)) {
    followWind(wind.blowYaw, wind.speed, !!wind.shifting, state.phase !== 'sailing')
  }
  const mine = seats.some((seat) => seat.playerId === state.playerId)
  if (!mine) {
    if (state.phase === 'sailing') requestPresent()
    return
  }
  clearJoinTimeout()
  clearRoomClose()
  for (const id of shipOrder) {
    if (!seats.some((seat) => seat.playerId === id)) forgetShip(id)
  }
  update({
    phase: 'sailing',
    link: 'up',
    roster: seats.map((seat) => ({ ...seat })),
    error: null,
    notice: null,
  })
}

function onWind(wind: WindSample) {
  if (state.role !== 'guest') return
  if (!Number.isFinite(wind.blowYaw) || !Number.isFinite(wind.speed)) return
  followWind(wind.blowYaw, wind.speed, !!wind.shifting, false)
}

function onHostReady() {
  if (state.role !== 'guest') return
  clearRoomClose()
  requestPresent()
  if (state.phase !== 'sailing' && !joinExtended) {
    joinExtended = true
    armJoinTimeout()
  }
}

function requestPresent() {
  const conn = connection
  if (!conn || conn.state !== signalR.HubConnectionState.Connected) return
  const now = performance.now()
  if (now < nextPresentAt) return
  nextPresentAt = now + 2000
  void conn.invoke('Present').catch(() => {})
}

async function dismiss(playerId: string, reason: 'full' | 'taken') {
  const conn = connection
  if (!conn || conn.state !== signalR.HubConnectionState.Connected) return
  try {
    await conn.invoke('Dismiss', playerId, reason)
  } catch {
    /* they will time out on their side */
  }
}

function onDismissed(playerId: string, reason: string) {
  if (playerId !== state.playerId) return
  void drop(reason === 'full' ? 'That room is full.' : 'That code is already in use.')
}

function onRoomClosed() {
  if (state.role !== 'guest') return
  void drop('The host left.')
}

function wire(conn: signalR.HubConnection) {
  conn.on('HostReady', onHostReady)
  conn.on('PeerArrived', onPeerArrived)
  conn.on('PeerLeft', onPeerLeft)
  conn.on('Room', onRoom)
  conn.on('Ship', (ship: ShipMessage) => {
    if (!ship || ship.playerId === state.playerId) return
    if (state.role !== 'host' && state.role !== 'guest') return
    rememberShip(ship)
  })
  conn.on('Wind', onWind)
  conn.on('Dismissed', onDismissed)
  conn.on('RoomClosed', onRoomClosed)
  conn.onreconnecting(() => {
    if (connection === conn) update({ link: 'down' })
  })
  conn.onreconnected(() => {
    void reenter(conn)
  })
  conn.onclose(() => {
    if (suppressClose > 0 || connection !== conn) return
    connection = null
    stopPing()
    if (state.phase === 'menu') return
    stopOutbound()
    resetMatch('Connection lost.')
  })
}

async function reenter(conn: signalR.HubConnection) {
  try {
    if (state.role === 'host' && state.code) {
      await conn.invoke('Host', state.code, state.playerId, state.name)
      if (connection !== conn) return
      acceptHost()
    } else if (state.role === 'guest' && state.code) {
      await conn.invoke('Join', state.code, state.playerId, state.name)
      if (connection !== conn) return
      update({ link: 'up' })
      if (state.phase !== 'sailing') armJoinTimeout()
    }
  } catch {
    /* onclose takes us back to the menu if the socket is really gone */
  }
}

function startPing(conn: signalR.HubConnection) {
  stopPing()
  const ping = async () => {
    if (conn.state !== signalR.HubConnectionState.Connected) return
    const sent = performance.now()
    try {
      await conn.invoke('Ping', Date.now())
      if (connection === conn) update({ latencyMs: Math.round(performance.now() - sent) })
    } catch {
      /* next tick */
    }
  }
  void ping()
  pingTimer = setInterval(() => void ping(), 5000)
}

async function connect(token: number): Promise<signalR.HubConnection> {
  await shutdown()
  if (token !== op) throw new Error('cancelled')
  const conn = new signalR.HubConnectionBuilder()
    .withUrl('/hubs/game')
    .withAutomaticReconnect([0, 1000, 3000, 5000])
    .configureLogging(signalR.LogLevel.Warning)
    .build()
  wire(conn)
  connection = conn
  update({ link: 'connecting', error: null, notice: null })
  await conn.start()
  if (token !== op) {
    suppressClose++
    try {
      await conn.stop()
    } finally {
      suppressClose--
    }
    throw new Error('cancelled')
  }
  startPing(conn)
  return conn
}

function prepareBoat() {
  localShip.fresh = false
  resetHelm()
  resetSail()
}

export function sailAlone(rawName: string) {
  op++
  void shutdown()
  const name = rememberName(rawName)
  prepareBoat()
  releaseWind()
  resetWind()
  clearShips()
  hostSeats = []
  update({
    phase: 'sailing',
    role: 'solo',
    name,
    code: null,
    error: null,
    notice: null,
    latencyMs: null,
    link: 'off',
    roster: [],
  })
}

export async function hostGame(rawName: string) {
  const token = ++op
  const name = rememberName(rawName)
  const code = randomCode()
  prepareBoat()
  releaseWind()
  resetWind()
  hostSeats = []
  clearShips()
  update({
    phase: 'connecting',
    role: 'host',
    name,
    code,
    error: null,
    notice: null,
    roster: [],
    link: 'connecting',
  })
  try {
    const conn = await connect(token)
    if (token !== op) return
    await conn.invoke('Host', code, state.playerId, name)
    if (token !== op) return
    acceptHost()
  } catch (err) {
    if (token !== op) return
    await shutdown()
    resetMatch(null)
    update({ error: faultText(err, 'Could not reach the server.') })
  }
}

export async function joinGame(rawName: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase()
  if (!isRoomCode(code)) {
    update({ error: 'Enter the 4-character code.', notice: null })
    return
  }
  const token = ++op
  const name = rememberName(rawName)
  prepareBoat()
  hostSeats = []
  clearShips()
  joinExtended = false
  nextPresentAt = 0
  update({
    phase: 'connecting',
    role: 'guest',
    name,
    code,
    error: null,
    notice: null,
    roster: [],
    link: 'connecting',
  })
  try {
    const conn = await connect(token)
    if (token !== op) return
    await conn.invoke('Join', code, state.playerId, name)
    if (token !== op) return
    update({ link: 'up' })
    if (state.phase !== 'sailing') armJoinTimeout()
    startOutbound()
  } catch (err) {
    if (token !== op) return
    await shutdown()
    resetMatch(null)
    update({ error: faultText(err, 'Could not reach the server.') })
  }
}

export async function leaveGame() {
  const token = ++op
  const conn = connection
  const role = state.role
  if (conn && conn.state === signalR.HubConnectionState.Connected) {
    try {
      if (role === 'host') await conn.invoke('CloseRoom')
      else if (role === 'guest') await conn.invoke('Leave')
    } catch {
      /* dropping the socket still tells the room */
    }
  }
  await shutdown()
  if (token !== op) return
  resetMatch(null)
}

async function drop(notice: string) {
  const token = ++op
  const conn = connection
  if (conn && conn.state === signalR.HubConnectionState.Connected) {
    try {
      await conn.invoke('Leave')
    } catch {
      /* socket is going anyway */
    }
  }
  await shutdown()
  if (token !== op) return
  resetMatch(notice)
}
