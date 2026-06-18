// ════════════════════════════════════════════════════════════════════
// game/ — DOM renderer (Étape 3, juice pass). Cards are SVG <div>s that
// PERSIST across events so GSAP can tween them (deal cascade, fly-to-pli,
// hand re-fan, trick sweep, animated tap-to-confirm lift). Plates + HUD +
// confirm overlay are cheap "chrome" rebuilt each update.
//
// This module is the orchestrator: it owns the public API consumed by
// client/src/features/*.ts (state, apply*, initGame, render, setOnCardPlay,
// lockForDeal, runAfterDeal) and the apply*/layout/play-interaction glue.
// The pieces live in sibling modules:
//   state.ts  · render state + helpers      nodes.ts  · live DOM card registry
//   layout.ts · geometry / presets          cards.ts  · SVG + card factory
//   animations.ts · GSAP juice + deal gate  chrome.ts · plates / HUD / confirm
// ════════════════════════════════════════════════════════════════════

import { gsap } from 'gsap'
import { ANIMATION } from './uiConfig.js'
import { computeScale, cfg, cardH, playfield, layoutHand, pliOffset, presetName } from './layout.js'
import { handNodes, pliNodes, findSouthNode, setRoot, root } from './nodes.js'
import type { CardNode } from './nodes.js'
import { makeCardNode, setNodeFace, place } from './cards.js'
import {
  dealCascade, flyToPli, flyMissingTrickCards, sweepTrick, reconcileOpponentCount,
  restackSouthHand, restackHands,
} from './animations.js'
import { renderChrome } from './chrome.js'
import { state, ui, seatAt, seatBySocket, isValidCard, sortHand, fireCardPlay } from './state.js'
import { soundHover, soundPlay } from '../audio/soundManager.js'
import { getConfirmPlay } from '../core/settings.js'
import type {
  Rank, Suit, Card, BidInfo,
  DealtPayload, BidStatePayload, PlayStartPayload, PlayStatePayload, TrickWonPayload,
} from '../../../shared/types.js'

// ── Public API re-exports (the contract used by features/*.ts) ────────
export { state, setOnCardPlay } from './state.js'
export { lockForDeal, runAfterDeal } from './animations.js'

let initialized = false

// ── Entry ─────────────────────────────────────────────────────────────
export async function initGame(rootEl: HTMLElement, mySocketId: string | undefined): Promise<void> {
  setRoot(rootEl)
  state.mySocketId = mySocketId ?? null
  if (!initialized) {
    window.addEventListener('resize', () => render())
    initialized = true
  }
  computeScale()
  render()
}

// ── Layout (positions all persistent cards, then rebuilds chrome) ─────
// A non-animated pass (resize / applyYourTurn refresh / restore snap) must NOT snap a
// card that's currently mid-tween — e.g. an opponent's card flying into the pli when
// our own `play:your-turn` arrives the same cycle, which would teleport it to its
// landing spot. Skip the place() for any node GSAP is actively tweening; its tween is
// already headed to the right place and will finish on its own.
function layoutAll(animate: boolean): void {
  computeScale()
  if (root) { root.classList.toggle('preset-desktop', presetName === 'desktop'); root.classList.toggle('preset-portrait', presetName === 'portrait') }
  const settle = (el: HTMLElement): boolean => !animate && gsap.isTweening(el)
  for (const pos of ['north', 'west', 'east', 'south'] as const) {
    const nodes = handNodes[pos]
    const layout = layoutHand(pos, nodes.length)
    nodes.forEach((node, i) => {
      if (pos === 'south') {
        node.el.classList.remove('lift', 'no-shadow')
        const card = node.rank && node.suit ? { rank: node.rank, suit: node.suit } : null
        if (card && !node.faceUp) setNodeFace(node, card.rank, card.suit)   // safety: reveal if a resize cut the deal flip short
        const showValid = state.isMyTurn && !ui.pendingCard && !!card && isValidCard(card)
        node.el.classList.toggle('valid', showValid)
        node.el.classList.toggle('invalid', state.isMyTurn && !ui.pendingCard && !showValid)
        if (ui.pendingCard && card && card.rank === ui.pendingCard.rank && card.suit === ui.pendingCard.suit) return  // lifted below
      }
      if (settle(node.el)) return
      place(node.el, layout[i][0], layout[i][1], layout[i][2], layout[i][3], animate)
    })
  }
  const area = playfield()
  pliNodes.forEach(({ from, node }, i) => {
    if (settle(node.el)) return
    const off = pliOffset(from)
    place(node.el, area.centerX + off[0], area.centerY + off[1], (i - (pliNodes.length - 1) / 2) * cfg.pli.rot, 1, animate)
  })
  if (ui.pendingCard) {
    const node = findSouthNode(ui.pendingCard.rank, ui.pendingCard.suit)
    if (node) {
      // Keep the golden "valid" frame so the armed card stays visibly lit, and pin its
      // z-index above the dim + already-played pli cards (the per-card inline z set at
      // deal/restack time would otherwise bury it under the trick on the playfield).
      node.el.classList.add('lift', 'valid')
      node.el.style.zIndex = '80'
      place(node.el, area.centerX, area.centerY + cardH * cfg.confirm.cardY, 0, cfg.confirm.scale, animate)
    }
  }
  renderChrome()
}

