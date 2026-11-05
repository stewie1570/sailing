type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type FullscreenEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

function doc(): FullscreenDoc {
  return document as FullscreenDoc
}

export function fullscreenElement() {
  return document.fullscreenElement ?? doc().webkitFullscreenElement ?? null
}

export function canFullscreen() {
  const el = document.documentElement as FullscreenEl
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
}

export async function enterFullscreen() {
  const el = document.documentElement as FullscreenEl
  if (el.requestFullscreen) await el.requestFullscreen()
  else el.webkitRequestFullscreen?.()
}

/** Leave fullscreen if the page is in it. Safe to call when it is not. */
export function exitFullscreen() {
  if (!fullscreenElement()) return
  const leaving = document.exitFullscreen?.() ?? doc().webkitExitFullscreen?.()
  void Promise.resolve(leaving).catch(() => {})
}
