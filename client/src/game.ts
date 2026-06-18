import { gsap } from 'gsap'
import { soundHover, soundPlay } from './soundManager.js'
import {
  CARD_BASE_WIDTH, CARD_BASE_HEIGHT, VIEWPORT, LAYOUT_PRESETS, PLI, ANIMATION, CARD_COLORS,
} from './uiConfig.js'
import type { LayoutPreset, PresetName } from './uiConfig.js'
import type {
  Rank, Suit, Card, Team, Position, Contree, BidValue, BidInfo, LastAction, TeamScores,
  DealtPayload, BidStatePayload, PlayStartPayload, PlayStatePayload, TrickWonPayload,
} from '../../shared/types.js'

// ════════════════════════════════════════════════════════════════════
// DOM renderer (Étape 3 — juice pass). Cards are SVG <div>s that PERSIST
// across events so GSAP can tween them: deal cascade, fly-to-pli on play,
// hand re-fan, trick sweep to the winner, animated tap-to-confirm lift.
// Plates + HUD + confirm overlay are cheap "chrome" rebuilt each update.
// Public API (state, apply*, initGame, setOnCardPlay, render) is the
// contract consumed by client/src/features/*.ts. Still to come: particles
// (canvas overlay) + the mobile-landscape layout.
// ════════════════════════════════════════════════════════════════════

const SUITS: Suit[] = ['Hearts', 'Diamonds', 'Clubs', 'Spades']
const SUIT_SYMBOLS: Record<Suit, string> = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' }
const isRedSuit = (suit: Suit): boolean => suit === 'Hearts' || suit === 'Diamonds'

// Inline SVG card face (ported from proto/game-ui.html). The corner index is
// drawn once and mirrored 180° about the centre; `.frame` is restyled to gold
// when the card div carries `.valid`.
function cardSVG(rank: Rank | null, suit: Suit | null, faceUp: boolean): string {
  if (!faceUp || !rank || !suit) return `
    <svg viewBox="0 0 96 134">
      <rect class="frame" x="3" y="3" width="90" height="128" rx="11" fill="${CARD_COLORS.backFill}" stroke="${CARD_COLORS.backStroke}" stroke-width="3"/>
      <rect x="11" y="11" width="74" height="112" rx="7" fill="none" stroke="${CARD_COLORS.backInner}" stroke-width="2" stroke-dasharray="5 4"/>
      <text x="48" y="80" text-anchor="middle" font-size="30" fill="${CARD_COLORS.backInner}">♣</text>
    </svg>`
  const colour = isRedSuit(suit) ? CARD_COLORS.redSuit : CARD_COLORS.blackSuit, pip = SUIT_SYMBOLS[suit]
  const index = `<g><text x="10" y="27" font-size="21">${rank}</text><text x="11" y="45" font-size="16">${pip}</text></g>`
  return `
    <svg viewBox="0 0 96 134">
      <rect class="frame" x="3" y="3" width="90" height="128" rx="11" fill="${CARD_COLORS.faceFill}" stroke="${CARD_COLORS.faceStroke}" stroke-width="1.5"/>
      <g fill="${colour}" font-family="Georgia, serif" font-weight="bold">
        ${index}
        <g transform="rotate(180 48 67)">${index}</g>
        <text x="48" y="84" font-size="46" text-anchor="middle">${pip}</text>
      </g>
    </svg>`
}

// Active layout preset + current card size in px (recomputed by computeScale).
// All tunable values live in uiConfig.ts.
const pickPreset = (): PresetName =>
  Math.min(window.innerWidth, window.innerHeight) < VIEWPORT.portraitBreakpoint ? 'portrait' : 'desktop'

let cfg: LayoutPreset = LAYOUT_PRESETS.desktop
let cardW = CARD_BASE_WIDTH    // current card width  in px (scaled per viewport + preset)
let cardH = CARD_BASE_HEIGHT   // current card height in px

