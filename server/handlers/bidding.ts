import { players } from '../state.js'
import { applyBid, applyPass, applyContree, applySurcontree } from '../game.js'
import type { AppServer, AppSocket } from '../io-types.js'

/** bid:place / bid:pass / bid:contree / bid:surcontree — thin wrappers over game.ts actions. */
export function registerBiddingHandlers(_io: AppServer, socket: AppSocket): void {
  socket.on('bid:place', p => {
    const roomId = players.get(socket.id)?.roomId
    if (roomId) applyBid(roomId, socket.id, p)
  })

  socket.on('bid:pass', () => {
    const roomId = players.get(socket.id)?.roomId
    if (roomId) applyPass(roomId, socket.id)
  })

  socket.on('bid:contree', () => {
    const roomId = players.get(socket.id)?.roomId
    if (roomId) applyContree(roomId, socket.id)
  })

  socket.on('bid:surcontree', () => {
    const roomId = players.get(socket.id)?.roomId
    if (roomId) applySurcontree(roomId, socket.id)
  })
}
