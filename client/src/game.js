import { soundHover, soundPlay } from './soundManager'

// ════════════════════════════════════════════════════════════════════
// DOM renderer (Étape 3, passe 1). Replaces the old canvas renderer with
// absolutely-positioned card <div>s using the approved proto layout. The
// public API (state, apply*, initGame, setOnCardPlay, render) is unchanged
// so features/*.ts keep working. Juice (GSAP, persistent nodes, deal
// cascade, sweep) and the tap-to-confirm play step come in later passes.
// ════════════════════════════════════════════════════════════════════

const BASE_W = 96      // card box base size (proto units; sprite art is stretched to fill)
const BASE_H = 134

// Sprite-sheet cell coords (native 88×124 px grid) per rank.
const SPRITE = {
  'A':  { col: 0, row: 0 }, '7':  { col: 1, row: 1 }, '8':  { col: 2, row: 1 },
  '9':  { col: 3, row: 1 }, '10': { col: 4, row: 1 }, 'J':  { col: 0, row: 2 },
  'Q':  { col: 1, row: 2 }, 'K':  { col: 2, row: 2 },
}
const SUITS        = ['Hearts', 'Diamonds', 'Clubs', 'Spades']
const SUIT_SYMBOLS = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' }
const RED = s => s === 'Hearts' || s === 'Diamonds'

// ── Tunable layout presets (baked from proto/game-ui.html) ───────────
// Desktop + portrait only — landscape phones get the force-portrait overlay.
const PRESET = {
  desktop: {
    page:  { margin: 0.098, maxAspect: 1.4 },
    cardScale: 1.15,
    south: { bottom: 0.30, step: 0.59, arc: 90, fan: 22, scale: 1.0 },
    north: { top: 0.43, step: 0.45, scale: 1.0 },
    side:  { edge: 0.44, step: 0.45, vshift: 0.0, scale: 0.95 },
    pli:   { spread: 0.78, rot: 6 },
    plate: { southY: 1.10, northY: 1.16, sideGap: 0.40, sideY: 0.0 },
    hud:   { bidY: 0.0, contractY: 0.92 },
  },
  portrait: {
    page:  { margin: 0.06, maxAspect: 1.4 },
    cardScale: 1.2,
    south: { bottom: 1.0, step: 0.5, arc: 80, fan: 22, scale: 1.1 },
    north: { top: -0.45, step: 0.24, scale: 0.9 },
    side:  { edge: -0.5, step: 0.4, vshift: 0.0, scale: 0.9 },
    pli:   { spread: 0.62, rot: 6 },
    plate: { southY: 1.9, northY: 0.55, sideGap: 0.45, sideY: 0.0 },
    hud:   { bidY: 0.0, contractY: 1.2 },
  },
}
const pickPreset = () => (Math.min(window.innerWidth, window.innerHeight) < 600) ? 'portrait' : 'desktop'
let cfg = PRESET.desktop
let CW = BASE_W, CH = BASE_H

function computeScale() {
  cfg = PRESET[pickPreset()]
  const vp = Math.max(0.5, Math.min(1, Math.min(window.innerWidth, window.innerHeight) / 600))
  CW = Math.round(BASE_W * vp * cfg.cardScale)
  CH = Math.round(BASE_H * vp * cfg.cardScale)
}

// Inner playfield, inset by margin and width-capped on wide screens.
function field() {
  const W = window.innerWidth, H = window.innerHeight
  const m = cfg.page.margin * Math.min(W, H)
  const hh = H / 2 - m
  let hw = W / 2 - m
  const cap = hh * cfg.page.maxAspect
  if (hw > cap) hw = cap
  return { cx: W / 2, cy: H / 2, hw, hh }
}

