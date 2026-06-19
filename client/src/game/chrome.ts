// ── Chrome (plates, HUD, trick message, confirm overlay) ──────────────
// Cheap "chrome" rebuilt from scratch on every update (no persistence): seat
// name plates, the bid/contract/trick HUD, the "X remporte le pli" message,
// and the tap-to-confirm dim + ✓/✗ boxes.

import { root } from './nodes.js'
import { cardW, cardH, cfg, playfield, platePos, pliOffset } from './layout.js'
import { SUIT_SYMBOLS, isRedSuit, cardSVG } from './cards.js'
import { state, seatAt, seatBySocket, ui } from './state.js'
import type { RenderSeat } from './state.js'
import type { Position } from '../../../shared/types.js'
import { TURN_TIMER_DANGER_MS } from '../../../shared/constants.js'
import { cancelConfirm, confirmPlay, toggleLastTrick, closeLastTrick } from './index.js'
import { isDealAnimating } from './animations.js'

const TIMER_RING_C = 2 * Math.PI * 16   // SVG ring circumference (r=16, viewBox 36)

/** Cercle + chiffre badge for the active seat (hidden during the deal cascade).
 *  Initial frame is painted inline so there's no blank flash; turnTimer.ts then
 *  updates it each frame. Returns '' when no countdown should show on this seat. */
function turnTimerMarkup(seat: RenderSeat): string {
  if (!isTurnSeat(seat.socketId) || state.turnDeadline == null || isDealAnimating()) return ''
  const remaining = Math.max(0, state.turnDeadline - performance.now())
  const frac = state.turnDuration > 0 ? Math.min(1, remaining / state.turnDuration) : 0
  const danger = remaining <= TURN_TIMER_DANGER_MS
  return `<div class="g-timer${danger ? ' danger' : ''}">` +
    `<svg class="g-timer-ring" viewBox="0 0 36 36"><circle class="g-timer-track" cx="18" cy="18" r="16"/>` +
    `<circle class="g-timer-bar" cx="18" cy="18" r="16" style="stroke-dasharray:${TIMER_RING_C};stroke-dashoffset:${TIMER_RING_C * (1 - frac)}"/></svg>` +
    `<span class="g-timer-num">${Math.ceil(remaining / 1000)}</span></div>`
}

let chromeNodes: HTMLElement[] = []   // plates / HUD / trick message / confirm overlay (rebuilt each update)

// Per-seat name tooltips revealed by a tap (the global toggle + desktop hover are CSS).
// Survives chrome rebuilds; a 2s timer clears each one and re-renders.
const revealed = new Set<Position>()
const revealTimers = new Map<Position, number>()
function toggleReveal(pos: Position): void {
  const t = revealTimers.get(pos)
  if (t !== undefined) { clearTimeout(t); revealTimers.delete(pos) }
  if (revealed.has(pos)) revealed.delete(pos)
  else {
    revealed.add(pos)
    revealTimers.set(pos, window.setTimeout(() => { revealed.delete(pos); revealTimers.delete(pos); renderChrome() }, 2000))
  }
  renderChrome()
}

function isTurnSeat(socketId: string): boolean {
  if (state.trickInfo)      return state.trickInfo.currentPlayerSocketId === socketId
  if (state.bidderSocketId) return state.bidderSocketId === socketId
  return false
}
function escapeText(text: string): string { const d = document.createElement('div'); d.textContent = text ?? ''; return d.innerHTML }

// Deterministic colour + initials from the pseudo (bots carry a "🤖 " prefix — strip
// non-letters so initials are the name's, while the hue still uses the full string).
function hueFromName(name: string): number { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 360 }
function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (parts[0] ?? name).slice(0, 2).toUpperCase()
}

