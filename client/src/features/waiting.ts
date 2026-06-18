import { byId } from '../core/dom.js'
import { showScreen } from '../core/router.js'
import { socket } from '../core/socket.js'
import { escapeHtml, resetScores } from '../ui/scoring.js'
import type { RoomPayload } from '../../../shared/types.js'

/** Render the 4-slot waiting room. Exported because session restore reuses it. */
export function renderWaiting(room: RoomPayload, isCreator: boolean): void {
  byId('room-title').textContent = room.name

  byId('player-slots').innerHTML =
    Array.from({ length: 4 }, (_, i) => {
      const p = room.players[i]
      if (!p) return '<div class="slot">En attente d\'un joueur…</div>'
      const isMe          = p.id === socket.id
      const isRoomCreator = p.id === room.creatorId
      return `<div class="slot filled">
        <span>${escapeHtml(p.nickname)}${isMe ? ' (vous)' : ''}</span>
        ${isRoomCreator ? '<span class="slot-badge">créateur</span>' : ''}
      </div>`
    }).join('')

  const btnStart = byId<HTMLButtonElement>('btn-start')
  btnStart.classList.toggle('hidden', !isCreator)
  btnStart.disabled = room.players.length < 4
}

/** Waiting-room lifecycle: join/update/leave + start/leave buttons. */
export function initWaiting(): void {
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
}