// Returns [cx, cy, rotDeg, scale] per card for a seat's hand of n cards.
function layoutHand(pos, n) {
  const f = field(), out = []
  if (pos === 'south') {
    const baseY = f.cy + f.hh - CH * cfg.south.bottom, step = CW * cfg.south.step
    for (let i = 0; i < n; i++) { const t = n > 1 ? i / (n - 1) - 0.5 : 0
      out.push([f.cx + t * step * (n - 1), baseY + t * t * cfg.south.arc, t * cfg.south.fan, cfg.south.scale]) }
  } else if (pos === 'north') {
    const step = CW * cfg.north.step, topY = f.cy - f.hh + CH * cfg.north.top
    for (let i = 0; i < n; i++) { const t = n > 1 ? i / (n - 1) - 0.5 : 0
      out.push([f.cx + t * step * (n - 1), topY, 180, cfg.north.scale]) }
  } else {
    const x = pos === 'west' ? f.cx - f.hw + CH * cfg.side.edge : f.cx + f.hw - CH * cfg.side.edge
    const step = CW * cfg.side.step, rot = pos === 'west' ? 90 : -90, cy = f.cy + cfg.side.vshift * 2 * f.hh
    for (let i = 0; i < n; i++) { const t = n > 1 ? i / (n - 1) - 0.5 : 0
      out.push([x, cy + t * step * (n - 1), rot, cfg.side.scale]) }
  }
  return out
}
const platePos = {
  south: () => { const f = field(); return [f.cx, f.cy + f.hh - CH * cfg.plate.southY] },
  north: () => { const f = field(); return [f.cx, f.cy - f.hh + CH * cfg.plate.northY] },
  west:  () => { const f = field(), hx = f.cx - f.hw + CH * cfg.side.edge, cy = f.cy + cfg.side.vshift * 2 * f.hh
                 return [hx + CH * cfg.side.scale * 0.5 + CW * cfg.plate.sideGap, cy + CW * cfg.plate.sideY] },
  east:  () => { const f = field(), hx = f.cx + f.hw - CH * cfg.side.edge, cy = f.cy + cfg.side.vshift * 2 * f.hh
                 return [hx - CH * cfg.side.scale * 0.5 - CW * cfg.plate.sideGap, cy + CW * cfg.plate.sideY] },
}

// ── Asset preload (warms the cache so DOM background-images don't flash) ─
let assetsReady = false
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src }) }
async function loadAssets() {
  if (assetsReady) return
  await Promise.all([
    loadImg('/Cards/Topdown/Card_Back-88x124.png'),
    ...SUITS.map(s => loadImg(`/Cards/Topdown/${s}-88x124.png`)),
  ])
  assetsReady = true
}

// ── Game state (shape unchanged — consumed by features/*.ts) ──────────
export const state = {
  mySocketId: null,
  seats: [
    { nickname: 'Vous',    position: 'south', isAlly: true,  isMe: true  },
    { nickname: 'Alice',   position: 'north', isAlly: true,  isMe: false },
    { nickname: 'Bob',     position: 'west',  isAlly: false, isMe: false },
    { nickname: 'Charlie', position: 'east',  isAlly: false, isMe: false },
  ],
  myHand: [],
  pli:              [],
  bid:              null,
  bidderNickname:   null,
  bidderSocketId:   null,
  highBidderNickname: null,
  trump:         null,
  isMyTurn:      false,
  validCards:    [],
  trickInfo:     null,
  trickMessage:  null,
}

let onCardPlay = null
export function setOnCardPlay(cb) { onCardPlay = cb }

let root = null, initialized = false

// ── Entry ─────────────────────────────────────────────────────────
export async function initGame(rootEl, mySocketId) {
  root = rootEl
  state.mySocketId = mySocketId
  if (!initialized) {
    await loadAssets()
    window.addEventListener('resize', render)
    initialized = true
  }
  render()
}

const seat = pos => state.seats.find(s => s.position === pos)

// ── Sorting (unchanged) ───────────────────────────────────────────
const SUIT_ORDER       = { Hearts: 0, Spades: 1, Diamonds: 2, Clubs: 3 }
const RANK_ORDER       = { A: 0, '10': 1, K: 2, Q: 3, J: 4, '9': 5, '8': 6, '7': 7 }
const RANK_ORDER_TRUMP = { J: 0, '9': 1, A: 2, '10': 3, K: 4, Q: 5, '8': 6, '7': 7 }
function sortHand(hand, trump = null) {
  return [...hand].sort((a, b) => {
    const suitDiff = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]
    if (suitDiff !== 0) return suitDiff
    const order = trump && a.suit === trump ? RANK_ORDER_TRUMP : RANK_ORDER
    return order[a.rank] - order[b.rank]
  })
}

