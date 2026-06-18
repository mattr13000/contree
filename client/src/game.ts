import { soundHover, soundPlay } from './soundManager.js'
import type {
  Rank, Suit, Card, Team, Position, Contree, BidValue, BidInfo, LastAction, TeamScores,
  DealtPayload, BidStatePayload, PlayStartPayload, PlayStatePayload, TrickWonPayload,
} from '../../shared/types.js'

// ════════════════════════════════════════════════════════════════════
// DOM renderer (Étape 3). Cards are absolutely-positioned <div>s laid out
// from the proto presets; render() does a full rebuild from `state` on every
// event. Public API (state, apply*, initGame, setOnCardPlay, render) is the
// contract consumed by client/src/features/*.ts. Tap-to-confirm (passe 2) and
// the restyled bid modal (passe 3) are in. Still to come: GSAP juice with
// persistent card nodes and the mobile-landscape layout.
// ════════════════════════════════════════════════════════════════════

const CARD_BASE_W = 96    // card box base size (proto units; sprite art stretched to fill)
const CARD_BASE_H = 134

// Sprite-sheet cell coords (native 88×124 px grid) per rank — the 8 Contrée ranks.
const SPRITE: Record<Rank, { col: number; row: number }> = {
  'A':  { col: 0, row: 0 }, '7':  { col: 1, row: 1 }, '8':  { col: 2, row: 1 },
  '9':  { col: 3, row: 1 }, '10': { col: 4, row: 1 }, 'J':  { col: 0, row: 2 },
  'Q':  { col: 1, row: 2 }, 'K':  { col: 2, row: 2 },
}
const SUITS: Suit[] = ['Hearts', 'Diamonds', 'Clubs', 'Spades']
const SUIT_SYMBOLS: Record<Suit, string> = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' }
const isRedSuit = (suit: Suit): boolean => suit === 'Hearts' || suit === 'Diamonds'

// ── Tunable layout presets (baked from proto/game-ui.html) ───────────
// Desktop + portrait only — landscape phones get the force-portrait overlay.
interface Preset {
  page:      { margin: number; maxAspect: number }
  cardScale: number
  south:     { bottom: number; step: number; arc: number; fan: number; scale: number }
  north:     { top: number; step: number; scale: number }
  side:      { edge: number; step: number; vshift: number; scale: number }
  pli:       { spread: number; rot: number }
  plate:     { southY: number; northY: number; sideGap: number; sideY: number }
  hud:       { bidY: number; contractY: number }
  confirm:   { cardY: number; scale: number; boxY: number; boxGap: number; boxSize: number }
}

const PRESETS: Record<'desktop' | 'portrait', Preset> = {
  desktop: {
    page:    { margin: 0.098, maxAspect: 1.4 },
    cardScale: 1.15,
    south:   { bottom: 0.30, step: 0.59, arc: 90, fan: 22, scale: 1.0 },
    north:   { top: 0.43, step: 0.45, scale: 1.0 },
    side:    { edge: 0.44, step: 0.45, vshift: 0.0, scale: 0.95 },
    pli:     { spread: 0.78, rot: 6 },
    plate:   { southY: 1.10, northY: 1.16, sideGap: 0.40, sideY: 0.0 },
    hud:     { bidY: 0.0, contractY: 0.92 },
    confirm: { cardY: 0.90, scale: 1.30, boxY: 1.89, boxGap: 0.40, boxSize: 58 },
  },
  portrait: {
    page:    { margin: 0.06, maxAspect: 1.4 },
    cardScale: 1.2,
    south:   { bottom: 1.0, step: 0.5, arc: 80, fan: 22, scale: 1.1 },
    north:   { top: -0.45, step: 0.24, scale: 0.9 },
    side:    { edge: -0.5, step: 0.4, vshift: 0.0, scale: 0.9 },
    pli:     { spread: 0.62, rot: 6 },
    plate:   { southY: 1.9, northY: 0.55, sideGap: 0.45, sideY: 0.0 },
    hud:     { bidY: 0.0, contractY: 1.2 },
    confirm: { cardY: -0.10, scale: 1.35, boxY: 1.30, boxGap: 1.20, boxSize: 60 },
  },
}
const pickPreset = (): 'desktop' | 'portrait' =>
  Math.min(window.innerWidth, window.innerHeight) < 600 ? 'portrait' : 'desktop'

