// ── Turn-timer countdown engine (client visual only) ──────────────────
// Drives the per-frame countdown on the active seat's avatar badge WITHOUT
// rebuilding chrome: each frame it finds the live `.g-timer` element (rebuilt by
// chrome.ts on events) and updates the number + ring depletion + danger colour.
// The server owns expiry — when the countdown hits 0 we just stop and wait for the
// next server state. Reads state.turnDeadline (a performance.now() target set by
// applyTurnTimer), so the clock is local and skew-free.

import { state } from './state.js'
import { root } from './nodes.js'
import { TURN_TIMER_DANGER_MS } from '../../../shared/constants.js'

const RING_C = 2 * Math.PI * 16   // circumference of the SVG ring (r=16, viewBox 36)

let rafId = 0

/** Paint the current remaining time onto the live badge (no-op if it isn't shown). */
export function paintTurnTimer(): void {
  if (state.turnDeadline == null) return
  const el = root?.querySelector('.g-timer') as HTMLElement | null
  if (!el) return
  const remaining = Math.max(0, state.turnDeadline - performance.now())
  const frac = state.turnDuration > 0 ? Math.min(1, remaining / state.turnDuration) : 0
  el.classList.toggle('danger', remaining <= TURN_TIMER_DANGER_MS)
  const num = el.querySelector('.g-timer-num')
  if (num) num.textContent = String(Math.ceil(remaining / 1000))
  const bar = el.querySelector('.g-timer-bar') as SVGElement | null
  if (bar) { bar.style.strokeDasharray = String(RING_C); bar.style.strokeDashoffset = String(RING_C * (1 - frac)) }
}

function loop(): void {
  if (state.turnDeadline == null) { rafId = 0; return }
  paintTurnTimer()
  if (state.turnDeadline - performance.now() <= 0) { rafId = 0; return }   // hit 0 → server drives next
  rafId = requestAnimationFrame(loop)
}

export function startTurnTimer(): void { if (!rafId) rafId = requestAnimationFrame(loop) }
export function stopTurnTimer(): void { if (rafId) cancelAnimationFrame(rafId); rafId = 0 }
