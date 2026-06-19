import { byId } from '../core/dom.js'
import { escapeHtml } from './scoring.js'
import { BID_VALUES, SUIT_SYMBOLS as SUIT_LABELS, bidNumeric } from '../../../shared/constants.js'
import type { Suit, Team, BidValue, BidStatePayload } from '../../../shared/types.js'

let selectedValue:   BidValue | null = null
let selectedSuit:    Suit | null = null
let currentBidState: BidStatePayload | null = null
let currentMyTeam:   Team | null = null

const bidOverlay    = byId('bid-overlay')
const bidCurrentEl  = byId('bid-current-info')
const bidValuesEl   = byId('bid-values')
const bidSuitsEl    = byId('bid-suits')
const btnPass       = byId<HTMLButtonElement>('btn-pass')
const btnBid        = byId<HTMLButtonElement>('btn-bid')
const btnContree    = byId<HTMLButtonElement>('btn-contree')
const btnSurcontree = byId<HTMLButtonElement>('btn-surcontree')

const contrerModal    = byId('contrer-modal')
const contrerModalBid = byId('contrer-modal-bid')
const contrerModalQ   = byId('contrer-modal-question')
let   contrerModalType: 'contree' | 'surcontree' | null = null

function hideContrerModal(): void {
  contrerModal.classList.add('hidden')
  contrerModalType = null
}

function showContrerModal(question: string, bidLabel: string, type: 'contree' | 'surcontree'): void {
  contrerModalQ.textContent   = question
  contrerModalBid.textContent = bidLabel
  contrerModalType = type
  contrerModal.classList.remove('hidden')
}

function refreshBidUI(): void {
  const myTeam = currentMyTeam
  const high   = currentBidState?.highBid

  if (high) {
    const sym = SUIT_LABELS[high.suit]
    const ct  = currentBidState?.contree === 'surcontree' ? ' — SURCONTRÉ'
              : currentBidState?.contree === 'contree'    ? ' — CONTRÉ' : ''
    const teamCls = high.team === myTeam ? 'ally' : 'foe'
    bidCurrentEl.innerHTML =
      `<div class="bid-current-bid">${high.value} ${sym}${ct}</div>` +
      `<div class="bid-current-bidder">par <span class="${teamCls}">${escapeHtml(high.bidderNickname)}</span></div>`
  } else {
    bidCurrentEl.innerHTML = '<div class="bid-current-empty">Aucune enchère pour l\'instant</div>'
  }

  const isContreed = !!(currentBidState?.contree)

  if (isContreed) {
    selectedValue = null
    selectedSuit  = null
  }

  bidValuesEl.querySelectorAll('button').forEach(btn => {
    const raw = btn.dataset.value
    const v: BidValue = raw === 'Capot' ? 'Capot' : parseInt(raw ?? '')
    btn.disabled = isContreed || !!(high && bidNumeric(v) <= bidNumeric(high.value))
    btn.classList.toggle('selected', !isContreed && String(v) === String(selectedValue))
  })

  bidSuitsEl.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('selected', !isContreed && btn.dataset.suit === selectedSuit)
  })

  if (!isContreed && selectedValue !== null && high && bidNumeric(selectedValue) <= bidNumeric(high.value)) {
    selectedValue = null
  }

  const canBid = !isContreed && selectedValue !== null && selectedSuit !== null &&
    (!high || bidNumeric(selectedValue) > bidNumeric(high.value))
  btnBid.disabled = !canBid

  const iAmHighBidder = high?.team === myTeam
  const canContree    = !!(high && !iAmHighBidder && currentBidState?.contree === false)
  const canSurcontree = !!(high &&  iAmHighBidder && currentBidState?.contree === 'contree')
  btnContree.classList.toggle('hidden', !canContree)
  btnSurcontree.classList.toggle('hidden', !canSurcontree)
}

interface BidUICallbacks {
  onPass:       () => void
  onBid:        (value: BidValue, suit: Suit) => void
  onContree:    () => void
  onSurcontree: () => void
}

export function initBidUI({ onPass, onBid, onContree, onSurcontree }: BidUICallbacks): void {
  BID_VALUES.forEach(v => {
    const btn = document.createElement('button')
    btn.textContent   = String(v)
    btn.dataset.value = String(v)
    btn.addEventListener('click', () => { selectedValue = v; refreshBidUI() })
    bidValuesEl.appendChild(btn)
  })

  ;(Object.entries(SUIT_LABELS) as [Suit, string][]).forEach(([suit, symbol]) => {
    const btn = document.createElement('button')
    btn.textContent  = symbol
    btn.dataset.suit = suit
    btn.addEventListener('click', () => { selectedSuit = suit; refreshBidUI() })
    bidSuitsEl.appendChild(btn)
  })

  btnPass.addEventListener('click', () => { onPass(); hideBidOverlay() })
  btnBid.addEventListener('click', () => {
    if (!selectedValue || !selectedSuit) return
    onBid(selectedValue, selectedSuit)
    selectedValue = null
    selectedSuit  = null
    hideBidOverlay()
  })
  btnContree.addEventListener('click', () => {
    hideBidOverlay()
    const high = currentBidState?.highBid
    const sym  = high ? SUIT_LABELS[high.suit] : ''
    showContrerModal('Contrer ?', `${high?.value} ${sym}`, 'contree')
  })
  btnSurcontree.addEventListener('click', () => {
    hideBidOverlay()
    const high = currentBidState?.highBid
    const sym  = high ? SUIT_LABELS[high.suit] : ''
    showContrerModal('Surcontrer ?', `${high?.value} ${sym} — CONTRÉ`, 'surcontree')
  })

  // Contrer/surcontrer modal buttons
  byId('btn-contrer-oui').addEventListener('click', () => {
    const type = contrerModalType
    hideContrerModal()
    if (type === 'contree')         { onContree();    hideBidOverlay() }
    else if (type === 'surcontree') { onSurcontree(); hideBidOverlay() }
  })

  byId('btn-contrer-non').addEventListener('click', () => {
    hideContrerModal()
    refreshBidUI()
    bidOverlay.classList.remove('hidden')
  })
}

export function hideBidOverlay(): void {
  bidOverlay.classList.add('hidden')
  hideContrerModal()
}

export function applyBidUIState(data: BidStatePayload, socketId: string, myTeam: Team | null): void {
  currentBidState = data
  currentMyTeam   = myTeam

  if (data.currentBidderSocketId !== socketId) {
    hideBidOverlay()
    return
  }

  hideContrerModal()
  refreshBidUI()
  bidOverlay.classList.remove('hidden')
}
