import { io } from 'socket.io-client'
import { showScreen } from './router.js'
import { initGame, applyDealt, applyBidState, applyPlayStart,
         applyPlayState, applyYourTurn, applyTrickWon, setOnCardPlay, state } from './game.js'
import { toggleMute, startMusic, toggleMusicMute } from './soundManager.js'
import './style.css'

const muteBtn  = document.getElementById('mute-btn')
const musicBtn = document.getElementById('music-btn')

muteBtn.addEventListener('click', () => {
  const muted = toggleMute()
  muteBtn.textContent = muted ? '🔇' : '🔊'
})

musicBtn.addEventListener('click', () => {
  const muted = toggleMusicMute()
  musicBtn.classList.toggle('muted', muted)
})

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

  startMusic()

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
  if (nick) { startMusic(); socket.emit('nickname:set', nick) }
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
  gameScores     = []
  scoreTeamNames = { my: [], opp: [] }
  document.getElementById('score-panel').classList.add('hidden')
  document.getElementById('score-btn').classList.add('hidden')
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
  document.getElementById('score-panel').classList.add('hidden')
  document.getElementById('score-btn').classList.add('hidden')
  showScreen('screen-lobby')
})

// ── Game ──────────────────────────────────────────────────────────
let myTeam         = null
let gameScores     = []
let scoreTeamNames = { my: [], opp: [] }

// Contract scoring per official French Contrée rules
function computeGameScore(scores, tricksWon, beloteBonus, bid) {
  const bTeam = bid.team
  const oTeam = bTeam === 'A' ? 'B' : 'A'
  const mult  = bid.contree === 'surcontree' ? 4 : bid.contree === 'contree' ? 2 : 1

  const bCardTotal = scores[bTeam] + beloteBonus[bTeam]
  const fulfilled  = bid.value === 'Capot'
    ? tricksWon[oTeam] === 0   // Capot = all 8 tricks won, opponent got 0 tricks
    : bCardTotal >= bid.value

  const contractValue = (bid.value === 'Capot' ? 250 : bid.value) * mult

  const result = { A: 0, B: 0 }
  if (fulfilled) {
    // Bidding team scores exactly their contract value (excess card pts discarded)
    result[bTeam] = contractValue + beloteBonus[bTeam]
    result[oTeam] = beloteBonus[oTeam]
  } else {
    // Chute: bidding team 0, opponents get fixed 160 × multiplier
    result[bTeam] = beloteBonus[bTeam]
    result[oTeam] = 160 * mult + beloteBonus[oTeam]
  }
  return { result, fulfilled }
}

function buildScoreTableHTML() {
  const myNames  = scoreTeamNames.my.join(' & ')
  const oppNames = scoreTeamNames.opp.join(' & ')
  const myTotal  = gameScores.reduce((s, g) => s + g.my,  0)
  const oppTotal = gameScores.reduce((s, g) => s + g.opp, 0)
  const rows = gameScores.length
    ? gameScores.map(g => `<tr><td>${g.my}</td><td>${g.opp}</td></tr>`).join('')
    : `<tr><td colspan="2" style="color:rgba(240,230,200,0.3);font-style:italic;padding:4px 0">—</td></tr>`
  return `<table class="score-table">
    <thead><tr>
      <th style="color:#6ab0ff">${myNames || '…'}</th>
      <th style="color:#ff7070">${oppNames || '…'}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>${myTotal}</td><td>${oppTotal}</td></tr></tfoot>
  </table>`
}

function updateScoreUI() {
  const html = buildScoreTableHTML()
  document.getElementById('score-panel').innerHTML = html
  document.getElementById('score-modal-content').innerHTML = html
}

