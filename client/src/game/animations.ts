// ── Animations (the GSAP juice) ───────────────────────────────────────
// Everything that moves cards over time: the deck-deal cascade + "Annonces"
// banner (and the action-lock gate around them), fly-to-pli on play, hand
// re-fan, the trick sweep to the winner, and opponent-stack reconciliation.

import { gsap } from 'gsap'
import { ANIMATION } from './uiConfig.js'
import {
  computeScale, cfg, cardW, cardH, playfield, layoutHand, pliOffset, platePos,
} from './layout.js'
import type { Placement } from './layout.js'
import { handNodes, pliNodes, root } from './nodes.js'
import type { CardNode } from './nodes.js'
import { makeCardNode, setNodeFace, place } from './cards.js'
import { state, seatBySocket } from './state.js'
import { soundPlay } from '../audio/soundManager.js'
import type { Position, Rank, Suit, Card } from '../../../shared/types.js'

// Pli cards stack above the hands; each card's z is fixed to its play order at
// drop time (1st played sits under the 2nd, etc.) so they never re-clip on reflow.
const PLI_Z_BASE = 64

// Re-fan a hand into its current layout (used after a card leaves it).
export function reflowHand(pos: Position, animate: boolean): void {
  const layout = layoutHand(pos, handNodes[pos].length)
  handNodes[pos].forEach((node, i) => place(node.el, layout[i][0], layout[i][1], layout[i][2], layout[i][3], animate))
}

// Per-hand fan z-bases (mirror dealCascade's finalZ: south 32, west 40, north 48,
// east 56, each +i so a higher index sits on top; all below the pli at PLI_Z_BASE).
// Re-applied whenever a hand's node order changes outside the deal cascade: after the
// play-start re-sort (south), and on the session-restore snap-in (all four — no
// cascade runs to assign z there). Without this the left→right stacking breaks and a
// card's top-left index hides under its right neighbour.
const HAND_Z_BASE: Record<Position, number> = { south: 32, west: 40, north: 48, east: 56 }
export function restackHand(pos: Position): void {
  handNodes[pos].forEach((node, i) => { node.el.style.zIndex = String(HAND_Z_BASE[pos] + i) })
}
export function restackHands(): void {
  for (const pos of ['south', 'west', 'north', 'east'] as Position[]) restackHand(pos)
}
export const restackSouthHand = (): void => restackHand('south')

// ── Deal-animation gate ───────────────────────────────────────────────
// The bid UI must stay hidden until the deal + "Annonces" banner finish.
// game:dealt is async (`await initGame`), so the initial bid:state can fire
// *during* the await, before dealCascade runs — hence lockForDeal() is called
// synchronously by the game:dealt handler before the await, and dealCascade
// only ever sets the flag (never clears a callback queued meanwhile).
let dealTl: gsap.core.Timeline | null = null
let dealAnimating = false
let pendingAfterDeal: (() => void) | null = null
let annonceEl: HTMLDivElement | null = null

/** Lock the bid UI for an imminent deal. Call before any `await` in the deal path. */
export function lockForDeal(): void { dealAnimating = true; pendingAfterDeal = null }
/** Run `cb` now if no deal is animating, else once the deal + Annonces finish. */
export function runAfterDeal(cb: () => void): void {
  if (dealAnimating) pendingAfterDeal = cb
  else cb()
}
function finishDeal(): void {
  dealAnimating = false
  const cb = pendingAfterDeal
  pendingAfterDeal = null
  cb?.()
}
function getAnnonce(): HTMLDivElement {
  if (!annonceEl) {
    annonceEl = document.createElement('div')
    annonceEl.className = 'g-annonce'
    annonceEl.textContent = 'Annonces'
    root!.appendChild(annonceEl)
  }
  gsap.set(annonceEl, { xPercent: -50, yPercent: -50, opacity: 0, x: 0 })
  return annonceEl
}

