import { io } from 'socket.io-client'
import { showScreen } from './router.js'
import { initGame, applyDealt, applyBidState, applyPlayStart,
         applyPlayState, applyYourTurn, applyTrickWon, setOnCardPlay } from './game.js'
import './style.css'

const socket = io()
setOnCardPlay(card => socket.emit('play:card', card))

// ── Session (reconnect support) ───────────────────────────────────
// Fires on first connect AND every socket.io auto-reconnect
socket.on('connect', () => {
  socket.emit('session:restore', sessionStorage.getItem('sessionId') || null)
})

socket.on('session:ready', ({ sessionId, restored }) => {
  sessionStorage.setItem('sessionId', sessionId)
  if (!restored) return   // fresh start — nickname screen already visible

  if (restored.state === 'lobby') {
    document.getElementById('lobby-greeting').textContent = `Bonjour, ${restored.nickname} !`
    showScreen('screen-lobby')
  } else if (restored.state === 'waiting') {
    renderWaiting(restored.room, restored.isCreator)
    showScreen('screen-waiting')
  } else if (restored.state === 'game') {
    myTeam = restored.dealt.seats.find(s => s.socketId === socket.id)?.team ?? null
    showScreen('game')
    initGame(document.getElementById('game'), socket.id).then(() => {
      applyDealt(restored.dealt)
      if (restored.bidState) {
        currentBidState = restored.bidState
        applyBidState(restored.bidState)
        if (restored.bidState.currentBidderSocketId === socket.id) {
          refreshBidUI()
          bidOverlay.classList.remove('hidden')
        }
      } else if (restored.playState) {
        applyPlayState(restored.playState)
        // play:your-turn will arrive separately via server's emitPlayState call
      }
    })
  }
})

// ── Nickname ─────────────────────────────────────────────────────
const inputNickname = document.getElementById('input-nickname')
const btnEnter      = document.getElementById('btn-enter')

function submitNickname() {
  const nick = inputNickname.value.trim()
  if (nick) socket.emit('nickname:set', nick)
}

btnEnter.addEventListener('click', submitNickname)
inputNickname.addEventListener('keydown', e => { if (e.key === 'Enter') submitNickname() })

socket.on('nickname:ok', nick => {
  document.getElementById('lobby-greeting').textContent = `Bonjour, ${nick} !`
  showScreen('screen-lobby')
})

// ── Lobby ─────────────────────────────────────────────────────────
document.getElementById('btn-create-room').addEventListener('click', () => {
  socket.emit('room:create')
})

document.getElementById('btn-browse-rooms').addEventListener('click', () => {
  socket.emit('lobby:enter')
  showScreen('screen-room-list')
})

// ── Room list ─────────────────────────────────────────────────────
socket.on('rooms:list', rooms => {
  const container = document.getElementById('rooms-container')
  if (rooms.length === 0) {
    container.innerHTML = '<p class="empty-message">Aucune partie disponible</p>'
    return
  }
  container.innerHTML = rooms.map(r => `
    <div class="room-row">
      <span>${r.name} — ${r.playerCount}/4</span>
      <button data-id="${r.id}">Rejoindre</button>
    </div>
  `).join('')

  container.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => socket.emit('room:join', btn.dataset.id))
  })
})

socket.on('room:error', () => {
  // Room was full or gone — refresh the list
  socket.emit('lobby:enter')
})

document.getElementById('btn-back-to-lobby').addEventListener('click', () => {
  socket.emit('lobby:leave')
  showScreen('screen-lobby')
})

// ── Waiting room ──────────────────────────────────────────────────
function renderWaiting(room, isCreator) {
  document.getElementById('room-title').textContent = room.name

  document.getElementById('player-slots').innerHTML =
    Array.from({ length: 4 }, (_, i) => {
      const p = room.players[i]
      if (!p) return '<div class="slot">En attente d\'un joueur…</div>'
      const isMe      = p.id === socket.id
      const isCreator = p.id === room.creatorId
      return `<div class="slot filled">
        <span>${p.nickname}${isMe ? ' (vous)' : ''}</span>
        ${isCreator ? '<span class="slot-badge">créateur</span>' : ''}
      </div>`
    }).join('')

  const btnStart = document.getElementById('btn-start')
  btnStart.classList.toggle('hidden', !isCreator)
  btnStart.disabled = room.players.length < 4
}

socket.on('room:joined', ({ room, isCreator }) => {
  renderWaiting(room, isCreator)
  showScreen('screen-waiting')
})

socket.on('room:updated', room => {
  renderWaiting(room, room.creatorId === socket.id)
})

document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('room:start')
})

document.getElementById('btn-leave-room').addEventListener('click', () => {
  socket.emit('room:leave')
})

socket.on('room:left', () => {
  showScreen('screen-lobby')
})

// ── Game ──────────────────────────────────────────────────────────
let myTeam = null

socket.on('game:dealt', async data => {
  myTeam = data.seats.find(s => s.socketId === socket.id)?.team ?? null
  showScreen('game')
  await initGame(document.getElementById('game'), socket.id)
  applyDealt(data)
})

// ── Bidding ───────────────────────────────────────────────────────
const BID_VALUES  = [80, 90, 100, 110, 120, 130, 140, 150, 160, 'Capot']
const SUIT_LABELS = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' }