let cfg: Preset = PRESETS.desktop
let cardW = CARD_BASE_W   // current card width  in px (scaled per viewport + preset)
let cardH = CARD_BASE_H   // current card height in px

function computeScale(): void {
  cfg = PRESETS[pickPreset()]
  const viewportScale = Math.max(0.5, Math.min(1, Math.min(window.innerWidth, window.innerHeight) / 600))
  cardW = Math.round(CARD_BASE_W * viewportScale * cfg.cardScale)
  cardH = Math.round(CARD_BASE_H * viewportScale * cfg.cardScale)
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

// ── Asset preload (warms the cache so DOM background-images don't flash) ─
let assetsReady = false
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src })
}
async function loadAssets(): Promise<void> {
  if (assetsReady) return
  await Promise.all([
    loadImg('/Cards/Topdown/Card_Back-88x124.png'),
    ...SUITS.map(suit => loadImg(`/Cards/Topdown/${suit}-88x124.png`)),
  ])
  assetsReady = true
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

let root: HTMLElement | null = null
let initialized = false

// ── Entry ─────────────────────────────────────────────────────────
export async function initGame(rootEl: HTMLElement, mySocketId: string | undefined): Promise<void> {
  root = rootEl
  state.mySocketId = mySocketId ?? null
  if (!initialized) {
    await loadAssets()
    window.addEventListener('resize', render)
    initialized = true
  }
  render()
}

const seatAt = (pos: Position): RenderSeat =>
  state.seats.find(s => s.position === pos) ?? state.seats[0]

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

// ── Apply server events (state logic; render() rebuilds the DOM) ──────
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
    ? (state.seats.find(s => s.socketId === state.bidderSocketId)?.nickname ?? null)
    : null
  render()
}

export function applyBidState(data: BidStatePayload): void {
  state.bid = data.highBid
    ? { value: data.highBid.value, suit: data.highBid.suit, contree: data.contree }
    : null
  state.highBidderNickname = data.highBid?.bidderNickname ?? null
  const bidder = state.seats.find(s => s.socketId === data.currentBidderSocketId)
  state.bidderNickname = bidder?.nickname ?? null
  state.bidderSocketId = data.currentBidderSocketId
  const action = data.lastAction
  if (action) {
    const actor = state.seats.find(s => s.socketId === action.socketId)
    if (actor) actor.lastBidAction = action
  }
  render()
}

export function applyPlayStart(data: PlayStartPayload): void {
  pendingCard          = null
  state.bid            = data.bid
  state.trump          = data.trump
  state.bidderNickname = null
  state.bidderSocketId = null
  state.myHand         = sortHand(state.myHand, data.trump)
  render()
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

  const trickGrew = data.trick.length > state.pli.length
  if (trickGrew) {
    const lastPlayed = data.trick[data.trick.length - 1]
    if (lastPlayed.socketId !== state.mySocketId) soundPlay()
  }

  state.pli          = data.trick.map(({ rank, suit }) => ({ rank, suit }))
  state.isMyTurn     = data.currentPlayerSocketId === state.mySocketId
  state.trickMessage = null
  state.trickInfo    = {
    currentPlayerSocketId: data.currentPlayerSocketId,
    trickLeaderSocketId:   data.trickLeaderSocketId,
    scores:       data.scores,
    tricksPlayed: data.tricksPlayed,
  }
  if (!state.isMyTurn) state.validCards = []

  for (const s of state.seats) {
    if (!s.isMe) {
      const playedThisTrick = data.trick.some(t => t.socketId === s.socketId)
      s.cardCount = 8 - data.tricksPlayed - (playedThisTrick ? 1 : 0)
    }
  }
  render()
}

export function applyYourTurn(data: { validCards: Card[] }): void {
  state.validCards = data.validCards
  render()
}

