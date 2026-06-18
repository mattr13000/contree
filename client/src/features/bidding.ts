import { byId } from '../dom.js'
import { socket } from '../socket.js'
import { escapeHtml } from '../scoring.js'
import { initBidUI, hideBidOverlay, applyBidUIState } from '../bid-ui.js'
import { applyBidState, applyPlayStart, runAfterDeal } from '../game.js'
import { slamIn, scheduleHide, flashAnnouncement } from '../announcements.js'
import { getMyTeam } from '../clientState.js'
import { SUIT_SYMBOLS } from '../../../shared/constants.js'
import type { LastAction } from '../../../shared/types.js'

const BID_ACTION_MS = 1500

// Delays the bid UI by BID_ACTION_MS so the contrer modal can't pop over another
// player's just-shown action. Rapid actions cancel the previous timer.
let bidActionTimer: ReturnType<typeof setTimeout> | null = null

function showBidAction(action: LastAction): void {
  const el = byId('bid-action-announcement')
  if (action.type === 'bid') {
    const sym       = SUIT_SYMBOLS[action.suit] ?? action.suit
    const suitColor = (action.suit === 'Hearts' || action.suit === 'Diamonds') ? '#f07070' : '#f0e6c8'
    el.innerHTML    = `${action.value} <span style="color:${suitColor}">${sym}</span> <span style="font-size:0.6em;opacity:0.75">(${escapeHtml(action.nickname)})</span>`
    el.style.color  = '#f0e6c8'
  } else if (action.type === 'pass') {
    el.innerHTML   = `Passe <span style="font-size:0.6em;opacity:0.75">(${escapeHtml(action.nickname)})</span>`
    el.style.color = 'rgba(210,210,210,0.85)'
  } else {
    return  // contree has its own slam animation; just let the timer delay the bid UI
  }
  slamIn(el)
  scheduleHide(el, BID_ACTION_MS)
}

/** Bidding phase: bid UI callbacks, bid state, and the bid/contrée announcements. */
export function initBidding(): void {
  initBidUI({
    onPass:       ()     => socket.emit('bid:pass'),
    onBid:        (v, s) => socket.emit('bid:place', { value: v, suit: s }),
    onContree:    ()     => socket.emit('bid:contree'),
    onSurcontree: ()     => socket.emit('bid:surcontree'),
  })

  socket.on('bid:state', data => {
    applyBidState(data)
    if (data.lastAction) {
      if (bidActionTimer) clearTimeout(bidActionTimer)
      showBidAction(data.lastAction)
      bidActionTimer = setTimeout(() => runAfterDeal(() => applyBidUIState(data, socket.id!, getMyTeam())), BID_ACTION_MS)
    } else {
      runAfterDeal(() => applyBidUIState(data, socket.id!, getMyTeam()))
    }
  })

  socket.on('game:play-start', data => {
    if (bidActionTimer) clearTimeout(bidActionTimer)
    byId('bid-action-announcement').classList.add('hidden')
    hideBidOverlay()
    byId('surcontree-announcement').classList.add('hidden')
    byId('contree-announcement').classList.add('hidden')
    applyPlayStart(data)
  })

  socket.on('bid:contree-announced',    () => flashAnnouncement('contree-announcement', undefined, 2000))
  socket.on('bid:surcontree-announced', () => {
    hideBidOverlay()
    slamIn(byId('surcontree-announcement'))
  })
}