/** Deck-deal (tuned in proto/deal-anim.html): stack every freshly-built card on a
 *  central deck, then fly them out index-major / seat-minor so the four hands fill
 *  in parallel. One deck shadow replaces the 32 stacked card shadows; south cards
 *  flip face-up mid-flight; then the "Annonces" banner plays and unlocks the UI. */
export function dealCascade(): void {
  computeScale()
  dealAnimating = true
  const d = ANIMATION.deal, fl = ANIMATION.flip, a = ANIMATION.annonce, area = playfield()
  const deckX = area.centerX - cardW / 2, deckY = area.centerY + cardH * d.deckOffsetY - cardH / 2
  const order = ['south', 'west', 'north', 'east'] as Position[]
  const total = order.reduce((n, pos) => n + handNodes[pos].length, 0)

  // One shadow for the whole stack (a per-card drop-shadow ×32 piles up too dark).
  root!.querySelector('.g-deck-shadow')?.remove()
  const deckShadow = document.createElement('div')
  deckShadow.className = 'g-deck-shadow'
  deckShadow.style.width = cardW + 'px'; deckShadow.style.height = cardH + 'px'
  root!.appendChild(deckShadow)
  gsap.set(deckShadow, { x: deckX, y: deckY, scale: d.deckScale })

  // Stack every card on the deck — no per-card shadow while piled; z-index so the
  // next card to deal sits on top. Each card's final z (above the deck, DOM order)
  // is applied at liftoff so it never pops on landing.
  const layouts: Record<Position, Placement[]> = { south: [], west: [], north: [], east: [] }
  const finalZ = new Map<CardNode, number>()
  for (const pos of order) {
    layouts[pos] = layoutHand(pos, handNodes[pos].length)
    handNodes[pos].forEach((node, i) => {
      const dealOrder = i * order.length + order.indexOf(pos)
      node.el.classList.add('no-shadow')
      gsap.set(node.el, { x: deckX, y: deckY, rotation: d.fromRotation, scale: d.deckScale, zIndex: total - dealOrder })
      finalZ.set(node, total + order.indexOf(pos) * 8 + i)
    })
  }

  dealTl?.kill()
  const tl = gsap.timeline({ onComplete: finishDeal })
  dealTl = tl
  const maxLen = Math.max(...order.map(pos => handNodes[pos].length))
  let k = 0
  for (let i = 0; i < maxLen; i++) {
    for (const pos of order) {
      const node = handNodes[pos][i]
      if (!node) continue
      const [x, y, rot, scale] = layouts[pos][i], at = k * d.stagger
      const liftoff = (): void => { node.el.classList.remove('no-shadow'); node.el.style.zIndex = String(finalZ.get(node)) }
      if (pos === 'south' && node.rank && node.suit) {
        // Travel drives scaleY (size); the flip drives scaleX independently so the
        // card squishes edge-on, swaps to its face at the pinch, then opens back out.
        const half = fl.duration / 2, flipAt = at + fl.start * d.perCardDuration
        const rank = node.rank, suit = node.suit
        tl.to(node.el, { x: x - cardW / 2, y: y - cardH / 2, rotation: rot, scaleY: scale,
                         duration: d.perCardDuration, ease: d.ease, onStart: liftoff }, at)
        tl.to(node.el, { scaleX: 0,     duration: half, ease: fl.ease, onComplete: () => setNodeFace(node, rank, suit) }, flipAt)
        tl.to(node.el, { scaleX: scale, duration: half, ease: fl.ease }, flipAt + half)
      } else {
        tl.to(node.el, { x: x - cardW / 2, y: y - cardH / 2, rotation: rot, scale,
                         duration: d.perCardDuration, ease: d.ease, onStart: liftoff }, at)
      }
      k++
    }
  }

  // Deck shadow leaves WITH the last card (fade at its liftoff, not its landing).
  const lastLiftoff = (k - 1) * d.stagger
  tl.to(deckShadow, { opacity: 0, duration: 0.25, ease: 'power1.out', onComplete: () => deckShadow.remove() }, lastLiftoff)

  // "Annonces" banner: pause → slide in (right→centre) → hold → slide out (→left) → pause → unlock.
  const banner = getAnnonce(), winW = window.innerWidth
  tl.addLabel('dealt')
  tl.set(banner, { opacity: 1, x: a.enterFrom * winW }, `dealt+=${a.pauseBefore}`)
  tl.to(banner, { x: 0, duration: a.enterDuration, ease: a.enterEase })
  tl.to(banner, { x: a.exitTo * winW, duration: a.exitDuration, ease: a.exitEase, delay: a.hold })
  tl.set(banner, { opacity: 0 })
  tl.to({}, { duration: a.pauseAfter })
}