export function applyTrickWon(data: TrickWonPayload): void {
  const lastCard = data.trick[data.trick.length - 1]
  if (lastCard?.socketId !== state.mySocketId) soundPlay()
  state.pli          = data.trick.map(({ rank, suit }) => ({ rank, suit }))
  state.trickMessage = `${data.winnerNickname} remporte le pli`
  if (state.trickInfo) {
    state.trickInfo.scores              = data.scores
    state.trickInfo.tricksPlayed        = data.tricksPlayed
    state.trickInfo.trickLeaderSocketId = data.winnerSocketId
  }
  for (const s of state.seats) { if (!s.isMe) s.cardCount = 8 - data.tricksPlayed }
  render()
}

// ── DOM building helpers ──────────────────────────────────────────
function makeCardEl(faceUp: boolean, rank?: Rank, suit?: Suit): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'g-card' + (faceUp ? '' : ' back')
  el.style.width = cardW + 'px'; el.style.height = cardH + 'px'
  if (faceUp && rank && suit) {
    const { col, row } = SPRITE[rank]
    el.style.backgroundImage    = `url(/Cards/Topdown/${suit}-88x124.png)`
    el.style.backgroundSize     = `${5 * cardW}px ${3 * cardH}px`
    el.style.backgroundPosition = `-${col * cardW}px -${row * cardH}px`
  } else {
    el.style.backgroundImage = `url(/Cards/Topdown/Card_Back-88x124.png)`
    el.style.backgroundSize  = `${cardW}px ${cardH}px`
  }
  return el
}
function place(el: HTMLElement, centerX: number, centerY: number, rotationDeg: number, scale: number): void {
  el.style.transform = `translate(${centerX - cardW / 2}px, ${centerY - cardH / 2}px) rotate(${rotationDeg}deg) scale(${scale})`
}
function isTurnSeat(socketId: string): boolean {
  if (state.trickInfo)      return state.trickInfo.currentPlayerSocketId === socketId
  if (state.bidderSocketId) return state.bidderSocketId === socketId
  return false
}

// Opponent / ally face-down hand (north/west/east) + plate.
function renderOpponent(pos: Position, frag: DocumentFragment): void {
  const seat = seatAt(pos)
  const count = seat.cardCount ?? 8
  const layout = layoutHand(pos, count)
  for (let i = 0; i < count; i++) {
    const cardEl = makeCardEl(false)
    place(cardEl, layout[i][0], layout[i][1], layout[i][2], layout[i][3])
    frag.appendChild(cardEl)
  }
  frag.appendChild(makePlate(seat))
}

// South face-up hand + interaction + plate. When a card is pending confirmation
// it lifts to centre (scaled), the rest stay put under the dim overlay.
function renderSouth(frag: DocumentFragment): void {
  const seat = seatAt('south')
  const count = state.myHand.length
  const layout = layoutHand('south', count)
  state.myHand.forEach(({ rank, suit }, i) => {
    const cardEl = makeCardEl(true, rank, suit)
    const isValid   = state.isMyTurn && state.validCards.some(c => c.rank === rank && c.suit === suit)
    const isPending = pendingCard?.rank === rank && pendingCard?.suit === suit
    if (isPending) {
      const area = playfield()
      cardEl.classList.add('lift')
      place(cardEl, area.centerX, area.centerY + cardH * cfg.confirm.cardY, 0, cfg.confirm.scale)
    } else {
      if (state.isMyTurn && !pendingCard) cardEl.classList.add(isValid ? 'valid' : 'invalid')
      place(cardEl, layout[i][0], layout[i][1], layout[i][2], layout[i][3])
      if (isValid && !pendingCard) {
        cardEl.addEventListener('pointerenter', soundHover)
        cardEl.addEventListener('click', () => enterConfirm(rank, suit))
      }
    }
    frag.appendChild(cardEl)
  })
  frag.appendChild(makePlate(seat))
}

