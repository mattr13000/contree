import { byId } from '../dom.js'
import { showScreen } from '../router.js'
import { socket } from '../socket.js'

/** Lobby buttons (create / browse / back) + the room-list screen. */
export function initLobby(): void {
  byId('btn-create-room').addEventListener('click', () => socket.emit('room:create'))
  byId('btn-browse-rooms').addEventListener('click', () => {
    socket.emit('lobby:enter')
    showScreen('screen-room-list')
  })
  byId('btn-back-to-lobby').addEventListener('click', () => {
    socket.emit('lobby:leave')
    showScreen('screen-lobby')
  })

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
}
