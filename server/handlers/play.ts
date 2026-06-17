import { players, games } from '../state.js'
import { emitPlayState, resolveTrick } from '../game.js'
import { getValidCards } from '../rules.js'
import type { AppServer, AppSocket } from '../io-types.js'

/** play:card — validate, apply, advance the trick. */
export function registerPlayHandlers(io: AppServer, socket: AppSocket): void {
  socket.on('play:card', ({ rank, suit }) => {
    const player = players.get(socket.id)
    if (!player?.roomId) return
    const game = games.get(player.roomId)
    if (!game || game.phase !== 'playing' || !game.trickState || !game.trump) return
    const { trickState, seats, hands, trump } = game
    if (seats[trickState.currentPlayerIdx].socketId !== socket.id) return

    const hand    = hands[socket.id]
    const cardIdx = hand.findIndex(c => c.rank === rank && c.suit === suit)
    if (cardIdx === -1) return

    const valid = getValidCards(hand, trickState.trick, trump, socket.id, seats)
    if (!valid.some(c => c.rank === rank && c.suit === suit)) return

    const bh = trickState.beloteHolder
    let beloteAnnounce: 'belote' | 'rebelote' | null = null
    if (bh?.socketId === socket.id && suit === trump && (rank === 'K' || rank === 'Q')) {
      beloteAnnounce = (bh.played.K || bh.played.Q) ? 'rebelote' : 'belote'
      bh.played[rank] = true
    }

    hand.splice(cardIdx, 1)
    trickState.trick.push({ socketId: socket.id, rank, suit })

    if (beloteAnnounce) {
      const mySeat = seats.find(s => s.socketId === socket.id)
      io.to(player.roomId).emit('play:belote', { nickname: mySeat?.nickname, type: beloteAnnounce })
    }

    if (trickState.trick.length < 4) {
      trickState.currentPlayerIdx = (trickState.currentPlayerIdx + 1) % 4
      emitPlayState(player.roomId)
    } else {
      resolveTrick(player.roomId)
    }
  })
}
