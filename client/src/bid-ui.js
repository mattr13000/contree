const BID_VALUES  = [80, 90, 100, 110, 120, 130, 140, 150, 160, 'Capot']
const SUIT_LABELS = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' }
function bidNumeric(v) { return v === 'Capot' ? 250 : v }

let selectedValue   = null
let selectedSuit    = null
let currentBidState = null
let currentMyTeam   = null

const bidOverlay    = document.getElementById('bid-overlay')
const bidCurrentEl  = document.getElementById('bid-current-info')
const bidValuesEl   = document.getElementById('bid-values')
const bidSuitsEl    = document.getElementById('bid-suits')
const btnPass       = document.getElementById('btn-pass')
const btnBid        = document.getElementById('btn-bid')
const btnContree    = document.getElementById('btn-contree')
const btnSurcontree = document.getElementById('btn-surcontree')

function refreshBidUI() {
  const myTeam = currentMyTeam
  const high   = currentBidState?.highBid

  if (high) {
    const sym = SUIT_LABELS[high.suit]
    const ct  = currentBidState.contree === 'surcontree' ? ' — SURCONTRÉ'
              : currentBidState.contree === 'contree'    ? ' — CONTRÉ' : ''
    bidCurrentEl.textContent = `Enchère actuelle : ${high.value} ${sym}${ct}`
  } else {
    bidCurrentEl.textContent = 'Aucune enchère pour l\'instant'
  }

  bidValuesEl.querySelectorAll('button').forEach(btn => {
    const v = btn.dataset.value === 'Capot' ? 'Capot' : parseInt(btn.dataset.value)
    btn.disabled = !!(high && bidNumeric(v) <= bidNumeric(high.value))
    btn.classList.toggle('selected', String(v) === String(selectedValue))
  })

  bidSuitsEl.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.suit === selectedSuit)
  })

  if (selectedValue !== null && high && bidNumeric(selectedValue) <= bidNumeric(high.value)) {
    selectedValue = null
  }

  const canBid = selectedValue !== null && selectedSuit !== null &&
    (!high || bidNumeric(selectedValue) > bidNumeric(high.value))
  btnBid.disabled = !canBid

  const iAmHighBidder = high?.team === myTeam
  const canContree    = !!(high && !iAmHighBidder && currentBidState.contree === false)
  const canSurcontree = !!(high &&  iAmHighBidder && currentBidState.contree === 'contree')
  btnContree.classList.toggle('hidden', !canContree)
  btnSurcontree.classList.toggle('hidden', !canSurcontree)
}

export function initBidUI({ onPass, onBid, onContree, onSurcontree }) {
  BID_VALUES.forEach(v => {
    const btn = document.createElement('button')
    btn.textContent   = v
    btn.dataset.value = String(v)
    btn.addEventListener('click', () => { selectedValue = v; refreshBidUI() })
    bidValuesEl.appendChild(btn)
  })

  Object.entries(SUIT_LABELS).forEach(([suit, symbol]) => {
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
  btnContree.addEventListener('click', () => { onContree(); hideBidOverlay() })
  btnSurcontree.addEventListener('click', () => { onSurcontree(); hideBidOverlay() })
}

export function hideBidOverlay() {
  bidOverlay.classList.add('hidden')
}

export function applyBidUIState(data, socketId, myTeam) {
  currentBidState = data
  currentMyTeam   = myTeam
  if (data.currentBidderSocketId === socketId) {
    refreshBidUI()
    bidOverlay.classList.remove('hidden')
  } else {
    hideBidOverlay()
  }
}
