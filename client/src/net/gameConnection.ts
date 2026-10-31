import * as signalR from '@microsoft/signalr'
import { useSyncExternalStore } from 'react'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface ConnectionState {
  status: ConnectionStatus
  playerId: string | null
  online: number
  latencyMs: number | null
  error: string | null
}

interface WelcomeMessage { playerId: string; serverTime: string; online: number }
interface PongMessage { clientSentAt: number; serverTime: number }

let state: ConnectionState = { status: 'connecting', playerId: null, online: 0, latencyMs: null, error: null }
const listeners = new Set<() => void>()
function update(patch: Partial<ConnectionState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

let connection: signalR.HubConnection | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null

/** Idempotent: creates the hub connection on first call and keeps it alive with automatic reconnects. */
export function startGameConnection(): signalR.HubConnection {
  if (connection) return connection

  connection = new signalR.HubConnectionBuilder()
    .withUrl('/hubs/game')
    .withAutomaticReconnect([0, 1000, 3000, 5000, 10000, 15000, 30000])
    .configureLogging(signalR.LogLevel.Warning)
    .build()

  connection.on('Welcome', (msg: WelcomeMessage) => update({ playerId: msg.playerId, online: msg.online }))
  connection.on('PlayerJoined', (_id: string, online: number) => update({ online }))
  connection.on('PlayerLeft', (_id: string, online: number) => update({ online }))
  connection.on('PlayerRenamed', () => { /* no boats to label yet */ })

  connection.onreconnecting((err) => update({ status: 'reconnecting', error: err?.message ?? null }))
  connection.onreconnected(() => update({ status: 'connected', error: null }))
  connection.onclose((err) => {
    update({ status: 'disconnected', error: err?.message ?? null })
    stopPing()
    // Automatic reconnect gave up (or the server closed us); retry from scratch after a pause.
    setTimeout(() => void connect(), 10000)
  })

  void connect()
  return connection
}

async function connect() {
  if (!connection || connection.state !== signalR.HubConnectionState.Disconnected) return
  update({ status: 'connecting' })
  try {
    await connection.start()
    update({ status: 'connected', error: null })
    startPing()
  } catch (err) {
    update({ status: 'disconnected', error: err instanceof Error ? err.message : String(err) })
    setTimeout(() => void connect(), 5000)
  }
}

function startPing() {
  stopPing()
  const ping = async () => {
    if (!connection || connection.state !== signalR.HubConnectionState.Connected) return
    const sent = performance.now()
    try {
      await connection.invoke<PongMessage>('Ping', Date.now())
      update({ latencyMs: Math.round(performance.now() - sent) })
    } catch {
      /* transient; the next tick will retry */
    }
  }
  void ping()
  pingTimer = setInterval(() => void ping(), 5000)
}

function stopPing() {
  if (pingTimer) clearInterval(pingTimer)
  pingTimer = null
}

export function useConnection(): ConnectionState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => state,
  )
}
