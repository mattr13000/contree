import { io, type Socket } from 'socket.io-client'
import { byId } from './dom.js'
import { showScreen } from './router.js'
import { initGame, applyDealt, applyBidState, applyPlayStart,
         applyPlayState, applyYourTurn, applyTrickWon, setOnCardPlay, state } from './game.js'
import { toggleMute, startMusic, toggleMusicMute } from './soundManager.js'
import { escapeHtml, computeGameScore, resetScores, setTeamNames,
         recordGameResult, updateScoreUI } from './scoring.js'
import { initBidUI, hideBidOverlay, applyBidUIState } from './bid-ui.js'
import { SUIT_SYMBOLS } from '../../shared/constants.js'
import './style.css'
import type {
  ServerToClientEvents, ClientToServerEvents, Suit, Team, Rank,
  LastAction, RoomPayload,
} from '../../shared/types.js'

const muteBtn  = byId<HTMLButtonElement>('mute-btn')
const musicBtn = byId<HTMLButtonElement>('music-btn')

muteBtn.addEventListener('click', () => {
  const muted = toggleMute()
  muteBtn.textContent = muted ? '🔇' : '🔊'
})
musicBtn.addEventListener('click', () => {
  const muted = toggleMusicMute()
  musicBtn.classList.toggle('muted', muted)
})

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io()
setOnCardPlay((card: { rank: Rank; suit: Suit }) => socket.emit('play:card', card))

// Autoplay is blocked until a user gesture; retry music on the first interaction
document.addEventListener('click',      () => startMusic(), { once: true })
document.addEventListener('touchstart', () => startMusic(), { once: true, passive: true })

initBidUI({
  onPass:       ()     => socket.emit('bid:pass'),
  onBid:        (v, s) => socket.emit('bid:place', { value: v, suit: s }),
  onContree:    ()     => socket.emit('bid:contree'),
  onSurcontree: ()     => socket.emit('bid:surcontree'),
})

// ── Session ───────────────────────────────────────────────────────
let myTeam: Team | null = null

socket.on('connect', () => {
  socket.emit('session:restore', sessionStorage.getItem('sessionId') || null)
})

socket.on('session:ready', ({ sessionId, restored }) => {
  sessionStorage.setItem('sessionId', sessionId)
  if (!restored) return

  startMusic()

  if (restored.state === 'lobby') {
    byId('lobby-greeting').textContent = `Bonjour, ${restored.nickname} !`
    showScreen('screen-lobby')
  } else if (restored.state === 'waiting') {
    renderWaiting(restored.room, restored.isCreator)
    showScreen('screen-waiting')
  } else if (restored.state === 'game') {
    myTeam = restored.dealt.seats.find(s => s.socketId === socket.id)?.team ?? null
    showScreen('game')
    initGame(byId<HTMLCanvasElement>('game'), socket.id).then(() => {
      applyDealt(restored.dealt)
      if (restored.bidState) {
        applyBidState(restored.bidState)
        applyBidUIState(restored.bidState, socket.id!, myTeam)
      } else if (restored.playState) {
        applyPlayState(restored.playState)
      }
    })
  }
})

// ── Nickname ──────────────────────────────────────────────────────
const inputNickname = byId<HTMLInputElement>('input-nickname')
const btnEnter      = byId<HTMLButtonElement>('btn-enter')

function submitNickname(): void {
  const nick = inputNickname.value.trim()
  if (nick) { startMusic(); socket.emit('nickname:set', nick) }
}

btnEnter.addEventListener('click', submitNickname)
inputNickname.addEventListener('keydown', e => { if (e.key === 'Enter') submitNickname() })

socket.on('nickname:ok', nick => {
  byId('lobby-greeting').textContent = `Bonjour, ${nick} !`
  showScreen('screen-lobby')
})

// ── Lobby ─────────────────────────────────────────────────────────
byId('btn-create-room').addEventListener('click', () => socket.emit('room:create'))
byId('btn-browse-rooms').addEventListener('click', () => {
  socket.emit('lobby:enter')
  showScreen('screen-room-list')
})

// ── Room list ─────────────────────────────────────────────────────
socket.on('rooms:list', rooms => {
  const container = byId('rooms-container')
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
  container.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      if (id) socket.emit('room:join', id)
    })
  })
})

socket.on('room:error', () => socket.emit('lobby:enter'))

byId('btn-back-to-lobby').addEventListener('click', () => {
  socket.emit('lobby:leave')
  showScreen('screen-lobby')
})

// ── Waiting room ──────────────────────────────────────────────────
function renderWaiting(room: RoomPayload, isCreator: boolean): void {
  byId('room-title').textContent = room.name

  byId('player-slots').innerHTML =
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

  const btnStart = byId<HTMLButtonElement>('btn-start')
  btnStart.classList.toggle('hidden', !isCreator)
  btnStart.disabled = room.players.length < 4
}

socket.on('room:joined', ({ room, isCreator }) => {
  resetScores()
  byId('score-panel').classList.add('hidden')
  byId('score-btn').classList.add('hidden')
  renderWaiting(room, isCreator)
  showScreen('screen-waiting')
})

socket.on('room:updated', room => renderWaiting(room, room.creatorId === socket.id))