let selectedValue    = null
let selectedSuit     = null
let currentBidState  = null

const bidOverlay    = document.getElementById('bid-overlay')
const bidCurrentEl  = document.getElementById('bid-current-info')
const bidValuesEl   = document.getElementById('bid-values')
const bidSuitsEl    = document.getElementById('bid-suits')
const btnPass       = document.getElementById('btn-pass')
const btnBid        = document.getElementById('btn-bid')
const btnContree    = document.getElementById('btn-contree')
const btnSurcontree = document.getElementById('btn-surcontree')

function bidNumeric(v) { return v === 'Capot' ? 250 : v }

// Build value and suit buttons once at startup
BID_VALUES.forEach(v => {
  const btn = document.createElement('button')
  btn.textContent  = v
  btn.dataset.value = String(v)
  btn.addEventListener('click', () => {
    selectedValue = v
    refreshBidUI()
  })
  bidValuesEl.appendChild(btn)
})

Object.entries(SUIT_LABELS).forEach(([suit, symbol]) => {
  const btn = document.createElement('button')
  btn.textContent  = symbol
  btn.dataset.suit = suit
  btn.addEventListener('click', () => {
    selectedSuit = suit
    refreshBidUI()
  })
  bidSuitsEl.appendChild(btn)
})

function refreshBidUI() {
  const high = currentBidState?.highBid

  // Update "current bid" label
  if (high) {
    const sym = SUIT_LABELS[high.suit]
    const ct  = currentBidState.contree === 'surcontree' ? ' — SURCONTRÉ'
              : currentBidState.contree === 'contree'    ? ' — CONTRÉ' : ''
    bidCurrentEl.textContent = `Enchère actuelle : ${high.value} ${sym}${ct}`
  } else {
    bidCurrentEl.textContent = 'Aucune enchère pour l\'instant'
  }

  // Value buttons: disable those that can't top the current bid
  bidValuesEl.querySelectorAll('button').forEach(btn => {
    const v = btn.dataset.value === 'Capot' ? 'Capot' : parseInt(btn.dataset.value)
    btn.disabled = !!(high && bidNumeric(v) <= bidNumeric(high.value))
    btn.classList.toggle('selected', String(v) === String(selectedValue))
  })

  // Suit buttons
  bidSuitsEl.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.suit === selectedSuit)
  })

  // If selected value is now disabled, clear it
  if (selectedValue !== null && high && bidNumeric(selectedValue) <= bidNumeric(high.value)) {
    selectedValue = null
  }

  // Announce button: needs a valid value AND suit
  const canBid = selectedValue !== null && selectedSuit !== null &&
    (!high || bidNumeric(selectedValue) > bidNumeric(high.value))
  btnBid.disabled = !canBid

  // Contrée: opponent of current high bidder, contree not yet set
  const iAmHighBidder = high?.team === myTeam
  const canContree    = !!(high && !iAmHighBidder && currentBidState.contree === false)
  const canSurcontree = !!(high &&  iAmHighBidder && currentBidState.contree === 'contree')

  btnContree.classList.toggle('hidden', !canContree)
  btnSurcontree.classList.toggle('hidden', !canSurcontree)
}

socket.on('bid:state', data => {
  currentBidState = data
  applyBidState(data)

  if (data.currentBidderSocketId === socket.id) {
    refreshBidUI()
    bidOverlay.classList.remove('hidden')
  } else {
    bidOverlay.classList.add('hidden')
  }
})

socket.on('game:play-start', data => {
  bidOverlay.classList.add('hidden')
  document.getElementById('surcontree-announcement').classList.add('hidden')
  currentBidState = null
  applyPlayStart(data)
})

btnPass.addEventListener('click', () => {
  socket.emit('bid:pass')
  bidOverlay.classList.add('hidden')
})

btnBid.addEventListener('click', () => {
  if (!selectedValue || !selectedSuit) return
  socket.emit('bid:place', { value: selectedValue, suit: selectedSuit })
  selectedValue = null
  selectedSuit  = null
  bidOverlay.classList.add('hidden')
})

btnContree.addEventListener('click', () => {
  socket.emit('bid:contree')
  bidOverlay.classList.add('hidden')
})

btnSurcontree.addEventListener('click', () => {
  socket.emit('bid:surcontree')
  bidOverlay.classList.add('hidden')
})

socket.on('bid:surcontree-announced', () => {
  bidOverlay.classList.add('hidden')
  const el = document.getElementById('surcontree-announcement')
  el.classList.remove('hidden')
  // Reset animation so it replays if triggered again
  el.style.animation = 'none'
  el.offsetHeight   // force reflow
  el.style.animation = ''
})

// ── Trick play ────────────────────────────────────────────────────
socket.on('play:state',    data => applyPlayState(data))
socket.on('play:your-turn', data => applyYourTurn(data))
socket.on('trick:won',     data => applyTrickWon(data))
socket.on('play:belote',   ({ nickname, type }) => {
  // Brief console log; Step E will surface this in the UI
  console.log(`[belote] ${nickname} : ${type}`)
})
socket.on('game:over', _data => {
  // Step E — scoring modal will be built here
})
