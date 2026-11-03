import { useSyncExternalStore } from 'react'

export interface AisLine {
  id: number
  text: string
  /** True when this helm sent the line. */
  mine: boolean
}

interface Thread {
  peerName: string
  notes: AisLine[]
  draft: string
}

export interface AisMailView {
  peerId: string | null
  peerName: string
  notes: readonly AisLine[]
  draft: string
  error: string | null
}

const EMPTY: readonly AisLine[] = []
const threads = new Map<string, Thread>()
let openId: string | null = null
let error: string | null = null
let seq = 0
let view: AisMailView = snapshot()
const listeners = new Set<() => void>()

function snapshot(): AisMailView {
  const thread = openId ? threads.get(openId) : undefined
  return {
    peerId: openId,
    peerName: thread?.peerName ?? '',
    notes: thread?.notes ?? EMPTY,
    draft: thread?.draft ?? '',
    error,
  }
}

function publish() {
  view = snapshot()
  listeners.forEach((listener) => listener())
}

function ensure(peerId: string, peerName: string) {
  const name = peerName.trim() || 'Sailor'
  let thread = threads.get(peerId)
  if (!thread) {
    thread = { peerName: name, notes: [], draft: '' }
    threads.set(peerId, thread)
  } else if (name) {
    thread.peerName = name
  }
  return thread
}

/** Open the note addressed to this boat. A draft already started is still there. */
export function openAis(peerId: string, peerName: string) {
  if (!peerId) return
  ensure(peerId, peerName)
  openId = peerId
  error = null
  publish()
}

export function closeAis() {
  if (!openId && !error) return
  openId = null
  error = null
  publish()
}

/** The draft currently in the open note. Read from effects, not during render. */
export function currentAisDraft(): string {
  return view.draft
}

export function setAisDraft(peerId: string, draft: string) {
  const thread = threads.get(peerId)
  if (!thread || thread.draft === draft) return
  thread.draft = draft
  if (openId === peerId) publish()
}

export function setAisError(message: string | null) {
  error = message
  publish()
}

/** Keep a line this helm just handed to the room. */
export function rememberSent(peerId: string, text: string) {
  const thread = threads.get(peerId)
  if (!thread) return
  thread.notes = [...thread.notes, { id: ++seq, text, mine: true }].slice(-24)
  thread.draft = ''
  error = null
  publish()
}

/** The other boat hailed us. Open the same note, with their line in it. */
export function receiveAis(fromId: string, fromName: string, text: string) {
  const body = text.trim()
  if (!fromId || !body) return
  const thread = ensure(fromId, fromName)
  thread.notes = [...thread.notes, { id: ++seq, text: body, mine: false }].slice(-24)
  openId = fromId
  error = null
  publish()
}

export function clearAis() {
  if (threads.size === 0 && !openId && !error) return
  threads.clear()
  openId = null
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