/** Public full refresh (snap) — used by initGame + window resize. */
export function render(): void {
  if (!root) return
  if (ui.pendingCard && !state.isMyTurn) { ui.pendingCard = null; restackSouthHand() }   // drop stale confirmation + undo its lift z
  layoutAll(false)
}

// ── Apply server events ───────────────────────────────────────────────
export function applyDealt(data: DealtPayload, animate = true): void {
  const myIdx  = data.seats.findIndex(s => s.socketId === state.mySocketId)
  const myTeam = data.seats[myIdx].team

  state.seats = ([0, 1, 2, 3] as const).map(offset => {
    const abs = data.seats[(myIdx + offset) % 4]
    const position = (['south', 'west', 'north', 'east'] as const)[offset]
    return {
      socketId: abs.socketId, nickname: abs.nickname, position,
      team: abs.team, isAlly: abs.team === myTeam, isMe: abs.socketId === state.mySocketId,
      cardCount: 8, lastBidAction: null,
    }
  })

  ui.pendingCard           = null
  state.myHand             = sortHand(data.myHand)
  state.pli                = []
  state.bid                = null
  state.highBidderNickname = null
  state.trickInfo          = null
  state.bidderNickname = state.bidderSocketId
    ? (seatBySocket(state.bidderSocketId)?.nickname ?? null)
    : null

  buildHands(animate)
}

/** (Re)create every persistent card node. `animate` → deck-deal cascade (fresh deal);
 *  else snap straight into place (session restore / F5 — don't replay the whole deal). */
function buildHands(animate: boolean): void {
  for (const pos of ['south', 'west', 'north', 'east'] as const) {
    handNodes[pos].forEach(n => n.el.remove())
    handNodes[pos] = []
  }
  pliNodes.forEach(p => p.node.el.remove())
  pliNodes.length = 0

  handNodes.south = state.myHand.map(({ rank, suit }) => {
    // Cascade flips face-up mid-deal, so start face-down; on snap there's no flip → face-up now.
    const node = makeCardNode(rank, suit, !animate)
    node.el.addEventListener('pointerenter', () => { if (state.isMyTurn && !ui.pendingCard && isValidCard({ rank, suit })) soundHover() })
    node.el.addEventListener('click', () => enterConfirm(rank, suit))
    return node
  })
  for (const pos of ['west', 'north', 'east'] as const) {
    handNodes[pos] = Array.from({ length: seatAt(pos).cardCount }, () => makeCardNode(null, null, false))
  }

  if (animate) {
    dealCascade()
    renderChrome()
  } else {
    restackHands()       // cascade normally assigns fan z; on snap we set it ourselves
    layoutAll(false)     // place all cards instantly (also rebuilds chrome)
  }
}

export function applyBidState(data: BidStatePayload): void {
  state.bid = data.highBid
    ? { value: data.highBid.value, suit: data.highBid.suit, contree: data.contree }
    : null
  state.highBidderNickname = data.highBid?.bidderNickname ?? null
  state.bidderNickname = seatBySocket(data.currentBidderSocketId)?.nickname ?? null
  state.bidderSocketId = data.currentBidderSocketId
  const action = data.lastAction
  if (action) {
    const actor = seatBySocket(action.socketId)
    if (actor) actor.lastBidAction = action
  }
  renderChrome()
}

export function applyPlayStart(data: PlayStartPayload): void {
  ui.pendingCard       = null
  state.bid            = data.bid
  state.trump          = data.trump
  state.bidderNickname = null
  state.bidderSocketId = null
  state.myHand         = sortHand(state.myHand, data.trump)
  // Reorder south nodes to follow the freshly-sorted hand, re-stack their z-index
  // to the new order (else the old deal-time z buries cards), then re-fan.
  handNodes.south = state.myHand
    .map(c => findSouthNode(c.rank, c.suit))
    .filter((n): n is CardNode => !!n)
  restackSouthHand()
  layoutAll(true)
}

