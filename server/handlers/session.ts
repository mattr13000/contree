import { players, rooms, games, sessions,
         generateId, migrateSocketId, roomPayload } from '../state.js'
import { leaveRoom, emitPlayState } from '../game.js'
import type { Restored } from '../../shared/types.js'
import type { AppServer, AppSocket } from '../io-types.js'

const SESSION_GRACE_MS = 20_000

/** session:restore + disconnect — the session lifecycle. */
export function registerSessionHandlers(_io: AppServer, socket: AppSocket): void {
  socket.on('session:restore', incomingId => {
    const existing = incomingId ? sessions.get(incomingId) : null

    if (!existing) {
      const sessionId = generateId()
      sessions.set(sessionId, { socketId: socket.id, timer: null })
      players.get(socket.id)!.sessionId = sessionId
      socket.emit('session:ready', { sessionId, restored: null })
      return
    }

    clearTimeout(existing.timer ?? undefined)
    existing.timer    = null
    const oldId       = existing.socketId
    existing.socketId = socket.id

    migrateSocketId(oldId, socket.id)
    const player = players.get(socket.id)!
    player.sessionId = incomingId

    if (player.roomId) socket.join(player.roomId)

    const room = player.roomId ? rooms.get(player.roomId) : null
    const game = player.roomId ? games.get(player.roomId) : null
    let restored: Restored | null = null

    if (game) {
      restored = {
        state:    'game',
        nickname: player.nickname,
        dealt: {
          seats:               game.seats.map(({ socketId, nickname, position, team }) =>
                                 ({ socketId, nickname, position, team })),
          myHand:              game.hands[socket.id],
          dealerPosition:      game.seats[game.dealerIdx].position,
          firstBidderPosition: game.seats[game.bidderIdx].position,
        },
        bidState: game.phase === 'bidding' ? {
          currentBidderSocketId: game.seats[game.bidding.currentBidderIdx].socketId,
          highBid:               game.bidding.highBid,
          contree:               game.bidding.contree,
        } : null,
        playState: game.phase === 'playing' ? {
          currentPlayerSocketId: game.seats[game.trickState!.currentPlayerIdx].socketId,
          trick:        game.trickState!.trick,
          tricksPlayed: game.trickState!.tricksPlayed,
          scores:       game.trickState!.scores,
          trump:        game.trump!,
          bid:          { ...game.bidding.highBid!, contree: game.bidding.contree },
        } : null,
      }
    } else if (room) {
      restored = {
        state:     'waiting',
        nickname:  player.nickname,
        room:      roomPayload(room),
        isCreator: room.creatorId === socket.id,
      }
    } else if (player.nickname) {
      restored = { state: 'lobby', nickname: player.nickname }
    }

    socket.emit('session:ready', { sessionId: incomingId!, restored })
    if (game?.phase === 'playing' && player.roomId) emitPlayState(player.roomId)
  })

  socket.on('disconnect', () => {
    console.log('- disconnected:', socket.id)
    const sessionId = players.get(socket.id)?.sessionId

    if (sessionId && sessions.has(sessionId)) {
      sessions.get(sessionId)!.timer = setTimeout(() => {
        console.log('session expired:', sessionId)
        leaveRoom(socket.id)
        players.delete(socket.id)
        sessions.delete(sessionId)
      }, SESSION_GRACE_MS)
    } else {
      leaveRoom(socket.id)
      players.delete(socket.id)
    }
  })
}