// First tap on a valid card → arm confirmation (lift + dim + ✓/✗).
function enterConfirm(rank: Rank, suit: Suit): void {
  if (!state.isMyTurn || pendingCard) return
  if (!state.validCards.some(c => c.rank === rank && c.suit === suit)) return
  pendingCard = { rank, suit }
  render()
}
function cancelConfirm(): void {
  if (!pendingCard) return
  pendingCard = null
  render()
}
function confirmPlay(): void {
  const card = pendingCard
  pendingCard = null
  if (card) playCard(card.rank, card.suit)
}

function playCard(rank: Rank, suit: Suit): void {
  if (!state.isMyTurn) return
  const idx = state.myHand.findIndex(c => c.rank === rank && c.suit === suit)
  if (idx < 0) return
  if (!state.validCards.some(c => c.rank === rank && c.suit === suit)) return
  soundPlay()
  const card = state.myHand[idx]
  state.myHand.splice(idx, 1)
  state.isMyTurn = false
  state.validCards = []
  render()
  onCardPlay?.(card)
}

// Confirmation overlay: full-screen dim (tap = cancel) + ✓/✗ boxes flanking
// the lifted card. Layered purely by z-index (dim 70, lift 80, boxes 90).
function renderConfirm(frag: DocumentFragment): void {
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

// Seat name plate: name (ally/foe colour, turn frame), leader star, bid label.
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
function escapeText(text: string): string { const d = document.createElement('div'); d.textContent = text ?? ''; return d.innerHTML }

// Pli (current trick) fanned around centre by index.
function renderPli(frag: DocumentFragment): void {
  const area = playfield()
  const count = state.pli.length
  const fanSpread = 0.22 * cardW
  state.pli.forEach(({ rank, suit }, i) => {
    const cardEl = makeCardEl(true, rank, suit)
    const offset = i - (count - 1) / 2
    place(cardEl, area.centerX + offset * fanSpread, area.centerY, offset * cfg.pli.rot, 1)
    frag.appendChild(cardEl)
  })
  if (state.trickMessage) {
    const msgEl = document.createElement('div')
    msgEl.className = 'g-trickmsg'
    msgEl.textContent = state.trickMessage
    msgEl.style.left = area.centerX + 'px'; msgEl.style.top = (area.centerY + cardH * 0.92) + 'px'
    frag.appendChild(msgEl)
  }
}

// HUD: bid box during bidding; contract encart + trick scores during play.
function renderHUD(frag: DocumentFragment): void {
  const area = playfield()
  if (state.trickInfo === null) {
    const bid = state.bid
    const symbol = bid ? SUIT_SYMBOLS[bid.suit] : null
    const contreeLabel = bid?.contree === 'surcontree' ? ' SURCONTRÉ' : bid?.contree === 'contree' ? ' CONTRÉ' : ''
    const valueHTML = bid ? `${bid.value} <span class="${isRedSuit(bid.suit) ? 'red' : ''}">${symbol}</span>${contreeLabel}` : '—'
    let turnLabel = '', turnClass = ''
    if (state.bidderSocketId) {
      const bidder = state.seats.find(s => s.socketId === state.bidderSocketId)
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

  // Play phase — contract encart
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
  // Trick scores (top-left)
  const { scores, tricksPlayed } = state.trickInfo
  const trickHudEl = document.createElement('div')
  trickHudEl.className = 'g-trickhud'
  trickHudEl.innerHTML = `<div class="row"><span>Plis</span><span>${tricksPlayed + 1} / 8</span></div>` +
    `<div class="row"><span class="a">Nous</span><span class="a">${scores.A}</span></div>` +
    `<div class="row"><span class="b">Eux</span><span class="b">${scores.B}</span></div>`
  frag.appendChild(trickHudEl)
}

// ── Main render — full rebuild from state (juice/persistent nodes later) ─
export function render(): void {
  if (!root) return
  if (pendingCard && !state.isMyTurn) pendingCard = null   // drop stale confirmation
  computeScale()
  const frag = document.createDocumentFragment()
  renderOpponent('north', frag)
  renderOpponent('west', frag)
  renderOpponent('east', frag)
  renderPli(frag)
  renderSouth(frag)
  renderHUD(frag)
  renderConfirm(frag)
  root.replaceChildren(frag)
}
