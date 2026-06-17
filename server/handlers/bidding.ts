import { players, rooms, games } from '../state.js'
import { deal, emitBidState, bidWon } from '../game.js'
import { GAME_SUITS, BID_VALUES, bidNumeric } from '../../shared/constants.js'
import type { AppServer, AppSocket } from '../io-types.js'

const SURCONTREE_DELAY_MS = 1500

/** bid:place / bid:pass / bid:contree / bid:surcontree. */
export function registerBiddingHandlers(io: AppServer, socket: AppSocket): void {
  socket.on('bid:place', ({ value, suit }) => {
    const player = players.get(socket.id)
    if (!player?.roomId) return
    const game = games.get(player.roomId)
    if (!game || game.phase !== 'bidding') return
    const { bidding, seats } = game
    if (seats[bidding.currentBidderIdx].socketId !== socket.id) return
    if (!BID_VALUES.includes(value)) return
    if (!GAME_SUITS.includes(suit)) return
    if (bidding.highBid && bidNumeric(value) <= bidNumeric(bidding.highBid.value)) return

    bidding.highBid  = { value, suit, team: seats[bidding.currentBidderIdx].team, bidderNickname: seats[bidding.currentBidderIdx].nickname }
    bidding.passCount = 0
    bidding.contree   = false
    bidding.currentBidderIdx = (bidding.currentBidderIdx + 1) % 4
    emitBidState(player.roomId, { type: 'bid', socketId: socket.id, nickname: bidding.highBid.bidderNickname, value, suit })
  })

  socket.on('bid:pass', () => {
    const player = players.get(socket.id)
    if (!player?.roomId) return
    const game = games.get(player.roomId)
    if (!game || game.phase !== 'bidding') return
    const { bidding, seats } = game
    if (seats[bidding.currentBidderIdx].socketId !== socket.id) return
    if (bidding.contree === 'surcontree') return

    const passerNickname = seats[bidding.currentBidderIdx].nickname
    bidding.passCount++
    bidding.currentBidderIdx = (bidding.currentBidderIdx + 1) % 4

    if (!bidding.highBid && bidding.passCount >= 4) { deal(rooms.get(player.roomId)!); return }
    if (bidding.highBid  && bidding.passCount >= 3) { bidWon(player.roomId); return }
    emitBidState(player.roomId, { type: 'pass', socketId: socket.id, nickname: passerNickname })
  })

  socket.on('bid:contree', () => {
    const player = players.get(socket.id)
    if (!player?.roomId) return
    const game = games.get(player.roomId)
    if (!game || game.phase !== 'bidding') return
    const { bidding, seats } = game
    if (seats[bidding.currentBidderIdx].socketId !== socket.id) return
    if (!bidding.highBid || bidding.contree !== false) return
    const myTeam = seats.find(s => s.socketId === socket.id)?.team
    if (bidding.highBid.team === myTeam) return

    const contreeurNickname = seats.find(s => s.socketId === socket.id)?.nickname ?? '?'
    bidding.contree   = 'contree'
    bidding.passCount = 0  // counts as a bid: need a full 3-pass round after contrée
    bidding.currentBidderIdx = (bidding.currentBidderIdx + 1) % 4

    io.to(player.roomId).emit('bid:contree-announced')
    emitBidState(player.roomId, { type: 'contree', socketId: socket.id, nickname: contreeurNickname })
  })

  socket.on('bid:surcontree', () => {
    const player = players.get(socket.id)
    if (!player?.roomId) return
    const game = games.get(player.roomId)
    if (!game || game.phase !== 'bidding') return
    const { bidding, seats } = game
    if (seats[bidding.currentBidderIdx].socketId !== socket.id) return
    if (!bidding.highBid || bidding.contree !== 'contree') return
    const myTeam = seats.find(s => s.socketId === socket.id)?.team
    if (bidding.highBid.team !== myTeam) return

    const roomId = player.roomId
    bidding.contree = 'surcontree'
    io.to(roomId).emit('bid:surcontree-announced')
    setTimeout(() => bidWon(roomId), SURCONTREE_DELAY_MS)
  })
}