socket.on('game:dealt', async data => {
  document.getElementById('game-over-modal').classList.add('hidden')
  myTeam = data.seats.find(s => s.socketId === socket.id)?.team ?? null
  const ot = myTeam === 'A' ? 'B' : 'A'
  scoreTeamNames = {
    my:  data.seats.filter(s => s.team === myTeam).map(s => s.nickname),
    opp: data.seats.filter(s => s.team === ot).map(s => s.nickname),
  }
  document.getElementById('score-panel').classList.remove('hidden')
  document.getElementById('score-btn').classList.remove('hidden')
  updateScoreUI()
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
  document.getElementById('contree-announcement').classList.add('hidden')
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

function flashAnnouncement(id, text, duration = 2000) {
  const el = document.getElementById(id)
  if (text !== undefined) el.textContent = text
  el.classList.remove('hidden')
  el.style.animation = 'none'
  el.offsetHeight
  el.style.animation = ''
  clearTimeout(el._hideTimer)
  el._hideTimer = setTimeout(() => el.classList.add('hidden'), duration)
}

socket.on('bid:contree-announced', () => {
  flashAnnouncement('contree-announcement', undefined, 2000)
})

socket.on('bid:surcontree-announced', () => {
  bidOverlay.classList.add('hidden')
  const el = document.getElementById('surcontree-announcement')
  el.classList.remove('hidden')
  el.style.animation = 'none'
  el.offsetHeight
  el.style.animation = ''
})

// ── Trick play ────────────────────────────────────────────────────
socket.on('play:state',    data => applyPlayState(data))
socket.on('play:your-turn', data => applyYourTurn(data))
socket.on('trick:won',     data => applyTrickWon(data))
socket.on('play:belote', ({ nickname, type }) => {
  const label = type === 'rebelote' ? `Rebelote ! (${nickname})` : `Belote ! (${nickname})`
  flashAnnouncement('belote-announcement', label, 2500)
})
socket.on('game:over', ({ scores, tricksWon, beloteBonus, bid }) => {
  const myTeam    = state.seats[0].team
  const otherTeam = myTeam === 'A' ? 'B' : 'A'

  const total = { A: scores.A + beloteBonus.A, B: scores.B + beloteBonus.B }
  const myTotal    = total[myTeam]
  const otherTotal = total[otherTeam]

  const { result: gameResult, fulfilled } = computeGameScore(scores, tricksWon, beloteBonus, bid)
  const winnerTeam  = fulfilled ? bid.team : (bid.team === 'A' ? 'B' : 'A')
  const winnerSeats = state.seats.filter(s => s.team === winnerTeam)
  const winnerColor = winnerTeam === myTeam ? '#6ab0ff' : '#ff7070'

  document.getElementById('game-over-scores').innerHTML = `
    <div class="go-score-block">
      <span class="go-score-label">Votre équipe</span>
      <span class="go-score-value" style="color:#6ab0ff">${myTotal}</span>
      <span class="go-score-pts">pts</span>
    </div>
    <div class="go-score-block">
      <span class="go-score-label">Adversaires</span>
      <span class="go-score-value" style="color:#ff7070">${otherTotal}</span>
      <span class="go-score-pts">pts</span>
    </div>
  `

  const n1 = `<span style="color:${winnerColor}">${winnerSeats[0]?.nickname ?? '?'}</span>`
  const n2 = `<span style="color:${winnerColor}">${winnerSeats[1]?.nickname ?? '?'}</span>`
  const prefix = fulfilled ? 'Contrat rempli' : 'Dedans !'
  document.getElementById('game-over-result').innerHTML =
    `${prefix},<br>${n1} &amp; ${n2} remportent la manche`

  const bar = document.getElementById('game-over-bar')
  bar.style.animation = 'none'
  bar.offsetWidth
  bar.style.animation = 'go-drain 8s linear forwards'

  document.getElementById('game-over-modal').classList.remove('hidden')

  gameScores.push({ my: gameResult[myTeam], opp: gameResult[otherTeam] })
  updateScoreUI()
})

// ── Score button / modal ──────────────────────────────────────────
const scoreModal = document.getElementById('score-modal')

document.getElementById('score-btn').addEventListener('click', () => {
  scoreModal.classList.remove('hidden')
})
document.getElementById('score-modal-ok').addEventListener('click', () => {
  scoreModal.classList.add('hidden')
})
scoreModal.addEventListener('click', e => {
  if (e.target === scoreModal) scoreModal.classList.add('hidden')
})