function computeScale(): void {
  cfg = LAYOUT_PRESETS[pickPreset()]
  const minSide = Math.min(window.innerWidth, window.innerHeight)
  const viewportScale = Math.max(VIEWPORT.minScale, Math.min(VIEWPORT.maxScale, minSide / VIEWPORT.referenceSide))
  cardW = Math.round(CARD_BASE_WIDTH * viewportScale * cfg.cardScale)
  cardH = Math.round(CARD_BASE_HEIGHT * viewportScale * cfg.cardScale)
}

// Inner playfield, inset by margin and width-capped on wide screens.
interface Playfield { centerX: number; centerY: number; halfW: number; halfH: number }
function playfield(): Playfield {
  const winW = window.innerWidth, winH = window.innerHeight
  const margin = cfg.page.margin * Math.min(winW, winH)
  const halfH = winH / 2 - margin
  let halfW = winW / 2 - margin
  const widthCap = halfH * cfg.page.maxAspect
  if (halfW > widthCap) halfW = widthCap
  return { centerX: winW / 2, centerY: winH / 2, halfW, halfH }
}

// One placement per card: [x, y, rotationDeg, scale], centred on the card.
type Placement = [number, number, number, number]

function layoutHand(pos: Position, count: number): Placement[] {
  const area = playfield(), placements: Placement[] = []
  if (pos === 'south') {
    const baseY = area.centerY + area.halfH - cardH * cfg.south.bottom, step = cardW * cfg.south.step
    for (let i = 0; i < count; i++) {
      const rel = count > 1 ? i / (count - 1) - 0.5 : 0
      placements.push([area.centerX + rel * step * (count - 1), baseY + rel * rel * cfg.south.arc, rel * cfg.south.fan, cfg.south.scale])
    }
  } else if (pos === 'north') {
    const step = cardW * cfg.north.step, topY = area.centerY - area.halfH + cardH * cfg.north.top
    for (let i = 0; i < count; i++) {
      const rel = count > 1 ? i / (count - 1) - 0.5 : 0
      placements.push([area.centerX + rel * step * (count - 1), topY, 180, cfg.north.scale])
    }
  } else {
    const x = pos === 'west' ? area.centerX - area.halfW + cardH * cfg.side.edge : area.centerX + area.halfW - cardH * cfg.side.edge
    const step = cardW * cfg.side.step, rot = pos === 'west' ? 90 : -90, cy = area.centerY + cfg.side.vshift * 2 * area.halfH
    for (let i = 0; i < count; i++) {
      const rel = count > 1 ? i / (count - 1) - 0.5 : 0
      placements.push([x, cy + rel * step * (count - 1), rot, cfg.side.scale])
    }
  }
  return placements
}

const platePos: Record<Position, () => [number, number]> = {
  south: () => { const a = playfield(); return [a.centerX, a.centerY + a.halfH - cardH * cfg.plate.southY] },
  north: () => { const a = playfield(); return [a.centerX, a.centerY - a.halfH + cardH * cfg.plate.northY] },
  west:  () => { const a = playfield(), handX = a.centerX - a.halfW + cardH * cfg.side.edge, cy = a.centerY + cfg.side.vshift * 2 * a.halfH
                 return [handX + cardH * cfg.side.scale * 0.5 + cardW * cfg.plate.sideGap, cy + cardW * cfg.plate.sideY] },
  east:  () => { const a = playfield(), handX = a.centerX + a.halfW - cardH * cfg.side.edge, cy = a.centerY + cfg.side.vshift * 2 * a.halfH
                 return [handX - cardH * cfg.side.scale * 0.5 - cardW * cfg.plate.sideGap, cy + cardW * cfg.plate.sideY] },
}

// Where a card played by `from` lands in the pli (offset from table centre).
function pliOffset(from: Position): [number, number] {
  const v = cardH * PLI.verticalOffsetFactor
  const offsets: Record<Position, [number, number]> = {
    south: [0, v], north: [0, -v],
    west:  [-cardW * cfg.pli.spread, 0], east: [cardW * cfg.pli.spread, 0],
  }
  return offsets[from]
}

