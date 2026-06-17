import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import { players, rooms, games, sessions,
         generateId, migrateSocketId, getRoomList, roomPayload } from './state.js'
import { init as initGame, GAME_SUITS, BID_VALUES, bidNumeric, getValidCards,
         pushRoomList, leaveRoom, deal, emitBidState, bidWon, emitPlayState,
         resolveTrick } from './game.js'
import type { ClientToServerEvents, ServerToClientEvents, Restored, Room } from '../shared/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app        = express()
const httpServer = createServer(app)
const isDev      = process.env.NODE_ENV !== 'production'

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, isDev ? { cors: { origin: '*' } } : {})
initGame(io)

if (!isDev) {
  app.use(express.static(join(__dirname, '../dist')))
  app.get('*', (_req, res) => res.sendFile(join(__dirname, '../dist/index.html')))
}

let roomCounter = 0

// ── Socket handlers ───────────────────────────────────────────────
io.on('connection', socket => {
  console.log('+ connected   :', socket.id)
  players.set(socket.id, { id: socket.id, nickname: null, roomId: null, sessionId: null })

  // ── session:restore ───────────────────────────────────────────
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

  // ── nickname:set ──────────────────────────────────────────────
  socket.on('nickname:set', raw => {
    const nickname = String(raw).trim().slice(0, 20)
    if (!nickname) return
    players.get(socket.id)!.nickname = nickname
    socket.emit('nickname:ok', nickname)
  })

  // ── lobby:enter / lobby:leave ─────────────────────────────────
  socket.on('lobby:enter', () => {
    socket.join('lobby')
    socket.emit('rooms:list', getRoomList())
  })

  socket.on('lobby:leave', () => socket.leave('lobby'))

  // ── room:create ───────────────────────────────────────────────
  socket.on('room:create', () => {
    const player = players.get(socket.id)
    if (!player?.nickname || player.roomId) return

    roomCounter++
    const room: Room = {
      id:        generateId(),
      name:      `Salle #${roomCounter}`,
      players:   [socket.id],
      creatorId: socket.id,
    }
    rooms.set(room.id, room)
    player.roomId = room.id
    socket.leave('lobby')
    socket.join(room.id)

    socket.emit('room:joined', { room: roomPayload(room), isCreator: true })
    pushRoomList()
  })

  // ── room:join ─────────────────────────────────────────────────
  socket.on('room:join', roomId => {
    const player = players.get(socket.id)
    if (!player?.nickname || player.roomId) return

    const room = rooms.get(roomId)
    if (!room || room.players.length >= 4) {
      socket.emit('room:error', 'Cette salle est pleine ou introuvable')
      return
    }

    room.players.push(socket.id)
    player.roomId = room.id
    socket.leave('lobby')
    socket.join(room.id)

    socket.emit('room:joined', { room: roomPayload(room), isCreator: false })
    io.to(room.id).emit('room:updated', roomPayload(room))
    pushRoomList()
  })

  // ── room:leave ────────────────────────────────────────────────
  socket.on('room:leave', () => {
    const roomId = players.get(socket.id)?.roomId
    leaveRoom(socket.id)
    if (roomId) socket.leave(roomId)
    socket.emit('room:left')
  })

  // ── room:start ────────────────────────────────────────────────
  socket.on('room:start', () => {
    const player = players.get(socket.id)
    if (!player?.roomId) return
    const room = rooms.get(player.roomId)
    if (!room || room.creatorId !== socket.id || room.players.length !== 4) return
    if (games.get(player.roomId)) return
    deal(room)
  })

  // ── bid:place ─────────────────────────────────────────────────
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

  // ── bid:pass ──────────────────────────────────────────────────
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

  // ── bid:contree ───────────────────────────────────────────────
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

  // ── bid:surcontree ────────────────────────────────────────────
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
    setTimeout(() => bidWon(roomId), 1500)
  })

  // ── play:card ─────────────────────────────────────────────────
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

  // ── disconnect ────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log('- disconnected:', socket.id)
    const sessionId = players.get(socket.id)?.sessionId

    if (sessionId && sessions.has(sessionId)) {
      sessions.get(sessionId)!.timer = setTimeout(() => {
        console.log('session expired:', sessionId)
        leaveRoom(socket.id)
        players.delete(socket.id)
        sessions.delete(sessionId)
      }, 20_000)
    } else {
      leaveRoom(socket.id)
      players.delete(socket.id)
    }
  })
})

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => console.log(`server on :${PORT}`))
