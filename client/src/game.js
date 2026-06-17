import { showScreen } from './router'
import { soundHover, soundPlay } from './soundManager'

const BASE_W          = 88
const BASE_H          = 124
const BASE_GAP        = 10
const FAN_ANGLE       = Math.PI / 18
const BASE_FAN_SPREAD = 22

// Scaled card dimensions — recomputed on each resize()
let scale     = 1
let cw        = BASE_W
let ch        = BASE_H
let hgap      = BASE_GAP
let fanSpread = BASE_FAN_SPREAD
let landscape = true

const SPRITE = {
  'A':  { sx: 0,   sy: 0   },
  '7':  { sx: 88,  sy: 124 },
  '8':  { sx: 176, sy: 124 },
  '9':  { sx: 264, sy: 124 },
  '10': { sx: 352, sy: 124 },
  'J':  { sx: 0,   sy: 248 },
  'Q':  { sx: 88,  sy: 248 },
  'K':  { sx: 176, sy: 248 },
}

const SUITS        = ['Hearts', 'Diamonds', 'Clubs', 'Spades']
const SUIT_SYMBOLS = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' }

let canvas, ctx, assets, initialized = false

// ── Assets ────────────────────────────────────────────────────────
function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}

async function loadAssets() {
  assets = { suits: {} }
  assets.back = await loadImg('/Cards/Topdown/Card_Back-88x124.png')
  for (const s of SUITS) {
    assets.suits[s] = await loadImg(`/Cards/Topdown/${s}-88x124.png`)
  }
}

