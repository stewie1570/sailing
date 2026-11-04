import { useSyncExternalStore } from 'react'

export interface AisReceived {
  fromId: string
  fromName: string
  text: string
}

export interface AisMailView {
  peerId: string | null
  peerName: string
  /** The one hail shown in the open note. Empty when this note was opened to write first. */
  receivedText: string
  /** A hail waiting above the chart. Absent while the note is open, or after it is closed. */
  banner: AisReceived | null
  error: string | null
}

let incoming: AisReceived | null = null
let peerId: string | null = null
let peerName = ''
let error: string | null = null
/** True while the shared chart is expanded. A hail then opens the note; otherwise it waits on the chart. */
let chartWide = false
let view: AisMailView = snapshot()
const listeners = new Set<() => void>()

function snapshot(): AisMailView {
  const mine = incoming && peerId === incoming.fromId ? incoming.text : ''
  return {
    peerId,
    peerName,
    receivedText: mine,
    banner: incoming && !peerId ? incoming : null,
    error,
  }
}

function publish() {
  view = snapshot()
  listeners.forEach((listener) => listener())
}

export function setAisChartWide(wide: boolean) {
  chartWide = wide
}

/** Open the note addressed to this boat. */
export function openAis(id: string, name: string) {
  if (!id) return
  peerId = id
  peerName = name.trim() || 'Sailor'
  error = null
  publish()
}

/** Close the note and drop the hail. Nothing is kept. */
export function closeAis() {
  if (!peerId && !incoming && !error) return
  peerId = null
  peerName = ''
  incoming = null
  error = null
  publish()
}

export function setAisError(message: string | null) {
  error = message
  publish()
}

/**
 * The other boat hailed us. Only this text is kept.
 * An expanded chart opens the note. A small chart leaves it above the chart until it is tapped.
 * A note that is already open shows the new text instead.
 */
export function receiveAis(fromId: string, fromName: string, text: string) {
  const body = text.trim()
  if (!fromId || !body) return
  const name = fromName.trim() || 'Sailor'
  incoming = { fromId, fromName: name, text: body }
  error = null
  if (chartWide || peerId) {
    peerId = fromId
    peerName = name
  }
  publish()
}

export function clearAis() {
  if (!incoming && !peerId && !error) return
  incoming = null
  peerId = null
  peerName = ''
  error = null
  publish()
}

export function useAisMail(): AisMailView {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => view,
  )
}
