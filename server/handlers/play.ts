import { players } from '../state.js'
import { applyPlay } from '../game.js'
import type { AppServer, AppSocket } from '../io-types.js'

/** play:card — thin wrapper over the game.ts action (all validation lives there). */
export function registerPlayHandlers(_io: AppServer, socket: AppSocket): void {
  socket.on('play:card', p => {
    if (!p || typeof p !== 'object') return
    const roomId = players.get(socket.id)?.roomId
    if (roomId) applyPlay(roomId, socket.id, p)
  })
}