// ── Game state ────────────────────────────────────────────────────
export const state = {
  mySocketId: null,
  seats: [
    { nickname: 'Vous',    position: 'south', isAlly: true,  isMe: true  },
    { nickname: 'Alice',   position: 'north', isAlly: true,  isMe: false },
    { nickname: 'Bob',     position: 'west',  isAlly: false, isMe: false },
    { nickname: 'Charlie', position: 'east',  isAlly: false, isMe: false },
  ],
  myHand: [
    { suit: 'Hearts',   rank: 'A'  },
    { suit: 'Hearts',   rank: '7'  },
    { suit: 'Hearts',   rank: '8'  },
    { suit: 'Hearts',   rank: '9'  },
    { suit: 'Spades',   rank: '10' },
    { suit: 'Spades',   rank: 'J'  },
    { suit: 'Diamonds', rank: 'Q'  },
    { suit: 'Clubs',    rank: 'K'  },
  ],
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

// ── Card play callback ────────────────────────────────────────────
let onCardPlay = null
export function setOnCardPlay(cb) { onCardPlay = cb }

let hoveredCardIdx = -1

// ── Entry ─────────────────────────────────────────────────────────
export async function initGame(canvasEl, mySocketId) {
  canvas = canvasEl
  ctx    = canvas.getContext('2d')
  state.mySocketId = mySocketId

  if (!initialized) {
    await loadAssets()
    window.addEventListener('resize', () => { resize(); render() })
    canvas.addEventListener('click',      handleCanvasClick)
    canvas.addEventListener('mousemove',  handleCanvasMouseMove)
    canvas.addEventListener('touchstart', handleCanvasTouch, { passive: false })
    initialized = true
  }

  resize()
  render()
}

// ── Scale / layout helpers ────────────────────────────────────────
function getScale() {
  // Scale down on mobile (min dimension < 600px); desktop stays at 1
  const minDim = Math.min(window.innerWidth, window.innerHeight)
  return minDim >= 600 ? 1 : Math.max(0.5, minDim / 600)
}

// Top edge of the south hand on canvas
function southY() {
  // Only pop fully visible during the play phase (not bid phase)
  if (scale < 1 && state.isMyTurn && state.trickInfo !== null) return canvas.height - ch - 16
  return scale < 1
    ? canvas.height - Math.round(ch * 0.55)
    : canvas.height - ch - 24
}

function cx() { return canvas.width  / 2 }
function cy() { return canvas.height / 2 }

function handX0(count = 8) {
  return (canvas.width - (count * cw + (count - 1) * hgap)) / 2
}

function seat(pos) { return state.seats.find(s => s.position === pos) }

// ── Input handlers ────────────────────────────────────────────────
function handleCanvasTouch(e) {
  e.preventDefault()
  const touch = e.changedTouches[0]
  const rect  = canvas.getBoundingClientRect()
  handleCanvasClick({
    offsetX: touch.clientX - rect.left,
    offsetY: touch.clientY - rect.top,
  })
}

function handleCanvasClick(e) {
  if (!state.isMyTurn || !state.validCards.length) return
  const n = state.myHand.length
  if (!n) return
  const y  = southY()
  const x0 = handX0(n)
  for (let i = n - 1; i >= 0; i--) {
    const cardX = x0 + i * (cw + hgap)
    if (e.offsetX >= cardX && e.offsetX < cardX + cw && e.offsetY >= y && e.offsetY < y + ch) {
      const card = state.myHand[i]
      if (state.validCards.some(c => c.rank === card.rank && c.suit === card.suit)) {
        soundPlay()
        state.myHand.splice(i, 1)
        state.isMyTurn   = false
        state.validCards = []
        render()
        onCardPlay?.(card)
      }
      break
    }
  }
}

function handleCanvasMouseMove(e) {
  if (!state.isMyTurn || !state.validCards.length) {
    canvas.style.cursor = 'default'
    hoveredCardIdx = -1
    return
  }
  const n = state.myHand.length
  if (!n) { canvas.style.cursor = 'default'; hoveredCardIdx = -1; return }
  const y  = southY()
  const x0 = handX0(n)
  let pointer = false
  let hitIdx  = -1
  for (let i = 0; i < n; i++) {
    const cardX = x0 + i * (cw + hgap)
    if (e.offsetX >= cardX && e.offsetX < cardX + cw && e.offsetY >= y && e.offsetY < y + ch) {
      const isValid = state.validCards.some(c => c.rank === state.myHand[i].rank && c.suit === state.myHand[i].suit)
      if (isValid) { pointer = true; hitIdx = i }
      break
    }
  }
  if (hitIdx !== -1 && hitIdx !== hoveredCardIdx) soundHover()
  hoveredCardIdx = hitIdx
  canvas.style.cursor = pointer ? 'pointer' : 'default'
}

// ── Sorting ───────────────────────────────────────────────────────
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

// ── Apply server events ───────────────────────────────────────────
export function applyDealt(data) {
  const myIdx  = data.seats.findIndex(s => s.socketId === state.mySocketId)
  const myTeam = data.seats[myIdx].team

  state.seats = [0, 1, 2, 3].map(offset => {
    const abs = data.seats[(myIdx + offset) % 4]
    return {
      socketId:      abs.socketId,
      nickname:      abs.nickname,
      position:      ['south', 'west', 'north', 'east'][offset],
      team:          abs.team,
      isAlly:        abs.team === myTeam,
      isMe:          abs.socketId === state.mySocketId,
      cardCount:     8,
      lastBidAction: null,
    }
  })

  state.myHand             = sortHand(data.myHand)
  state.pli                = []
  state.bid                = null
  state.highBidderNickname = null
  state.trickInfo          = null
  // Re-resolve bidderNickname from fresh seats in case bid:state arrived before this
  // event (round 1: bid:state can arrive during async loadAssets, before applyDealt runs).
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
  for (const s of state.seats) {
    if (!s.isMe) s.cardCount = 8 - data.tricksPlayed
  }
  render()
}

function resize() {
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight
  landscape = window.innerWidth > window.innerHeight
  scale     = getScale()
  cw        = Math.round(BASE_W * scale)
  ch        = Math.round(BASE_H * scale)
  hgap      = Math.round(BASE_GAP * scale)
  fanSpread = Math.round(BASE_FAN_SPREAD * scale)
}

// ── Main render ───────────────────────────────────────────────────
export function render() {
  if (!canvas || !assets?.back) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  drawNorth()
  drawWest()
  drawEast()
  drawPli()
  if (!state.isMyTurn) drawSouth()
  drawBidHUD()
  drawTrickInfo()
  if (state.isMyTurn) drawSouth()  // on top of HUD during the player's turn
}

// ── Draw helpers ──────────────────────────────────────────────────
function drawFace(rank, suit, x, y) {
  const { sx, sy } = SPRITE[rank]
  ctx.drawImage(assets.suits[suit], sx, sy, BASE_W, BASE_H, x, y, cw, ch)
}

function drawBack(x, y) {
  ctx.drawImage(assets.back, 0, 0, BASE_W, BASE_H, x, y, cw, ch)
}

// (px, py) = canvas centre of the card
function drawBackRotated(px, py, angle) {
  ctx.save()
  ctx.translate(px, py)
  ctx.rotate(angle)
  ctx.drawImage(assets.back, 0, 0, BASE_W, BASE_H, -cw / 2, -ch / 2, cw, ch)
  ctx.restore()
}

function isTurnSeat(socketId) {
  if (state.trickInfo)      return state.trickInfo.currentPlayerSocketId === socketId
  if (state.bidderSocketId) return state.bidderSocketId === socketId
  return false
}

// Draw the last bid action label below a player's name (bidding phase only).
const BID_ACTION_SUIT_SYMS = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' }
function drawSeatBidAction(action, x, y, align) {
  if (!action || state.trickInfo !== null) return
  const fs = Math.round(15 * Math.max(0.8, scale))
  let label, color
  if (action.type === 'bid') {
    const sym = BID_ACTION_SUIT_SYMS[action.suit] ?? action.suit
    label = `${action.value} ${sym}`
    color = (action.suit === 'Hearts' || action.suit === 'Diamonds') ? '#d07070' : 'rgba(240,230,200,0.75)'
  } else if (action.type === 'pass') {
    label = 'Passe'
    color = 'rgba(185,185,185,0.8)'
  } else if (action.type === 'contree') {
    label = 'Contré'
    color = '#c070d0'
  } else {
    return
  }
  ctx.save()
  ctx.font         = `${fs}px Georgia, serif`
  ctx.textAlign    = align
  ctx.textBaseline = 'top'
  ctx.lineJoin     = 'round'
  ctx.lineWidth    = 2
  ctx.strokeStyle  = 'rgba(0,0,0,0.7)'
  ctx.strokeText(label, x, y)
  ctx.fillStyle    = color
  ctx.fillText(label, x, y)
  ctx.restore()
}

function drawName(text, x, y, isAlly, align = 'center', isCurrentTurn = false, isLeader = false) {
  ctx.save()
  const fs = Math.round(15 * Math.max(0.8, scale))
  ctx.font         = `bold ${fs}px Georgia, serif`
  ctx.textAlign    = align
  ctx.textBaseline = 'middle'

  if (isCurrentTurn || isLeader) {
    const textW = ctx.measureText(text).width

    if (isCurrentTurn) {
      const padX = 6, padY = 3
      const rectH = fs * 1.4
      const rectX = align === 'center' ? x - textW / 2 - padX
                  : align === 'left'   ? x - padX
                  :                      x - textW - padX
      ctx.strokeStyle = '#daa520'
      ctx.lineWidth   = 2
      ctx.strokeRect(rectX, y - rectH / 2, textW + padX * 2, rectH)
    }

    if (isLeader) {
      const tokenFS = Math.round(10 * Math.max(0.8, scale))
      const tokenCX = align === 'center' ? x
                    : align === 'left'   ? x + textW / 2
                    :                      x - textW / 2
      const tokenY  = y - fs * 0.7 - tokenFS * 0.5 - 2
      ctx.font         = `${tokenFS}px sans-serif`
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth    = 2
      ctx.strokeStyle  = 'rgba(0,0,0,0.75)'
      ctx.strokeText('★', tokenCX, tokenY)
      ctx.fillStyle    = '#ffd700'
      ctx.fillText('★', tokenCX, tokenY)
      ctx.font      = `bold ${fs}px Georgia, serif`
      ctx.textAlign = align
    }
  }

  ctx.lineJoin     = 'round'
  ctx.lineWidth    = 3
  ctx.strokeStyle  = 'rgba(0,0,0,0.75)'
  ctx.strokeText(text, x, y)
  ctx.fillStyle    = isAlly ? '#6ab0ff' : '#ff7070'
  ctx.fillText(text, x, y)
  ctx.restore()
}

// ── South — face-up hand ──────────────────────────────────────────
function drawSouth() {
  const s = seat('south')
  const { nickname, isAlly, socketId } = s
  const n  = state.myHand.length
  const y  = southY()
  const x0 = handX0(n)

  state.myHand.forEach(({ rank, suit }, i) => {
    const cardX   = x0 + i * (cw + hgap)
    const isValid = state.isMyTurn && state.validCards.some(c => c.rank === rank && c.suit === suit)
    const cardY   = (isValid && i === hoveredCardIdx) ? y - 8 : y
    drawFace(rank, suit, cardX, cardY)
    if (state.isMyTurn && !isValid) {
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.fillRect(cardX, cardY, cw, ch)
      ctx.restore()
    }
    if (isValid) {
      ctx.save()
      ctx.strokeStyle = '#daa520'
      ctx.lineWidth   = 3
      ctx.strokeRect(cardX, cardY, cw, ch)
      ctx.restore()
    }
  })

  const isLeaderS  = !!(state.trickInfo?.trickLeaderSocketId === socketId)
  const nameFH_S   = Math.round(15 * Math.max(0.8, scale))
  // Position name high enough that bid-action text (same font size, drawn below) clears the cards
  const nameY_S    = y - 11 - Math.round(nameFH_S * 1.5)
  drawName(nickname, cx(), nameY_S, isAlly, 'center', isTurnSeat(socketId), isLeaderS)
  drawSeatBidAction(s.lastBidAction, cx(), nameY_S + Math.ceil(nameFH_S / 2) + 3, 'center')
}

// ── North — face-down hand ────────────────────────────────────────
function drawNorth() {
  const s = seat('north')
  const { nickname, isAlly, socketId } = s
  const n  = s.cardCount ?? 8
  // Allow cards to overflow the top on mobile; show the bottom edge + name
  const y  = scale < 1 ? -Math.round(ch * 0.35) : 24
  const x0 = handX0(n)

  for (let i = 0; i < n; i++) drawBack(x0 + i * (cw + hgap), y)

  const isLeaderN = !!(state.trickInfo?.trickLeaderSocketId === socketId)
  const nameY_N   = Math.max(14, y + ch + 14)
  const nameFH_N  = Math.round(15 * Math.max(0.8, scale))
  drawName(nickname, cx(), nameY_N, isAlly, 'center', isTurnSeat(socketId), isLeaderN)
  drawSeatBidAction(s.lastBidAction, cx(), nameY_N + Math.ceil(nameFH_N / 2) + 3, 'center')
}

// ── West — rotated 90° CW ─────────────────────────────────────────
// When rotated 90°: card height (ch) becomes the on-screen width,
// card width (cw) becomes the on-screen height.
function drawWest() {
  const s = seat('west')
  const { nickname, isAlly, socketId } = s
  const n    = s.cardCount ?? 8
  const rotW = ch   // on-screen width  of one rotated card
  const rotH = cw   // on-screen height of one rotated card
  // Desktop: spread with gap; mobile: tight stack (can overflow)
  const step    = scale < 1 ? 16 : rotH + hgap
  const totalH  = rotH + Math.max(0, n - 1) * step
  const cardCX  = 20 + rotW / 2
  const y0      = (canvas.height - totalH) / 2

  for (let i = 0; i < n; i++) {
    drawBackRotated(cardCX, y0 + i * step + rotH / 2, Math.PI / 2)
  }

  const isLeaderW = !!(state.trickInfo?.trickLeaderSocketId === socketId)
  const nameX_W   = 20 + rotW + 10
  const nameFH_W  = Math.round(15 * Math.max(0.8, scale))
  drawName(nickname, nameX_W, cy(), isAlly, 'left', isTurnSeat(socketId), isLeaderW)
  drawSeatBidAction(s.lastBidAction, nameX_W, cy() + Math.ceil(nameFH_W / 2) + 3, 'left')
}

// ── East — rotated 90° CCW ────────────────────────────────────────
function drawEast() {
  const s = seat('east')
  const { nickname, isAlly, socketId } = s
  const n    = s.cardCount ?? 8
  const rotW = ch
  const rotH = cw
  const step    = scale < 1 ? 16 : rotH + hgap
  const totalH  = rotH + Math.max(0, n - 1) * step
  const cardCX  = canvas.width - 20 - rotW / 2
  const y0      = (canvas.height - totalH) / 2

  for (let i = 0; i < n; i++) {
    drawBackRotated(cardCX, y0 + i * step + rotH / 2, -Math.PI / 2)
  }

  const isLeaderE = !!(state.trickInfo?.trickLeaderSocketId === socketId)
  const nameX_E   = canvas.width - 20 - rotW - 10
  const nameFH_E  = Math.round(15 * Math.max(0.8, scale))
  drawName(nickname, nameX_E, cy(), isAlly, 'right', isTurnSeat(socketId), isLeaderE)
  drawSeatBidAction(s.lastBidAction, nameX_E, cy() + Math.ceil(nameFH_E / 2) + 3, 'right')
}

// ── Pli zone ──────────────────────────────────────────────────────
function drawPli() {
  const pcx  = cx(), pcy = cy()
  const pliW = Math.round(320 * scale)
  const pliH = Math.round(220 * scale)

  if (state.pli.length === 0) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth   = 1
    ctx.setLineDash([6, 4])
    ctx.strokeRect(pcx - pliW / 2, pcy - pliH / 2, pliW, pliH)
    ctx.restore()
    return
  }

  const n = state.pli.length
  state.pli.forEach(({ rank, suit }, i) => {
    const angle   = (i - (n - 1) / 2) * FAN_ANGLE
    const offsetX = (i - (n - 1) / 2) * fanSpread
    const { sx, sy } = SPRITE[rank]

    ctx.save()
    ctx.translate(pcx + offsetX, pcy)
    ctx.rotate(angle)
    ctx.drawImage(assets.suits[suit], sx, sy, BASE_W, BASE_H, -cw / 2, -ch / 2, cw, ch)
    ctx.restore()
  })

  if (state.trickMessage) {
    ctx.save()
    ctx.font         = `bold ${Math.round(15 * scale)}px Georgia, serif`
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin     = 'round'
    ctx.lineWidth    = 3
    ctx.strokeStyle  = 'rgba(0,0,0,0.75)'
    ctx.strokeText(state.trickMessage, pcx, pcy + ch / 2 + 20)
    ctx.fillStyle    = 'rgba(240,230,200,0.92)'
    ctx.fillText(state.trickMessage, pcx, pcy + ch / 2 + 20)
    ctx.restore()
  }
}