// ── Game state (consumed by client/src/features/*.ts) ─────────────────
/** A seat from the local player's point of view (south = me, north = ally, etc.). */
interface RenderSeat {
  socketId: string
  nickname: string
  position: Position
  team: Team
  isAlly: boolean
  isMe: boolean
  cardCount: number
  lastBidAction: LastAction | null
}
/** Current bid as the HUD needs it (BidInfo's `team` is accepted but unused here). */
interface RenderBid { value: BidValue; suit: Suit; contree: Contree }
interface RenderTrickInfo {
  currentPlayerSocketId: string
  trickLeaderSocketId: string | undefined
  scores: TeamScores
  tricksPlayed: number
}
interface RenderState {
  mySocketId: string | null
  seats: RenderSeat[]
  myHand: Card[]
  pli: Card[]
  bid: RenderBid | null
  bidderNickname: string | null
  bidderSocketId: string | null
  highBidderNickname: string | null
  trump: Suit | null
  isMyTurn: boolean
  validCards: Card[]
  trickInfo: RenderTrickInfo | null
  trickMessage: string | null
}

export const state: RenderState = {
  mySocketId: null,
  seats: [
    { socketId: '', nickname: 'Vous',    position: 'south', team: 'A', isAlly: true,  isMe: true,  cardCount: 8, lastBidAction: null },
    { socketId: '', nickname: 'Alice',   position: 'north', team: 'A', isAlly: true,  isMe: false, cardCount: 8, lastBidAction: null },
    { socketId: '', nickname: 'Bob',     position: 'west',  team: 'B', isAlly: false, isMe: false, cardCount: 8, lastBidAction: null },
    { socketId: '', nickname: 'Charlie', position: 'east',  team: 'B', isAlly: false, isMe: false, cardCount: 8, lastBidAction: null },
  ],
  myHand: [],
  pli:                [],
  bid:                null,
  bidderNickname:     null,
  bidderSocketId:     null,
  highBidderNickname: null,
  trump:        null,
  isMyTurn:     false,
  validCards:   [],
  trickInfo:    null,
  trickMessage: null,
}

let onCardPlay: ((card: Card) => void) | null = null
export function setOnCardPlay(cb: (card: Card) => void): void { onCardPlay = cb }

// Card chosen but not yet confirmed (tap-to-confirm, anti-misclick).
let pendingCard: Card | null = null

// ── Persistent visual model ───────────────────────────────────────────
/** A card element that lives across events so GSAP can tween it.
 *  rank/suit are null for face-down opponent cards until revealed. */
interface CardNode { rank: Rank | null; suit: Suit | null; faceUp: boolean; el: HTMLDivElement }
const handNodes: Record<Position, CardNode[]> = { south: [], west: [], north: [], east: [] }
let pliNodes: { from: Position; socketId: string; node: CardNode }[] = []
let chromeNodes: HTMLElement[] = []   // plates / HUD / trick message / confirm overlay (rebuilt each update)

let root: HTMLElement | null = null
let initialized = false

// ── Entry ─────────────────────────────────────────────────────────
export async function initGame(rootEl: HTMLElement, mySocketId: string | undefined): Promise<void> {
  root = rootEl
  state.mySocketId = mySocketId ?? null
  if (!initialized) {
    window.addEventListener('resize', () => render())
    initialized = true
  }
  computeScale()
  render()
}

const seatAt = (pos: Position): RenderSeat =>
  state.seats.find(s => s.position === pos) ?? state.seats[0]
const seatBySocket = (socketId: string): RenderSeat | undefined =>
  state.seats.find(s => s.socketId === socketId)

