import { io } from 'socket.io-client'
import { showScreen } from './router.js'
import { initGame, applyDealt, applyBidState, applyPlayStart,
         applyPlayState, applyYourTurn, applyTrickWon, setOnCardPlay, state } from './game.js'
import { toggleMute, startMusic, toggleMusicMute } from './soundManager.js'
import { escapeHtml, computeGameScore, resetScores, setTeamNames,
         recordGameResult, updateScoreUI } from './scoring.js'
import { initBidUI, hideBidOverlay, applyBidUIState } from './bid-ui.js'
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

initBidUI({
  onPass:       ()     => socket.emit('bid:pass'),
  onBid:        (v, s) => socket.emit('bid:place', { value: v, suit: s }),
  onContree:    ()     => socket.emit('bid:contree'),
  onSurcontree: ()     => socket.emit('bid:surcontree'),
})

// ── Session ───────────────────────────────────────────────────────
let myTeam = null

socket.on('connect', () => {
  socket.emit('session:restore', sessionStorage.getItem('sessionId') || null)
})

socket.on('session:ready', ({ sessionId, restored }) => {
  sessionStorage.setItem('sessionId', sessionId)
  if (!restored) return

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
        applyBidState(restored.bidState)
        applyBidUIState(restored.bidState, socket.id, myTeam)
      } else if (restored.playState) {
        applyPlayState(restored.playState)
      }
    })
  }
})

// ── Nickname ──────────────────────────────────────────────────────
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
document.getElementById('btn-create-room').addEventListener('click', () => socket.emit('room:create'))
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

socket.on('room:error', () => socket.emit('lobby:enter'))

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
        <span>${escapeHtml(p.nickname)}${isMe ? ' (vous)' : ''}</span>
        ${isCreator ? '<span class="slot-badge">créateur</span>' : ''}
      </div>`
    }).join('')

  const btnStart = document.getElementById('btn-start')
  btnStart.classList.toggle('hidden', !isCreator)
  btnStart.disabled = room.players.length < 4
}

socket.on('room:joined', ({ room, isCreator }) => {
  resetScores()
  document.getElementById('score-panel').classList.add('hidden')
  document.getElementById('score-btn').classList.add('hidden')
  renderWaiting(room, isCreator)
  showScreen('screen-waiting')
})

socket.on('room:updated', room => renderWaiting(room, room.creatorId === socket.id))

document.getElementById('btn-start').addEventListener('click', () => socket.emit('room:start'))
document.getElementById('btn-leave-room').addEventListener('click', () => socket.emit('room:leave'))

socket.on('room:left', () => {
  document.getElementById('score-panel').classList.add('hidden')
  document.getElementById('score-btn').classList.add('hidden')
  showScreen('screen-lobby')
})

// ── Game ──────────────────────────────────────────────────────────
socket.on('game:dealt', async data => {
  document.getElementById('game-over-modal').classList.add('hidden')
  myTeam = data.seats.find(s => s.socketId === socket.id)?.team ?? null
  setTeamNames(data.seats, myTeam)
  document.getElementById('score-panel').classList.remove('hidden')
  document.getElementById('score-btn').classList.remove('hidden')
  updateScoreUI()
  showScreen('game')
  await initGame(document.getElementById('game'), socket.id)
  applyDealt(data)
})

// ── Bidding ───────────────────────────────────────────────────────
socket.on('bid:state', data => {
  applyBidState(data)
  applyBidUIState(data, socket.id, myTeam)
})

socket.on('game:play-start', data => {
  hideBidOverlay()
  document.getElementById('surcontree-announcement').classList.add('hidden')
  document.getElementById('contree-announcement').classList.add('hidden')
  applyPlayStart(data)
})

socket.on('bid:contree-announced',   () => flashAnnouncement('contree-announcement', undefined, 2000))
socket.on('bid:surcontree-announced', () => {
  hideBidOverlay()
  const el = document.getElementById('surcontree-announcement')
  el.classList.remove('hidden')
  el.style.animation = 'none'
  el.offsetHeight
  el.style.animation = ''
})

// ── Trick play ────────────────────────────────────────────────────
socket.on('play:state',     data => applyPlayState(data))
socket.on('play:your-turn', data => applyYourTurn(data))
socket.on('trick:won',      data => applyTrickWon(data))
socket.on('play:belote', ({ nickname, type }) => {
  const label = type === 'rebelote' ? `Rebelote ! (${nickname})` : `Belote ! (${nickname})`
  flashAnnouncement('belote-announcement', label, 2500)
})

socket.on('game:over', ({ scores, tricksWon, beloteBonus, bid }) => {
  const otherTeam = myTeam === 'A' ? 'B' : 'A'

  const total      = { A: scores.A + beloteBonus.A, B: scores.B + beloteBonus.B }
  const myTotal    = total[myTeam]
  const otherTotal = total[otherTeam]

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

  const { result: gameResult, fulfilled } = computeGameScore(scores, tricksWon, beloteBonus, bid)
  const winnerTeam  = fulfilled ? bid.team : (bid.team === 'A' ? 'B' : 'A')
  const winnerSeats = state.seats.filter(s => s.team === winnerTeam)
  const winnerColor = winnerTeam === myTeam ? '#6ab0ff' : '#ff7070'

  const n1     = `<span style="color:${winnerColor}">${escapeHtml(winnerSeats[0]?.nickname ?? '?')}</span>`
  const n2     = `<span style="color:${winnerColor}">${escapeHtml(winnerSeats[1]?.nickname ?? '?')}</span>`
  const prefix = fulfilled ? 'Contrat rempli' : 'Dedans !'
  document.getElementById('game-over-result').innerHTML =
    `${prefix},<br>${n1} &amp; ${n2} remportent la manche`

  const bar = document.getElementById('game-over-bar')
  bar.style.animation = 'none'
  bar.offsetWidth
  bar.style.animation = 'go-drain 8s linear forwards'

  document.getElementById('game-over-modal').classList.remove('hidden')

  recordGameResult(gameResult, myTeam)
  updateScoreUI()
})

// ── Announcements ─────────────────────────────────────────────────
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

// ── Score modal ───────────────────────────────────────────────────
const scoreModal = document.getElementById('score-modal')

document.getElementById('score-btn').addEventListener('click', () => scoreModal.classList.remove('hidden'))
document.getElementById('score-modal-ok').addEventListener('click', () => scoreModal.classList.add('hidden'))
scoreModal.addEventListener('click', e => { if (e.target === scoreModal) scoreModal.classList.add('hidden') })