// ── Bid HUD — centred between pli zone and south hand ────────────
function drawBidHUD() {
  const bid = state.bid
  const sym     = bid ? (SUIT_SYMBOLS[bid.suit] ?? bid.suit) : null
  const contree = bid?.contree === 'surcontree' ? ' SURCONTRÉ'
                : bid?.contree === 'contree'    ? ' CONTRÉ' : ''
  const bidText = bid ? `${bid.value} ${sym}${contree}` : '—'

  // Mobile landscape play phase: compact label at top-right
  if (scale < 1 && landscape && state.trickInfo !== null) {
    if (!bid) return
    const fs = Math.round(26 * Math.max(0.8, scale))
    ctx.save()
    ctx.font         = `bold ${fs}px Georgia, serif`
    ctx.textAlign    = 'right'
    ctx.textBaseline = 'top'
    ctx.lineJoin     = 'round'
    ctx.lineWidth    = 2
    ctx.strokeStyle  = 'rgba(0,0,0,0.75)'
    ctx.strokeText(bidText, canvas.width - 14, 14)
    ctx.fillStyle    = 'rgba(240,230,200,0.90)'
    ctx.fillText(bidText, canvas.width - 14, 14)
    ctx.restore()
    return
  }

  let turnText  = null
  let turnColor = 'rgba(240,230,200,0.65)'
  if (state.trickInfo) {
    const p = state.seats.find(s => s.socketId === state.trickInfo.currentPlayerSocketId)
    if (p) {
      turnText  = p.isMe ? 'Votre tour !' : `Tour de ${p.nickname}`
      turnColor = p.isMe ? '#daa520' : 'rgba(240,230,200,0.65)'
    }
  } else if (state.bidderSocketId) {
    const bidder = state.seats.find(s => s.socketId === state.bidderSocketId)
    if (bidder) turnText = `Tour : ${bidder.nickname}`
  }

  const hs = Math.max(0.75, scale)
  const rows = [
    { text: 'ENCHÈRE', font: `bold ${Math.round(10 * hs)}px Georgia, serif`, color: 'rgba(240,230,200,0.45)', h: Math.round(16 * hs) },
    { text: bidText,   font: `bold ${Math.round(36 * hs)}px Georgia, serif`, color: '#ffffff',               h: Math.round(52 * hs) },
  ]
  if (state.highBidderNickname)
    rows.push({ text: state.highBidderNickname, font: `${Math.round(11 * hs)}px Georgia, serif`,      color: 'rgba(240,230,200,0.50)', h: Math.round(18 * hs) })
  if (turnText)
    rows.push({ text: turnText,                 font: `bold ${Math.round(12 * hs)}px Georgia, serif`, color: turnColor,                h: Math.round(18 * hs) })

  const PAD_Y = 10
  const boxW  = Math.round(230 * hs)
  const boxH  = rows.reduce((s, r) => s + r.h, 0) + PAD_Y * 2

  const gapTop    = cy() + Math.round(110 * scale) + 5
  const gapBottom = southY() - 16
  const boxX = cx() - boxW / 2
  const boxY = Math.max(gapTop + 4,
               Math.min(gapBottom - boxH - 4,
                        (gapTop + gapBottom) / 2 - boxH / 2))

  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.30)'
  ctx.fillRect(boxX, boxY, boxW, boxH)

  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin     = 'round'
  ctx.lineWidth    = 2
  ctx.strokeStyle  = 'rgba(0,0,0,0.75)'
  let y = boxY + PAD_Y
  for (const row of rows) {
    ctx.font = row.font
    ctx.strokeText(row.text, cx(), y + row.h / 2)
    ctx.fillStyle = row.color
    ctx.fillText(row.text, cx(), y + row.h / 2)
    y += row.h
  }

  ctx.restore()
}