byId('btn-start').addEventListener('click', () => socket.emit('room:start'))
byId('btn-leave-room').addEventListener('click', () => socket.emit('room:leave'))

socket.on('room:left', () => {
  byId('score-panel').classList.add('hidden')
  byId('score-btn').classList.add('hidden')
  showScreen('screen-lobby')
})

// ── Game ──────────────────────────────────────────────────────────
socket.on('game:dealt', async data => {
  byId('game-over-modal').classList.add('hidden')
  myTeam = data.seats.find(s => s.socketId === socket.id)?.team ?? null
  setTeamNames(data.seats, myTeam)
  byId('score-panel').classList.remove('hidden')
  byId('score-btn').classList.remove('hidden')
  updateScoreUI()
  showScreen('game')
  await initGame(byId<HTMLCanvasElement>('game'), socket.id)
  applyDealt(data)
})

// ── Bidding ───────────────────────────────────────────────────────
let bidActionTimer: ReturnType<typeof setTimeout> | null = null

// Per-element auto-hide timers (replaces the old el._hideTimer custom property)
const hideTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

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
  el.classList.remove('hidden')
  el.style.animation = 'none'
  void el.offsetHeight  // force reflow to restart animation
  el.style.animation = ''
  const prev = hideTimers.get(el)
  if (prev) clearTimeout(prev)
  hideTimers.set(el, setTimeout(() => el.classList.add('hidden'), 1500))
}

socket.on('bid:state', data => {
  applyBidState(data)
  if (data.lastAction) {
    if (bidActionTimer) clearTimeout(bidActionTimer)
    showBidAction(data.lastAction)
    bidActionTimer = setTimeout(() => applyBidUIState(data, socket.id!, myTeam), 1500)
  } else {
    applyBidUIState(data, socket.id!, myTeam)
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

socket.on('bid:contree-announced',   () => flashAnnouncement('contree-announcement', undefined, 2000))
socket.on('bid:surcontree-announced', () => {
  hideBidOverlay()
  const el = byId('surcontree-announcement')
  el.classList.remove('hidden')
  el.style.animation = 'none'
  void el.offsetHeight
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
  const team      = myTeam ?? 'A'
  const otherTeam: Team = team === 'A' ? 'B' : 'A'

  const total      = { A: scores.A + beloteBonus.A, B: scores.B + beloteBonus.B }
  const myTotal    = total[team]
  const otherTotal = total[otherTeam]

  byId('game-over-scores').innerHTML = `
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
  const winnerSeats = (state.seats as unknown as Array<{ team: Team; nickname: string }>)
    .filter(s => s.team === winnerTeam)
  const winnerColor = winnerTeam === team ? '#6ab0ff' : '#ff7070'

  const n1     = `<span style="color:${winnerColor}">${escapeHtml(winnerSeats[0]?.nickname ?? '?')}</span>`
  const n2     = `<span style="color:${winnerColor}">${escapeHtml(winnerSeats[1]?.nickname ?? '?')}</span>`
  const prefix = fulfilled ? 'Contrat rempli' : 'Dedans !'
  byId('game-over-result').innerHTML =
    `${prefix},<br>${n1} &amp; ${n2} remportent la manche`

  const bar = byId('game-over-bar')
  bar.style.animation = 'none'
  void bar.offsetWidth
  bar.style.animation = 'go-drain 8s linear forwards'

  byId('game-over-modal').classList.remove('hidden')

  recordGameResult(gameResult, team)
  updateScoreUI()
})

socket.on('game:victory', ({ winnerTeam, winnerNicknames }) => {
  byId('game-over-modal').classList.add('hidden')
  const isMyTeamWinner = winnerTeam === myTeam
  const color = isMyTeamWinner ? '#6ab0ff' : '#ff7070'
  const n1 = `<span style="color:${color}">${escapeHtml(winnerNicknames[0])}</span>`
  const n2 = `<span style="color:${color}">${escapeHtml(winnerNicknames[1])}</span>`
  byId('victory-names').innerHTML = `${n1} &amp; ${n2} gagne !`
  byId('victory-modal').classList.remove('hidden')
})

byId('btn-victory-lobby').addEventListener('click', () => {
  byId('victory-modal').classList.add('hidden')
  socket.emit('room:leave')
})

// ── Announcements ─────────────────────────────────────────────────
function flashAnnouncement(id: string, text: string | undefined, duration = 2000): void {
  const el = byId(id)
  if (text !== undefined) el.textContent = text
  el.classList.remove('hidden')
  el.style.animation = 'none'
  void el.offsetHeight
  el.style.animation = ''
  const prev = hideTimers.get(el)
  if (prev) clearTimeout(prev)
  hideTimers.set(el, setTimeout(() => el.classList.add('hidden'), duration))
}

// ── Score modal ───────────────────────────────────────────────────
const scoreModal = byId('score-modal')

byId('score-btn').addEventListener('click', () => scoreModal.classList.remove('hidden'))
byId('score-modal-ok').addEventListener('click', () => scoreModal.classList.add('hidden'))
scoreModal.addEventListener('click', e => { if (e.target === scoreModal) scoreModal.classList.add('hidden') })