function makePlate(seat: RenderSeat): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `g-seat ${seat.position} ${seat.isAlly ? 'ally' : 'foe'}${isTurnSeat(seat.socketId) ? ' turn' : ''}${revealed.has(seat.position) ? ' revealed' : ''}`
  const isLeader = state.trickInfo?.trickLeaderSocketId === seat.socketId
  let bidLabel = ''
  if (state.trickInfo === null && seat.lastBidAction) {
    const action = seat.lastBidAction
    if (action.type === 'pass')         bidLabel = `<div class="g-bid pass">Passe</div>`
    else if (action.type === 'contree') bidLabel = `<div class="g-bid contree">Contré</div>`
    else if (action.type === 'bid')     bidLabel = `<div class="g-bid ${isRedSuit(action.suit) ? 'red' : 'black'}">${action.value} ${SUIT_SYMBOLS[action.suit]}</div>`
  }
  const av = cfg.avatar, fill = `hsl(${hueFromName(seat.nickname)}, ${av.sat}%, ${av.light}%)`
  el.innerHTML =
    `<span class="g-star"${isLeader ? '' : ' style="visibility:hidden"'}>★</span>` +
    `<div class="g-avatar" style="background:${fill}">${escapeText(initials(seat.nickname))}${turnTimerMarkup(seat)}</div>` +
    bidLabel +
    `<div class="g-name-tip">${escapeText(seat.nickname)}</div>`
  el.style.fontSize = cfg.seatFontPx + 'px'   // base; ★ + bid label scale off it (em in CSS)
  const avEl = el.querySelector('.g-avatar') as HTMLElement
  avEl.style.width = avEl.style.height = av.size + 'px'
  avEl.style.borderWidth = av.ring + 'px'
  avEl.style.fontSize = Math.round(av.size * 0.4) + 'px'
  avEl.style.setProperty('--turn-glow', av.glow + 'px')
  avEl.style.setProperty('--turn-spin', av.spin + 's')
  avEl.addEventListener('click', e => { e.stopPropagation(); toggleReveal(seat.position) })
  // Size + anchor the timer badge (E/W below the avatar, N/S to its right).
  const tEl = el.querySelector('.g-timer') as HTMLElement | null
  if (tEl) {
    const t = cfg.timer
    tEl.style.width = tEl.style.height = (av.size * t.size) + 'px'
    const numEl = tEl.querySelector('.g-timer-num') as HTMLElement | null
    if (numEl) numEl.style.fontSize = (av.size * t.num) + 'px'
    if (seat.position === 'west' || seat.position === 'east') {
      tEl.style.top = `calc(100% + ${t.ewDy}px)`; tEl.style.left = `calc(50% + ${t.ewDx}px)`; tEl.style.transform = 'translateX(-50%)'
    } else {
      tEl.style.left = `calc(100% + ${t.nsDx}px)`; tEl.style.top = `calc(50% + ${t.nsDy}px)`; tEl.style.transform = 'translateY(-50%)'
    }
  }
  const [px, py] = platePos[seat.position]()
  el.style.left = px + 'px'; el.style.top = py + 'px'
  return el
}

function buildHUD(frag: DocumentFragment): void {
  const area = playfield()
  if (state.trickInfo === null) {
    // Hold the ENCHÈRE box until the deck deal + "Annonces" banner finish — it
    // shouldn't flash over the table while the cards are still flying out.
    if (isDealAnimating()) return
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
  // Single top-left HUD box: trick count, bid recap, and a "Dernier pli" review
  // button — so nothing floats over the middle of the table eating play space.
  const { tricksPlayed } = state.trickInfo
  const bid = state.bid
  const hud = document.createElement('div')
  hud.className = 'g-hud'
  let html = `<div class="g-hud-plis"><span>PLIS</span><b>${tricksPlayed + 1} / 8</b></div>`
  if (bid) {
    const symbol = SUIT_SYMBOLS[bid.suit]
    const mult = bid.contree === 'surcontree' ? ' <span class="mult">×4</span>'
               : bid.contree === 'contree'    ? ' <span class="mult">×2</span>' : ''
    html += `<div class="g-contract"><span class="lbl">CONTRAT </span><b>${bid.value} <span class="${isRedSuit(bid.suit) ? 'red' : ''}">${symbol}</span></b>${mult}</div>`
  }
  hud.innerHTML = html
  const lastBtn = document.createElement('button')
  lastBtn.className = 'g-hud-lastpli'
  lastBtn.textContent = 'Dernier pli'
  lastBtn.disabled = !state.lastTrick
  lastBtn.addEventListener('click', toggleLastTrick)
  hud.appendChild(lastBtn)
  frag.appendChild(hud)
}

// "Dernier pli" overlay: dim the table (like the play-confirm) and lay the last
// completed trick's 4 cards out exactly where they sat on the field. Tap to close.
function buildLastTrick(frag: DocumentFragment): void {
  if (!ui.lastTrickOpen || !state.lastTrick) return
  const area = playfield()
  const dim = document.createElement('div')
  dim.className = 'g-confirm-dim'
  dim.addEventListener('click', closeLastTrick)
  frag.appendChild(dim)
  state.lastTrick.forEach((t, i) => {
    const [ox, oy] = pliOffset(t.from)
    const el = document.createElement('div')
    el.className = 'g-card g-lasttrick-card'
    el.style.width = cardW + 'px'; el.style.height = cardH + 'px'
    el.innerHTML = cardSVG(t.rank, t.suit, true)
    el.style.left = (area.centerX + ox) + 'px'
    el.style.top  = (area.centerY + oy) + 'px'
    el.style.transform = `translate(-50%, -50%) rotate(${(i - 1.5) * cfg.pli.rot}deg)`
    frag.appendChild(el)
  })
}

function buildConfirm(frag: DocumentFragment): void {
  if (!ui.pendingCard || !state.isMyTurn) return
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

export function renderChrome(): void {
  if (!root) return
  chromeNodes.forEach(n => n.remove())
  chromeNodes = []
  const frag = document.createDocumentFragment()
  for (const pos of ['south', 'west', 'north', 'east'] as const) frag.appendChild(makePlate(seatAt(pos)))
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
  buildLastTrick(frag)
  chromeNodes = Array.from(frag.children) as HTMLElement[]
  root.appendChild(frag)
}