// ── Trick score (top-left) ────────────────────────────────────────
function drawTrickInfo() {
  if (!state.trickInfo) return
  const { scores, tricksPlayed } = state.trickInfo
  const isMobile = scale < 1
  const fs = Math.round((isMobile ? 26 : 13) * Math.max(0.8, scale))
  const lh = Math.round((isMobile ? 40 : 20) * Math.max(0.8, scale))

  const textLines = [
    `Plis : ${tricksPlayed + 1}/8`,
    `Éq. A : ${scores.A} pts`,
    `Éq. B : ${scores.B} pts`,
  ]
  const PAD_X = 10, PAD_Y = 8, MARGIN = 8

  ctx.save()
  ctx.font      = `${fs}px Georgia, serif`
  ctx.textAlign = 'left'

  const maxW = Math.max(...textLines.map(t => ctx.measureText(t).width))
  ctx.fillStyle = 'rgba(0,0,0,0.30)'
  ctx.fillRect(MARGIN, MARGIN, maxW + PAD_X * 2, lh * 3 + PAD_Y * 2)

  ctx.textBaseline = 'middle'
  ctx.lineJoin     = 'round'
  ctx.lineWidth    = 2
  ctx.strokeStyle  = 'rgba(0,0,0,0.75)'
  const entries = textLines.map((text, i) => ({
    text, x: MARGIN + PAD_X, y: MARGIN + PAD_Y + lh * i + lh / 2,
  }))
  for (const e of entries) ctx.strokeText(e.text, e.x, e.y)
  ctx.fillStyle = '#ffffff'
  for (const e of entries) ctx.fillText(e.text, e.x, e.y)
  ctx.restore()
}
