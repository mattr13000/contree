import { showScreen } from './router.js'
import { soundHover, soundPlay } from './soundManager.js'

const CARD_W = 88
const CARD_H = 124
const HAND_GAP = 10
const FAN_ANGLE  = Math.PI / 18   // 10° per card in pli
const FAN_SPREAD = 22             // px horizontal spread per card in pli

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
  pli:              [],   // { rank, suit }[]  – cards played in current trick
  bid:              null, // { value, suit, contree } | null
  bidderNickname:   null, // nickname of player whose turn it is to bid
  highBidderNickname: null, // nickname of player who placed the current highest bid
  trump:         null,  // suit string during playing phase
  isMyTurn:      false,
  validCards:    [],    // { rank, suit }[] — cards the local player may play
  trickInfo:     null,  // { currentPlayerSocketId, scores, tricksPlayed }
  trickMessage:  null,  // brief "X remporte le pli" shown after trick:won
}

// ── Card play callback (set by main.js) ──────────────────────────
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
    canvas.addEventListener('click',     handleCanvasClick)
    canvas.addEventListener('mousemove', handleCanvasMouseMove)
    initialized = true
  }

  resize()
  render()
}

function handleCanvasClick(e) {
  if (!state.isMyTurn || !state.validCards.length) return
  const n = state.myHand.length
  if (!n) return
  const y  = canvas.height - CARD_H - 24
  const x0 = handX0(n)
  for (let i = n - 1; i >= 0; i--) {
    const cardX = x0 + i * (CARD_W + HAND_GAP)
    if (e.offsetX >= cardX && e.offsetX < cardX + CARD_W && e.offsetY >= y && e.offsetY < y + CARD_H) {
      const card = state.myHand[i]
      if (state.validCards.some(c => c.rank === card.rank && c.suit === card.suit)) {
        soundPlay()
        state.myHand.splice(i, 1)
        state.isMyTurn  = false
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
  const y  = canvas.height - CARD_H - 24
  const x0 = handX0(n)
  let pointer = false
  let hitIdx  = -1
  for (let i = 0; i < n; i++) {
    const cardX = x0 + i * (CARD_W + HAND_GAP)
    if (e.offsetX >= cardX && e.offsetX < cardX + CARD_W && e.offsetY >= y && e.offsetY < y + CARD_H) {
      const isValid = state.validCards.some(c => c.rank === state.myHand[i].rank && c.suit === state.myHand[i].suit)
      if (isValid) { pointer = true; hitIdx = i }
      break
    }
  }
  if (hitIdx !== -1 && hitIdx !== hoveredCardIdx) soundHover()
  hoveredCardIdx = hitIdx
  canvas.style.cursor = pointer ? 'pointer' : 'default'
}

// ── Apply server deal ─────────────────────────────────────────────
// Clockwise visual order from me: south(me) → west(left) → north(ally) → east(right)
export function applyDealt(data) {
  const myIdx  = data.seats.findIndex(s => s.socketId === state.mySocketId)
  const myTeam = data.seats[myIdx].team

  state.seats = [0, 1, 2, 3].map(offset => {
    const abs  = data.seats[(myIdx + offset) % 4]
    return {
      socketId:  abs.socketId,
      nickname:  abs.nickname,
      position:  ['south', 'west', 'north', 'east'][offset],
      team:      abs.team,
      isAlly:    abs.team === myTeam,
      isMe:      abs.socketId === state.mySocketId,
      cardCount: 8,
    }
  })

  state.myHand             = data.myHand
  state.pli                = []
  state.bid                = null
  state.bidderNickname     = null
  state.highBidderNickname = null
  render()
}

export function applyBidState(data) {
  state.bid = data.highBid
    ? { value: data.highBid.value, suit: data.highBid.suit, contree: data.contree }
    : null
  state.highBidderNickname = data.highBid?.bidderNickname ?? null
  const bidder = state.seats.find(s => s.socketId === data.currentBidderSocketId)
  state.bidderNickname = bidder?.nickname ?? null
  render()
}

export function applyPlayStart(data) {
  state.bid            = data.bid
  state.trump          = data.trump
  state.bidderNickname = null
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
  state.pli          = data.trick.map(({ rank, suit }) => ({ rank, suit }))
  state.trickMessage = `${data.winnerNickname} remporte le pli`
  if (state.trickInfo) {
    state.trickInfo.scores       = data.scores
    state.trickInfo.tricksPlayed = data.tricksPlayed
  }
  for (const s of state.seats) {
    if (!s.isMe) s.cardCount = 8 - data.tricksPlayed
  }
  render()
}

function resize() {
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight
}

// ── Main render ───────────────────────────────────────────────────
export function render() {
  if (!canvas || !assets?.back) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  drawNorth()
  drawWest()
  drawEast()
  drawPli()
  drawSouth()   // south last so hand overlaps pli zone if needed
  drawBidHUD()
  drawTrickInfo()
}

// ── Layout helpers ────────────────────────────────────────────────
function seat(pos) { return state.seats.find(s => s.position === pos) }

function handX0(count = 8) {
  return (canvas.width - (count * CARD_W + (count - 1) * HAND_GAP)) / 2
}

function cx() { return canvas.width  / 2 }
function cy() { return canvas.height / 2 }

// ── Draw helpers ──────────────────────────────────────────────────
function drawFace(rank, suit, x, y) {
  const { sx, sy } = SPRITE[rank]
  ctx.drawImage(assets.suits[suit], sx, sy, CARD_W, CARD_H, x, y, CARD_W, CARD_H)
}

function drawBack(x, y) {
  ctx.drawImage(assets.back, 0, 0, CARD_W, CARD_H, x, y, CARD_W, CARD_H)
}

// Rotated card back: (px,py) = canvas center of the card, angle in radians
function drawBackRotated(px, py, angle) {
  ctx.save()
  ctx.translate(px, py)
  ctx.rotate(angle)
  ctx.drawImage(assets.back, 0, 0, CARD_W, CARD_H, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H)
  ctx.restore()
}

function drawName(text, x, y, isAlly, align = 'center') {
  ctx.save()
  ctx.font         = 'bold 15px Georgia, serif'
  ctx.textAlign    = align
  ctx.textBaseline = 'middle'
  ctx.fillStyle    = isAlly ? '#6ab0ff' : '#ff7070'
  ctx.fillText(text, x, y)
  ctx.restore()
}

// ── South — face-up hand ──────────────────────────────────────────
function drawSouth() {
  const { nickname, isAlly } = seat('south')
  const n  = state.myHand.length
  const y  = canvas.height - CARD_H - 24
  const x0 = handX0(n)

  state.myHand.forEach(({ rank, suit }, i) => {
    const cardX   = x0 + i * (CARD_W + HAND_GAP)
    const isValid = state.isMyTurn && state.validCards.some(c => c.rank === rank && c.suit === suit)
    const cardY   = (isValid && i === hoveredCardIdx) ? y - 8 : y
    drawFace(rank, suit, cardX, cardY)
    if (state.isMyTurn && !isValid) {
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.fillRect(cardX, cardY, CARD_W, CARD_H)
      ctx.restore()
    }
    if (isValid) {
      ctx.save()
      ctx.strokeStyle = '#daa520'
      ctx.lineWidth   = 3
      ctx.strokeRect(cardX, cardY, CARD_W, CARD_H)
      ctx.restore()
    }
  })

  drawName(nickname, cx(), y - 22, isAlly)
}

// ── North — face-down hand ────────────────────────────────────────
function drawNorth() {
  const s = seat('north')
  const { nickname, isAlly } = s
  const n  = s.cardCount ?? 8
  const y  = 24
  const x0 = handX0(n)

  for (let i = 0; i < n; i++) drawBack(x0 + i * (CARD_W + HAND_GAP), y)

  drawName(nickname, cx(), y + CARD_H + 20, isAlly)
}

// ── West — rotated 90° CW (card appears CARD_H wide × CARD_W tall) ─
function drawWest() {
  const s = seat('west')
  const { nickname, isAlly } = s
  const n      = s.cardCount ?? 8
  const rotW   = CARD_H   // 124px wide on screen
  const rotH   = CARD_W   // 88px tall on screen
  const totalH = n * rotH + Math.max(0, n - 1) * HAND_GAP
  const cardCX = 20 + rotW / 2
  const y0     = (canvas.height - totalH) / 2

  for (let i = 0; i < n; i++) {
    drawBackRotated(cardCX, y0 + i * (rotH + HAND_GAP) + rotH / 2, Math.PI / 2)
  }

  drawName(nickname, 20 + rotW + 16, cy(), isAlly, 'left')
}

// ── East — rotated 90° CCW ────────────────────────────────────────
function drawEast() {
  const s = seat('east')
  const { nickname, isAlly } = s
  const n      = s.cardCount ?? 8
  const rotW   = CARD_H
  const rotH   = CARD_W
  const totalH = n * rotH + Math.max(0, n - 1) * HAND_GAP
  const cardCX = canvas.width - 20 - rotW / 2
  const y0     = (canvas.height - totalH) / 2

  for (let i = 0; i < n; i++) {
    drawBackRotated(cardCX, y0 + i * (rotH + HAND_GAP) + rotH / 2, -Math.PI / 2)
  }

  drawName(nickname, canvas.width - 20 - rotW - 16, cy(), isAlly, 'right')
}

// ── Pli zone ──────────────────────────────────────────────────────
function drawPli() {
  const pcx = cx(), pcy = cy()

  // Dashed border when zone is empty
  if (state.pli.length === 0) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth   = 1
    ctx.setLineDash([6, 4])
    ctx.strokeRect(pcx - 160, pcy - 110, 320, 220)
    ctx.restore()
    return
  }

  // Fan played cards
  const n = state.pli.length
  state.pli.forEach(({ rank, suit }, i) => {
    const angle   = (i - (n - 1) / 2) * FAN_ANGLE
    const offsetX = (i - (n - 1) / 2) * FAN_SPREAD
    const { sx, sy } = SPRITE[rank]

    ctx.save()
    ctx.translate(pcx + offsetX, pcy)
    ctx.rotate(angle)
    ctx.drawImage(assets.suits[suit], sx, sy, CARD_W, CARD_H,
      -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H)
    ctx.restore()
  })

  if (state.trickMessage) {
    ctx.save()
    ctx.font         = 'bold 15px Georgia, serif'
    ctx.fillStyle    = 'rgba(240,230,200,0.92)'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(state.trickMessage, pcx, pcy + CARD_H / 2 + 28)
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

  let turnText  = null
  let turnColor = 'rgba(240,230,200,0.65)'
  if (state.trickInfo) {
    const p = state.seats.find(s => s.socketId === state.trickInfo.currentPlayerSocketId)
    if (p) {
      turnText  = p.isMe ? 'Votre tour !' : `Tour de ${p.nickname}`
      turnColor = p.isMe ? '#daa520' : 'rgba(240,230,200,0.65)'
    }
  } else if (state.bidderNickname) {
    turnText = `Tour : ${state.bidderNickname}`
  }

  // Rows: always label + bid; optional bidder name + turn text
  const rows = [
    { text: 'ENCHÈRE', font: 'bold 10px Georgia, serif', color: 'rgba(240,230,200,0.45)', h: 16 },
    { text: bidText,   font: 'bold 18px Georgia, serif', color: 'rgba(240,230,200,0.90)', h: 26 },
  ]
  if (state.highBidderNickname)
    rows.push({ text: state.highBidderNickname, font: '11px Georgia, serif',   color: 'rgba(240,230,200,0.50)', h: 18 })
  if (turnText)
    rows.push({ text: turnText,                 font: 'bold 12px Georgia, serif', color: turnColor,                h: 18 })

  const PAD_X = 20, PAD_Y = 10
  const boxW  = 230
  const boxH  = rows.reduce((s, r) => s + r.h, 0) + PAD_Y * 2

  // Vertical: centred in the gap between pli border bottom and south hand / name
  const gapTop    = cy() + 115                        // just below pli dashed border
  const gapBottom = canvas.height - CARD_H - 24 - 28  // just above south player name
  const boxX = cx() - boxW / 2
  const boxY = Math.max(gapTop + 4,
               Math.min(gapBottom - boxH - 4,
                        (gapTop + gapBottom) / 2 - boxH / 2))

  ctx.save()

  ctx.fillStyle = 'rgba(0,0,0,0.30)'
  ctx.fillRect(boxX, boxY, boxW, boxH)

  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  let y = boxY + PAD_Y
  for (const row of rows) {
    ctx.font      = row.font
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

  ctx.save()
  ctx.font         = '13px Georgia, serif'
  ctx.fillStyle    = 'rgba(240,230,200,0.55)'
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`Plis : ${tricksPlayed + 1}/8`, 20, 20)
  ctx.fillText(`Éq. A : ${scores.A} pts`,     20, 40)
  ctx.fillText(`Éq. B : ${scores.B} pts`,     20, 60)
  ctx.restore()
}
