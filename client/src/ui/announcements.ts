import { byId } from '../core/dom.js'

// Per-element auto-hide timers (replaces the old el._hideTimer custom property).
const hideTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

/** Restart a CSS slam/pop animation from frame 0 (force-reflow trick) and unhide. */
export function slamIn(el: HTMLElement): void {
  el.classList.remove('hidden')
  el.style.animation = 'none'
  void el.offsetHeight  // force reflow so the animation restarts
  el.style.animation = ''
}

/** Hide `el` after `ms`, cancelling any pending hide for it. */
export function scheduleHide(el: HTMLElement, ms: number): void {
  const prev = hideTimers.get(el)
  if (prev) clearTimeout(prev)
  hideTimers.set(el, setTimeout(() => el.classList.add('hidden'), ms))
}

/** Slam-in an announcement element (by id), optionally set its text, auto-hide after `duration`. */
export function flashAnnouncement(id: string, text?: string, duration = 2000): void {
  const el = byId(id)
  if (text !== undefined) el.textContent = text
  slamIn(el)
  scheduleHide(el, duration)
}