// ── Apply server events (state logic unchanged; render() is now DOM) ──
export function applyDealt(data) {
  const myIdx  = data.seats.findIndex(s => s.socketId === state.mySocketId)
  const myTeam = data.seats[myIdx].team

  state.seats = [0, 1, 2, 3].map(offset => {
    const abs = data.seats[(myIdx + offset) % 4]
    return {
      socketId: abs.socketId, nickname: abs.nickname,
      position: ['south', 'west', 'north', 'east'][offset],
      team: abs.team, isAlly: abs.team === myTeam, isMe: abs.socketId === state.mySocketId,
      cardCount: 8, lastBidAction: null,
    }
  })

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

export function applyBidState(data) {
  state.bid = data.highBid
    ? { value: data.highBid.value, suit: data.highBid.suit, contree: data.contree }
    : null
  state.highBidderNickname = data.highBid?.bidderNickname ?? null
  const bidder = state.seats.find(s => s.socketId === data.currentBidderSocketId)
  state.bidderNickname  = bidder?.nickname ?? null
  state.bidderSocketId  = data.currentBidderSocketId
  if (data.lastAction?.socketId) {
    const actor = state.seats.find(s => s.socketId === data.lastAction.socketId)
    if (actor) actor.lastBidAction = data.lastAction
  }
  render()
}

export function applyPlayStart(data) {
  state.bid            = data.bid
  state.trump          = data.trump
  state.bidderNickname = null
  state.bidderSocketId = null
  state.myHand         = sortHand(state.myHand, data.trump)
  render()
}

export function applyPlayState(data) {
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

export function applyYourTurn(data) {
  state.validCards = data.validCards
  render()
}

export function applyTrickWon(data) {
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
function mkCard(faceUp, rank, suit) {
  const el = document.createElement('div')
  el.className = 'g-card' + (faceUp ? '' : ' back')
  el.style.width = CW + 'px'; el.style.height = CH + 'px'
  if (faceUp) {
    const { col, row } = SPRITE[rank]
    el.style.backgroundImage    = `url(/Cards/Topdown/${suit}-88x124.png)`
    el.style.backgroundSize     = `${5 * CW}px ${3 * CH}px`
    el.style.backgroundPosition = `-${col * CW}px -${row * CH}px`
  } else {
    el.style.backgroundImage = `url(/Cards/Topdown/Card_Back-88x124.png)`
    el.style.backgroundSize  = `${CW}px ${CH}px`
  }
  return el
}
function place(el, cx, cy, rot, sc) {
  el.style.transform = `translate(${cx - CW / 2}px, ${cy - CH / 2}px) rotate(${rot}deg) scale(${sc})`
}
function isTurnSeat(socketId) {
  if (state.trickInfo)      return state.trickInfo.currentPlayerSocketId === socketId
  if (state.bidderSocketId) return state.bidderSocketId === socketId
  return false
}

// Opponent / ally face-down hand (north/west/east) + plate.
function renderOpponent(pos, frag) {
  const s = seat(pos)
  const n = s.cardCount ?? 8
  const lay = layoutHand(pos, n)
  for (let i = 0; i < n; i++) { const el = mkCard(false); place(el, lay[i][0], lay[i][1], lay[i][2], lay[i][3]); frag.appendChild(el) }
  frag.appendChild(plate(s))
}

// South face-up hand + interaction + plate.
function renderSouth(frag) {
  const s = seat('south')
  const n = state.myHand.length
  const lay = layoutHand('south', n)
  state.myHand.forEach(({ rank, suit }, i) => {
    const el = mkCard(true, rank, suit)
    const isValid = state.isMyTurn && state.validCards.some(c => c.rank === rank && c.suit === suit)
    if (state.isMyTurn) el.classList.add(isValid ? 'valid' : 'invalid')
    place(el, lay[i][0], lay[i][1], lay[i][2], lay[i][3])
    if (isValid) {
      el.addEventListener('pointerenter', soundHover)
      el.addEventListener('click', () => playCard(rank, suit))
    }
    frag.appendChild(el)
  })
  frag.appendChild(plate(s))
}

function playCard(rank, suit) {
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

// Seat name plate: name (ally/foe colour, turn frame), leader star, bid label.
function plate(s) {
  const el = document.createElement('div')
  el.className = `g-seat ${s.isAlly ? 'ally' : 'foe'}${isTurnSeat(s.socketId) ? ' turn' : ''}`
  const isLeader = state.trickInfo?.trickLeaderSocketId === s.socketId
  let bid = ''
  if (state.trickInfo === null && s.lastBidAction) {
    const a = s.lastBidAction
    if (a.type === 'pass')         bid = `<div class="g-bid pass">Passe</div>`
    else if (a.type === 'contree') bid = `<div class="g-bid contree">Contré</div>`
    else if (a.type === 'bid')     bid = `<div class="g-bid ${RED(a.suit) ? 'red' : 'black'}">${a.value} ${SUIT_SYMBOLS[a.suit] ?? a.suit}</div>`
  }
  el.innerHTML = `<span class="g-star"${isLeader ? '' : ' style="visibility:hidden"'}>★</span><div class="g-name">${escapeText(s.nickname)}</div>${bid}`
  const [px, py] = platePos[s.position]()
  el.style.left = px + 'px'; el.style.top = py + 'px'
  return el
}
function escapeText(t) { const d = document.createElement('div'); d.textContent = t ?? ''; return d.innerHTML }

// Pli (current trick) fanned around centre by index (matches old canvas pli fan).
function renderPli(frag) {
  const f = field()
  const n = state.pli.length
  const fanSpread = 0.22 * CW
  state.pli.forEach(({ rank, suit }, i) => {
    const el = mkCard(true, rank, suit)
    const k = i - (n - 1) / 2
    place(el, f.cx + k * fanSpread, f.cy, k * cfg.pli.rot, 1)
    frag.appendChild(el)
  })
  if (state.trickMessage) {
    const el = document.createElement('div')
    el.className = 'g-trickmsg'
    el.textContent = state.trickMessage
    el.style.left = f.cx + 'px'; el.style.top = (f.cy + CH * 0.92) + 'px'
    frag.appendChild(el)
  }
}

// HUD: bid box during bidding; contract encart + trick scores during play.
function renderHUD(frag) {
  const f = field()
  if (state.trickInfo === null) {
    const bid = state.bid
    const sym = bid ? (SUIT_SYMBOLS[bid.suit] ?? bid.suit) : null
    const contree = bid?.contree === 'surcontree' ? ' SURCONTRÉ' : bid?.contree === 'contree' ? ' CONTRÉ' : ''
    const valHTML = bid ? `${bid.value} <span class="${RED(bid.suit) ? 'red' : ''}">${sym}</span>${contree}` : '—'
    let turn = '', turnCls = ''
    if (state.bidderSocketId) {
      const b = state.seats.find(s => s.socketId === state.bidderSocketId)
      if (b) { turn = b.isMe ? 'Votre tour !' : `Tour : ${escapeText(b.nickname)}`; turnCls = b.isMe ? 'me' : '' }
    }
    const el = document.createElement('div')
    el.className = 'g-bidhud'
    el.innerHTML = `<div class="lbl">ENCHÈRE</div><div class="val">${valHTML}</div>` +
      (state.highBidderNickname ? `<div class="holder">${escapeText(state.highBidderNickname)}</div>` : '') +
      (turn ? `<div class="turn ${turnCls}">${turn}</div>` : '')
    el.style.left = f.cx + 'px'; el.style.top = (f.cy + CH * cfg.hud.bidY) + 'px'
    frag.appendChild(el)
    return
  }

  // Play phase — contract encart
  const bid = state.bid
  if (bid) {
    const sym = SUIT_SYMBOLS[bid.suit] ?? bid.suit
    const mult = bid.contree === 'surcontree' ? ' <span class="mult">×4</span>'
               : bid.contree === 'contree'    ? ' <span class="mult">×2</span>' : ''
    const el = document.createElement('div')
    el.className = 'g-contract'
    el.innerHTML = `<span class="lbl">CONTRAT </span><b>${bid.value} <span class="${RED(bid.suit) ? 'red' : ''}">${sym}</span></b>${mult}`
    el.style.left = f.cx + 'px'; el.style.top = (f.cy + CH * cfg.hud.contractY) + 'px'
    frag.appendChild(el)
  }
  // Trick scores (top-left)
  const { scores, tricksPlayed } = state.trickInfo
  const th = document.createElement('div')
  th.className = 'g-trickhud'
  th.innerHTML = `<div class="row"><span>Plis</span><span>${tricksPlayed + 1} / 8</span></div>` +
    `<div class="row"><span class="a">Nous</span><span class="a">${scores.A}</span></div>` +
    `<div class="row"><span class="b">Eux</span><span class="b">${scores.B}</span></div>`
  frag.appendChild(th)
}

// ── Main render — full rebuild from state (juice/persistent nodes later) ─
export function render() {
  if (!root) return
  computeScale()
  const frag = document.createDocumentFragment()
  renderOpponent('north', frag)
  renderOpponent('west', frag)
  renderOpponent('east', frag)
  renderPli(frag)
  renderSouth(frag)
  renderHUD(frag)
  root.replaceChildren(frag)
}