// ── Hand sorting ──────────────────────────────────────────────────
const SUIT_ORDER:       Record<Suit, number> = { Hearts: 0, Spades: 1, Diamonds: 2, Clubs: 3 }
const RANK_ORDER:       Record<Rank, number> = { A: 0, '10': 1, K: 2, Q: 3, J: 4, '9': 5, '8': 6, '7': 7 }
const RANK_ORDER_TRUMP: Record<Rank, number> = { J: 0, '9': 1, A: 2, '10': 3, K: 4, Q: 5, '8': 6, '7': 7 }
function sortHand(hand: Card[], trump: Suit | null = null): Card[] {
  return [...hand].sort((a, b) => {
    const suitDiff = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]
    if (suitDiff !== 0) return suitDiff
    const order = trump && a.suit === trump ? RANK_ORDER_TRUMP : RANK_ORDER
    return order[a.rank] - order[b.rank]
  })
}

// ── Card element factory ──────────────────────────────────────────
function makeCardNode(rank: Rank | null, suit: Suit | null, faceUp: boolean): CardNode {
  const el = document.createElement('div')
  el.className = 'g-card'
  el.style.width = cardW + 'px'; el.style.height = cardH + 'px'
  el.innerHTML = cardSVG(rank, suit, faceUp)
  root!.appendChild(el)
  return { rank, suit, faceUp, el }
}
function setNodeFace(node: CardNode, rank: Rank, suit: Suit): void {
  node.rank = rank; node.suit = suit; node.faceUp = true
  node.el.innerHTML = cardSVG(rank, suit, true)
}
/** Position a card element via GSAP (animate = tween, else snap). */
function place(el: HTMLElement, centerX: number, centerY: number, rotationDeg: number, scale: number, animate: boolean): void {
  const props = { x: centerX - cardW / 2, y: centerY - cardH / 2, rotation: rotationDeg, scale }
  if (animate) gsap.to(el, { ...props, duration: ANIMATION.cardMove.duration, ease: ANIMATION.cardMove.ease })
  else gsap.set(el, props)
}

const isValidCard = (card: Card): boolean => state.validCards.some(c => c.rank === card.rank && c.suit === card.suit)
const findSouthNode = (rank: Rank, suit: Suit): CardNode | undefined =>
  handNodes.south.find(n => n.rank === rank && n.suit === suit)

// ── Layout (positions all persistent cards, then rebuilds chrome) ─────
function layoutAll(animate: boolean): void {
  computeScale()
  for (const pos of ['north', 'west', 'east', 'south'] as Position[]) {
    const nodes = handNodes[pos]
    const layout = layoutHand(pos, nodes.length)
    nodes.forEach((node, i) => {
      if (pos === 'south') {
        node.el.classList.remove('lift', 'no-shadow')
        const card = node.rank && node.suit ? { rank: node.rank, suit: node.suit } : null
        if (card && !node.faceUp) setNodeFace(node, card.rank, card.suit)   // safety: reveal if a resize cut the deal flip short
        const showValid = state.isMyTurn && !pendingCard && !!card && isValidCard(card)
        node.el.classList.toggle('valid', showValid)
        node.el.classList.toggle('invalid', state.isMyTurn && !pendingCard && !showValid)
        if (pendingCard && card && card.rank === pendingCard.rank && card.suit === pendingCard.suit) return  // lifted below
      }
      place(node.el, layout[i][0], layout[i][1], layout[i][2], layout[i][3], animate)
    })
  }
  const area = playfield()
  pliNodes.forEach(({ from, node }, i) => {
    const off = pliOffset(from)
    place(node.el, area.centerX + off[0], area.centerY + off[1], (i - (pliNodes.length - 1) / 2) * cfg.pli.rot, 1, animate)
  })
  if (pendingCard) {
    const node = findSouthNode(pendingCard.rank, pendingCard.suit)
    if (node) { node.el.classList.add('lift'); place(node.el, area.centerX, area.centerY + cardH * cfg.confirm.cardY, 0, cfg.confirm.scale, animate) }
  }
  renderChrome()
}
function reflowHand(pos: Position, animate: boolean): void {
  const layout = layoutHand(pos, handNodes[pos].length)
  handNodes[pos].forEach((node, i) => place(node.el, layout[i][0], layout[i][1], layout[i][2], layout[i][3], animate))
}