/** Accepts both the live `play:state` payload and the session-restore shape
 *  (which omits `trickLeaderSocketId` but carries the locked `bid`). */
type PlayStateInput = Omit<PlayStatePayload, 'trickLeaderSocketId' | 'trump'> & {
  trump?: Suit
  trickLeaderSocketId?: string
  bid?: BidInfo
}
export function applyPlayState(data: PlayStateInput): void {
  if (data.trump) state.trump = data.trump
  if (data.bid)   state.bid   = data.bid

  state.isMyTurn     = data.currentPlayerSocketId === state.mySocketId
  state.trickMessage = null
  state.trickInfo    = {
    currentPlayerSocketId: data.currentPlayerSocketId,
    trickLeaderSocketId:   data.trickLeaderSocketId,
    scores:       data.scores,
    tricksPlayed: data.tricksPlayed,
  }
  if (!state.isMyTurn) state.validCards = []

  for (const seat of state.seats) {
    if (!seat.isMe) {
      const playedThisTrick = data.trick.some(t => t.socketId === seat.socketId)
      seat.cardCount = 8 - data.tricksPlayed - (playedThisTrick ? 1 : 0)
    }
  }

  flyMissingTrickCards(data.trick)   // opponents' cards (mine already flew in playCard)
  state.pli = data.trick.map(({ rank, suit }) => ({ rank, suit }))

  // Keep opponent face-down stacks consistent (covers session restore: past
  // tricks aren't replayed, so trim each hand down to its true remaining count).
  for (const seat of state.seats) {
    if (seat.isMe) continue
    reconcileOpponentCount(seat.position, seat.cardCount)
  }

  renderChrome()
}

export function applyYourTurn(data: { validCards: Card[] }): void {
  state.validCards = data.validCards
  layoutAll(false)   // refresh valid/invalid highlight on the south hand
}

export function applyTrickWon(data: TrickWonPayload): void {
  flyMissingTrickCards(data.trick)   // the 4th completing card arrives only here
  state.pli          = data.trick.map(({ rank, suit }) => ({ rank, suit }))
  state.trickMessage = `${data.winnerNickname} remporte le pli`
  if (state.trickInfo) {
    state.trickInfo.scores              = data.scores
    state.trickInfo.tricksPlayed        = data.tricksPlayed
    state.trickInfo.trickLeaderSocketId = data.winnerSocketId
  }
  for (const seat of state.seats) { if (!seat.isMe) seat.cardCount = 8 - data.tricksPlayed }
  renderChrome()
  // Let the completed trick read for a beat, then sweep it to the winner.
  window.setTimeout(() => sweepTrick(data.winnerSocketId), ANIMATION.trickSweepDelayMs)
}

// ── Play interaction (tap-to-confirm) ─────────────────────────────────
// Exported cancelConfirm/confirmPlay are wired to the ✓/✗ boxes built in chrome.ts.
function enterConfirm(rank: Rank, suit: Suit): void {
  if (!state.isMyTurn || ui.pendingCard) return
  if (!isValidCard({ rank, suit })) return
  if (!getConfirmPlay()) { playCard(rank, suit); return }   // prompt disabled → play straight away
  ui.pendingCard = { rank, suit }
  layoutAll(true)
}
export function cancelConfirm(): void {
  if (!ui.pendingCard) return
  ui.pendingCard = null
  restackSouthHand()   // restore the fan z-order the lift had overridden
  layoutAll(true)      // lifted card slides back into the fan
}
export function confirmPlay(): void {
  const card = ui.pendingCard
  ui.pendingCard = null
  if (card) playCard(card.rank, card.suit)
}
function playCard(rank: Rank, suit: Suit): void {
  if (!state.isMyTurn) return
  const node = findSouthNode(rank, suit)
  const idx  = state.myHand.findIndex(c => c.rank === rank && c.suit === suit)
  if (!node || idx < 0 || !isValidCard({ rank, suit })) return
  soundPlay()
  state.myHand.splice(idx, 1)
  state.isMyTurn   = false
  state.validCards = []
  flyToPli('south', node, state.mySocketId ?? '')
  renderChrome()
  fireCardPlay({ rank, suit })
}
