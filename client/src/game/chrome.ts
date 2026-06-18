// ── Chrome (plates, HUD, trick message, confirm overlay) ──────────────
// Cheap "chrome" rebuilt from scratch on every update (no persistence): seat
// name plates, the bid/contract/trick HUD, the "X remporte le pli" message,
// and the tap-to-confirm dim + ✓/✗ boxes.

import { root } from './nodes.js'
import { cardW, cardH, cfg, playfield, platePos } from './layout.js'
import { SUIT_SYMBOLS, isRedSuit } from './cards.js'
import { state, seatAt, seatBySocket, ui } from './state.js'
import type { RenderSeat } from './state.js'
import { cancelConfirm, confirmPlay } from './index.js'

let chromeNodes: HTMLElement[] = []   // plates / HUD / trick message / confirm overlay (rebuilt each update)

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
  chromeNodes = Array.from(frag.children) as HTMLElement[]
  root.appendChild(frag)
}