/** Public full refresh (snap) — used by initGame + window resize. */
export function render(): void {
  if (!root) return
  if (pendingCard && !state.isMyTurn) pendingCard = null   // drop stale confirmation
  layoutAll(false)
}

// ── Apply server events ───────────────────────────────────────────
export function applyDealt(data: DealtPayload): void {
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

  pendingCard              = null
  state.myHand             = sortHand(data.myHand)
  state.pli                = []
  state.bid                = null
  state.highBidderNickname = null
  state.trickInfo          = null
  state.bidderNickname = state.bidderSocketId
    ? (seatBySocket(state.bidderSocketId)?.nickname ?? null)
    : null

  buildHands()
}

/** (Re)create every persistent card node for a fresh deal, then deal-cascade in. */
function buildHands(): void {
  for (const pos of ['south', 'west', 'north', 'east'] as Position[]) {
    handNodes[pos].forEach(n => n.el.remove())
    handNodes[pos] = []
  }
  pliNodes.forEach(p => p.node.el.remove())
  pliNodes = []

  handNodes.south = state.myHand.map(({ rank, suit }) => {
    const node = makeCardNode(rank, suit, false)   // starts face-down on the deck; flips face-up mid-deal
    node.el.addEventListener('pointerenter', () => { if (state.isMyTurn && !pendingCard && isValidCard({ rank, suit })) soundHover() })
    node.el.addEventListener('click', () => enterConfirm(rank, suit))
    return node
  })
  for (const pos of ['west', 'north', 'east'] as Position[]) {
    handNodes[pos] = Array.from({ length: seatAt(pos).cardCount }, () => makeCardNode(null, null, false))
  }

  dealCascade()
  renderChrome()
}

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
function dealCascade(): void {
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
  pendingCard          = null
  state.bid            = data.bid
  state.trump          = data.trump
  state.bidderNickname = null
  state.bidderSocketId = null
  state.myHand         = sortHand(state.myHand, data.trump)
  // Reorder south nodes to follow the freshly-sorted hand, then re-fan.
  handNodes.south = state.myHand
    .map(c => findSouthNode(c.rank, c.suit))
    .filter((n): n is CardNode => !!n)
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
function enterConfirm(rank: Rank, suit: Suit): void {
  if (!state.isMyTurn || pendingCard) return
  if (!isValidCard({ rank, suit })) return
  pendingCard = { rank, suit }
  layoutAll(true)
}
function cancelConfirm(): void {
  if (!pendingCard) return
  pendingCard = null
  layoutAll(true)   // lifted card slides back into the fan
}
function confirmPlay(): void {
  const card = pendingCard
  pendingCard = null
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
  onCardPlay?.({ rank, suit })
}

// Move a card from its hand into the pli with a fly tween; reveal opponents.
function flyToPli(pos: Position, node: CardNode, socketId: string, reveal?: Card): void {
  const idx = handNodes[pos].indexOf(node)
  if (idx >= 0) handNodes[pos].splice(idx, 1)
  if (reveal) setNodeFace(node, reveal.rank, reveal.suit)
  node.el.classList.remove('valid', 'invalid', 'lift')
  if (socketId !== state.mySocketId) soundPlay()   // my own card already sounded in playCard
  pliNodes.push({ from: pos, socketId, node })
  const area = playfield(), off = pliOffset(pos)
  place(node.el, area.centerX + off[0], area.centerY + off[1], (pliNodes.length - 1 - 1.5) * cfg.pli.rot, 1, true)
  if (idx >= 0) reflowHand(pos, true)
}

// Fly any trick card not yet shown in the pli (e.g. an opponent's card, or the
// 4th completing card which only arrives via trick:won — never play:state).
function flyMissingTrickCards(trick: { socketId: string; rank: Rank; suit: Suit }[]): void {
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
function sweepTrick(winnerSocketId: string): void {
  const winner = seatBySocket(winnerSocketId)
  const [wx, wy] = winner ? platePos[winner.position]() : [playfield().centerX, playfield().centerY]
  const els = pliNodes.map(p => p.node.el)
  const swept = pliNodes
  pliNodes = []
  if (!els.length) return
  gsap.to(els, {
    x: wx - cardW / 2, y: wy - cardH / 2, rotation: winner?.position === 'north' ? 180 : 0,
    scale: ANIMATION.sweep.toScale, opacity: 0,
    duration: ANIMATION.sweep.duration, ease: ANIMATION.sweep.ease, stagger: ANIMATION.sweep.stagger,
    onComplete: () => swept.forEach(p => p.node.el.remove()),
  })
}

// Add/remove face-down nodes so an opponent's stack matches its true count.
function reconcileOpponentCount(pos: Position, target: number): void {
  const nodes = handNodes[pos]
  while (nodes.length > target) { const n = nodes.pop(); n?.el.remove() }
  while (nodes.length < target) { nodes.push(makeCardNode(null, null, false)) }
  reflowHand(pos, true)
}

// ── Chrome (plates, HUD, trick message, confirm overlay) — rebuilt each update ─
function isTurnSeat(socketId: string): boolean {
  if (state.trickInfo)      return state.trickInfo.currentPlayerSocketId === socketId
  if (state.bidderSocketId) return state.bidderSocketId === socketId
  return false
}
function escapeText(text: string): string { const d = document.createElement('div'); d.textContent = text ?? ''; return d.innerHTML }

function makePlate(seat: RenderSeat): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `g-seat ${seat.isAlly ? 'ally' : 'foe'}${isTurnSeat(seat.socketId) ? ' turn' : ''}`
  const isLeader = state.trickInfo?.trickLeaderSocketId === seat.socketId
  let bidLabel = ''
  if (state.trickInfo === null && seat.lastBidAction) {
    const action = seat.lastBidAction
    if (action.type === 'pass')         bidLabel = `<div class="g-bid pass">Passe</div>`
    else if (action.type === 'contree') bidLabel = `<div class="g-bid contree">Contré</div>`
    else if (action.type === 'bid')     bidLabel = `<div class="g-bid ${isRedSuit(action.suit) ? 'red' : 'black'}">${action.value} ${SUIT_SYMBOLS[action.suit]}</div>`
  }
  el.innerHTML = `<span class="g-star"${isLeader ? '' : ' style="visibility:hidden"'}>★</span><div class="g-name">${escapeText(seat.nickname)}</div>${bidLabel}`
  const [px, py] = platePos[seat.position]()
  el.style.left = px + 'px'; el.style.top = py + 'px'
  return el
}

function buildHUD(frag: DocumentFragment): void {
  const area = playfield()
  if (state.trickInfo === null) {
    const bid = state.bid
    const symbol = bid ? SUIT_SYMBOLS[bid.suit] : null
    const contreeLabel = bid?.contree === 'surcontree' ? ' SURCONTRÉ' : bid?.contree === 'contree' ? ' CONTRÉ' : ''
    const valueHTML = bid ? `${bid.value} <span class="${isRedSuit(bid.suit) ? 'red' : ''}">${symbol}</span>${contreeLabel}` : '—'
    let turnLabel = '', turnClass = ''
    if (state.bidderSocketId) {
      const bidder = seatBySocket(state.bidderSocketId)
      if (bidder) { turnLabel = bidder.isMe ? 'Votre tour !' : `Tour : ${escapeText(bidder.nickname)}`; turnClass = bidder.isMe ? 'me' : '' }
    }
    const hudEl = document.createElement('div')
    hudEl.className = 'g-bidhud'
    hudEl.innerHTML = `<div class="lbl">ENCHÈRE</div><div class="val">${valueHTML}</div>` +
      (state.highBidderNickname ? `<div class="holder">${escapeText(state.highBidderNickname)}</div>` : '') +
      (turnLabel ? `<div class="turn ${turnClass}">${turnLabel}</div>` : '')
    hudEl.style.left = area.centerX + 'px'; hudEl.style.top = (area.centerY + cardH * cfg.hud.bidY) + 'px'
    frag.appendChild(hudEl)
    return
  }
  const bid = state.bid
  if (bid) {
    const symbol = SUIT_SYMBOLS[bid.suit]
    const mult = bid.contree === 'surcontree' ? ' <span class="mult">×4</span>'
               : bid.contree === 'contree'    ? ' <span class="mult">×2</span>' : ''
    const contractEl = document.createElement('div')
    contractEl.className = 'g-contract'
    contractEl.innerHTML = `<span class="lbl">CONTRAT </span><b>${bid.value} <span class="${isRedSuit(bid.suit) ? 'red' : ''}">${symbol}</span></b>${mult}`
    contractEl.style.left = area.centerX + 'px'; contractEl.style.top = (area.centerY + cardH * cfg.hud.contractY) + 'px'
    frag.appendChild(contractEl)
  }
  const { scores, tricksPlayed } = state.trickInfo
  const trickHudEl = document.createElement('div')
  trickHudEl.className = 'g-trickhud'
  trickHudEl.innerHTML = `<div class="row"><span>Plis</span><span>${tricksPlayed + 1} / 8</span></div>` +
    `<div class="row"><span class="a">Nous</span><span class="a">${scores.A}</span></div>` +
    `<div class="row"><span class="b">Eux</span><span class="b">${scores.B}</span></div>`
  frag.appendChild(trickHudEl)
}

function buildConfirm(frag: DocumentFragment): void {
  if (!pendingCard || !state.isMyTurn) return
  const area = playfield()
  const dim = document.createElement('div')
  dim.className = 'g-confirm-dim'
  dim.addEventListener('click', cancelConfirm)
  frag.appendChild(dim)

  const boxY = area.centerY + cardH * cfg.confirm.boxY, size = cfg.confirm.boxSize
  const makeBox = (variant: 'yes' | 'no', label: string, centerX: number, onClick: () => void): void => {
    const box = document.createElement('div')
    box.className = `g-confirm-box ${variant}`
    box.textContent = label
    box.style.width = box.style.height = size + 'px'
    box.style.fontSize = Math.round(size * 0.5) + 'px'
    box.style.left = centerX + 'px'; box.style.top = boxY + 'px'
    box.addEventListener('click', onClick)
    frag.appendChild(box)
  }
  makeBox('no',  '✕', area.centerX - cardW * cfg.confirm.boxGap, cancelConfirm)
  makeBox('yes', '✓', area.centerX + cardW * cfg.confirm.boxGap, confirmPlay)
}

function renderChrome(): void {
  if (!root) return
  chromeNodes.forEach(n => n.remove())
  chromeNodes = []
  const frag = document.createDocumentFragment()
  for (const pos of ['south', 'west', 'north', 'east'] as Position[]) frag.appendChild(makePlate(seatAt(pos)))
  if (state.trickMessage) {
    const area = playfield()
    const msgEl = document.createElement('div')
    msgEl.className = 'g-trickmsg'
    msgEl.textContent = state.trickMessage
    msgEl.style.left = area.centerX + 'px'; msgEl.style.top = (area.centerY + cardH * cfg.pli.messageY) + 'px'
    frag.appendChild(msgEl)
  }
  buildHUD(frag)
  buildConfirm(frag)
  chromeNodes = Array.from(frag.children) as HTMLElement[]
  root.appendChild(frag)
}