// Move a card from its hand into the pli with a fly tween; reveal opponents.
export function flyToPli(pos: Position, node: CardNode, socketId: string, reveal?: Card): void {
  const idx = handNodes[pos].indexOf(node)
  if (idx >= 0) handNodes[pos].splice(idx, 1)
  if (reveal) setNodeFace(node, reveal.rank, reveal.suit)
  node.el.classList.remove('valid', 'invalid', 'lift')
  if (socketId !== state.mySocketId) soundPlay()   // my own card already sounded in playCard
  pliNodes.push({ from: pos, socketId, node })
  node.el.style.zIndex = String(PLI_Z_BASE + pliNodes.length)   // fixed by play order, set once
  const area = playfield(), off = pliOffset(pos)
  place(node.el, area.centerX + off[0], area.centerY + off[1], (pliNodes.length - 1 - 1.5) * cfg.pli.rot, 1, true)
  if (idx >= 0) reflowHand(pos, true)
}

// Fly any trick card not yet shown in the pli (e.g. an opponent's card, or the
// 4th completing card which only arrives via trick:won — never play:state).
export function flyMissingTrickCards(trick: { socketId: string; rank: Rank; suit: Suit }[]): void {
  for (const played of trick) {
    if (pliNodes.some(p => p.socketId === played.socketId)) continue
    const seat = seatBySocket(played.socketId)
    if (!seat) continue
    if (seat.isMe) {
      flyToPli('south', makeCardNode(played.rank, played.suit, true), played.socketId)
    } else {
      const handFor = handNodes[seat.position]
      const node = handFor[handFor.length - 1]
      if (node) flyToPli(seat.position, node, played.socketId, { rank: played.rank, suit: played.suit })
      else      flyToPli(seat.position, makeCardNode(played.rank, played.suit, true), played.socketId)
    }
  }
}

// Sweep the 4 pli cards toward the winner's plate, then remove them.
export function sweepTrick(winnerSocketId: string): void {
  const winner = seatBySocket(winnerSocketId)
  const [wx, wy] = winner ? platePos[winner.position]() : [playfield().centerX, playfield().centerY]
  const swept = [...pliNodes]
  const els = swept.map(p => p.node.el)
  pliNodes.length = 0
  if (!els.length) return
  gsap.to(els, {
    x: wx - cardW / 2, y: wy - cardH / 2, rotation: winner?.position === 'north' ? 180 : 0,
    scale: ANIMATION.sweep.toScale, opacity: 0,
    duration: ANIMATION.sweep.duration, ease: ANIMATION.sweep.ease, stagger: ANIMATION.sweep.stagger,
    onComplete: () => swept.forEach(p => p.node.el.remove()),
  })
}

// Add/remove face-down nodes so an opponent's stack matches its true count.
export function reconcileOpponentCount(pos: Position, target: number): void {
  const nodes = handNodes[pos]
  while (nodes.length > target) { const n = nodes.pop(); n?.el.remove() }
  while (nodes.length < target) { nodes.push(makeCardNode(null, null, false)) }
  reflowHand(pos, true)
}
