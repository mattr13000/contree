import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app        = express()
const httpServer = createServer(app)
const isDev      = process.env.NODE_ENV !== 'production'

const io = new Server(httpServer, isDev ? { cors: { origin: '*' } } : {})

app.use('/Cards', express.static(join(__dirname, '../Cards')))
if (!isDev) {
  app.use(express.static(join(__dirname, '../dist')))
  app.get('*', (req, res) => res.sendFile(join(__dirname, '../dist/index.html')))
}

// ── State ─────────────────────────────────────────────────────────
// players  : Map<socketId, { id, nickname, roomId, sessionId }>
// rooms    : Map<roomId,   { id, name, players: socketId[], creatorId }>
// games    : Map<roomId,   gameState>
// sessions : Map<sessionId, { socketId, timer }>
const players  = new Map()
const rooms    = new Map()
const games    = new Map()
const sessions = new Map()
let roomCounter = 0  // used only for display name

function generateId() { return randomUUID() }

// Update every reference to oldId across players/rooms/games when a socket reconnects
function migrateSocketId(oldId, newId) {
  const player = players.get(oldId)
  if (!player) return
  player.id = newId
  players.delete(oldId)
  players.set(newId, player)

  if (!player.roomId) return
  const room = rooms.get(player.roomId)
  if (room) {
    room.players = room.players.map(id => id === oldId ? newId : id)
    if (room.creatorId === oldId) room.creatorId = newId
  }
  const game = games.get(player.roomId)
  if (game) {
    game.seats = game.seats.map(s => s.socketId === oldId ? { ...s, socketId: newId } : s)
    if (game.hands[oldId]) {
      game.hands[newId] = game.hands[oldId]
      delete game.hands[oldId]
    }
  }
}

// ── Game constants ────────────────────────────────────────────────
const RANKS      = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const GAME_SUITS = ['Hearts', 'Diamonds', 'Clubs', 'Spades']
const BID_VALUES = [80, 90, 100, 110, 120, 130, 140, 150, 160, 'Capot']
function bidNumeric(v) { return v === 'Capot' ? 250 : v }

// Trump ranking low→high: 7 8 Q K 10 A 9 J
const TRUMP_RANK_ORDER   = ['7','8','Q','K','10','A','9','J']
// Non-trump ranking low→high: 7 8 9 J Q K 10 A
const REGULAR_RANK_ORDER = ['7','8','9','J','Q','K','10','A']
const TRUMP_POINTS   = { 'J':20,'9':14,'A':11,'10':10,'K':4,'Q':3,'8':0,'7':0 }
const REGULAR_POINTS = { 'A':11,'10':10,'K':4,'Q':3,'J':2,'9':0,'8':0,'7':0 }

function trumpStrength(r)   { return TRUMP_RANK_ORDER.indexOf(r) }
function regularStrength(r) { return REGULAR_RANK_ORDER.indexOf(r) }
function cardPoints(rank, suit, trump) {
  return ((suit === trump) ? TRUMP_POINTS : REGULAR_POINTS)[rank] ?? 0
}
function trickWinnerCard(trick, trump) {
  return trick.reduce((best, c) => {
    if (c.suit === trump && (best.suit !== trump || trumpStrength(c.rank) > trumpStrength(best.rank))) return c
    if (c.suit !== trump && c.suit === best.suit && best.suit !== trump && regularStrength(c.rank) > regularStrength(best.rank)) return c
    return best
  })
}
function getValidCards(hand, trick, trump, mySocketId, seats) {
  if (!trick.length) return hand
  const leadSuit    = trick[0].suit
  const leadIsTrump = leadSuit === trump
  const suitCards   = hand.filter(c => c.suit === leadSuit)
  const trumpCards  = hand.filter(c => c.suit === trump)
  const winner      = trickWinnerCard(trick, trump)
  const mySeat      = seats.find(s => s.socketId === mySocketId)
  const winnerSeat  = seats.find(s => s.socketId === winner.socketId)
  const partnerWins = mySeat && winnerSeat && mySeat.team === winnerSeat.team
  const highTrump   = trick.filter(c => c.suit === trump)
    .reduce((b, c) => (!b || trumpStrength(c.rank) > trumpStrength(b.rank)) ? c : b, null)
  const overtrumps  = highTrump
    ? trumpCards.filter(c => trumpStrength(c.rank) > trumpStrength(highTrump.rank))
    : trumpCards

  if (leadIsTrump) {
    if (!trumpCards.length) return hand
    return overtrumps.length ? overtrumps : trumpCards
  }
  if (suitCards.length) return suitCards
  if (partnerWins)      return hand
  if (trumpCards.length) return overtrumps.length ? overtrumps : trumpCards
  return hand
}

// Clockwise seat order: South → West → North → East
// Teams: seats 0&2 (South+North) = A, seats 1&3 (West+East) = B
const POSITIONS = ['south', 'west', 'north', 'east']
const TEAMS     = ['A',     'B',    'A',     'B'   ]

// ── Game helpers ──────────────────────────────────────────────────
function buildDeck() {
  const deck = []
  for (const suit of GAME_SUITS) for (const rank of RANKS) deck.push({ rank, suit })
  return deck
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function deal(room) {
  const deck       = shuffle(buildDeck())
  const prevGame   = games.get(room.id)
  const dealerIdx  = prevGame ? (prevGame.dealerIdx + 1) % 4 : 0
  const bidderIdx  = (dealerIdx + 1) % 4

  // Seat order is shuffled once at session start, then fixed for the whole session
  const playerOrder = prevGame
    ? prevGame.seats.map(s => s.socketId)
    : shuffle([...room.players])
  const seats = playerOrder.map((socketId, i) => ({
    socketId,
    nickname: players.get(socketId)?.nickname ?? '?',
    position: POSITIONS[i],
    team:     TEAMS[i],
  }))

  const hands = {}
  seats.forEach((seat, i) => { hands[seat.socketId] = deck.slice(i * 8, (i + 1) * 8) })

  const bidding = {
    currentBidderIdx: bidderIdx,
    passCount:        0,
    highBid:          null,   // { value, suit, team }
    contree:          false,  // false | 'contree' | 'surcontree'
  }

  games.set(room.id, { roomId: room.id, seats, hands, dealerIdx, bidderIdx, phase: 'bidding', bidding })

  // Each player gets only their own hand; seat info is shared (no cards)
  seats.forEach(seat => {
    io.to(seat.socketId).emit('game:dealt', {
      seats:               seats.map(({ socketId, nickname, position, team }) =>
                             ({ socketId, nickname, position, team })),
      myHand:              hands[seat.socketId],
      dealerPosition:      seats[dealerIdx].position,
      firstBidderPosition: seats[bidderIdx].position,
    })
  })

  emitBidState(room.id)
}

function emitBidState(roomId) {
  const game = games.get(roomId)
  if (!game) return
  const { bidding, seats } = game
  io.to(roomId).emit('bid:state', {
    currentBidderSocketId: seats[bidding.currentBidderIdx].socketId,
    highBid:               bidding.highBid,
    contree:               bidding.contree,
  })
}

function bidWon(roomId) {
  const game = games.get(roomId)
  game.phase = 'playing'
  const trump          = game.bidding.highBid.suit
  game.trump           = trump
  const firstPlayerIdx = (game.dealerIdx + 1) % 4

  // Detect belote: one player holds both K and Q of trump
  const beloteEntry = Object.entries(game.hands).find(([, hand]) =>
    hand.some(c => c.suit === trump && c.rank === 'K') &&
    hand.some(c => c.suit === trump && c.rank === 'Q')
  )
  game.trickState = {
    currentPlayerIdx: firstPlayerIdx,
    trickLeaderIdx:   firstPlayerIdx,
    trick:            [],
    tricksPlayed:     0,
    scores:           { A: 0, B: 0 },
    beloteHolder: beloteEntry ? {
      socketId: beloteEntry[0],
      team:     game.seats.find(s => s.socketId === beloteEntry[0])?.team,
      played:   { K: false, Q: false },
    } : null,
  }

  io.to(roomId).emit('game:play-start', {
    bid: {
      value:   game.bidding.highBid.value,
      suit:    trump,
      team:    game.bidding.highBid.team,
      contree: game.bidding.contree,
    },
    firstPlayerSocketId: game.seats[firstPlayerIdx].socketId,
    trump,
  })

  emitPlayState(roomId)
}

function emitPlayState(roomId) {
  const game = games.get(roomId)
  if (!game?.trickState) return
  const { trickState, seats, hands, trump } = game
  const current = seats[trickState.currentPlayerIdx]

  io.to(roomId).emit('play:state', {
    currentPlayerSocketId: current.socketId,
    trick:        trickState.trick,
    tricksPlayed: trickState.tricksPlayed,
    scores:       trickState.scores,
    trump,
  })

  const currentHand = hands[current.socketId]
  if (!currentHand) {
    console.error('[emitPlayState] no hand for', current.socketId, { handKeys: Object.keys(hands) })
    return
  }
  const validCards = getValidCards(currentHand, trickState.trick, trump, current.socketId, seats)
  io.to(current.socketId).emit('play:your-turn', { validCards })
}

function resolveTrick(roomId) {
  const game = games.get(roomId)
  const { trickState, seats, trump } = game

  const winner     = trickWinnerCard(trickState.trick, trump)
  const winnerSeat = seats.find(s => s.socketId === winner.socketId)
  if (!winnerSeat) {
    console.error('[resolveTrick] winnerSeat not found', { winnerId: winner.socketId, seatIds: seats.map(s => s.socketId) })
    return
  }

  let pts = trickState.trick.reduce((sum, c) => sum + cardPoints(c.rank, c.suit, trump), 0)
  trickState.tricksPlayed++
  const isLast = trickState.tricksPlayed === 8
  if (isLast) pts += 10  // dix de der

  trickState.scores[winnerSeat.team] += pts

  io.to(roomId).emit('trick:won', {
    winnerSocketId: winner.socketId,
    winnerNickname: winnerSeat?.nickname,
    trick:          [...trickState.trick],
    scores:         trickState.scores,
    tricksPlayed:   trickState.tricksPlayed,
  })

  if (isLast) {
    const beloteBonus = { A: 0, B: 0 }
    const bh = trickState.beloteHolder
    if (bh?.played.K && bh?.played.Q) beloteBonus[bh.team] += 20

    setTimeout(() => {
      io.to(roomId).emit('game:over', {
        scores:      trickState.scores,
        beloteBonus,
        bid:         { ...game.bidding.highBid, contree: game.bidding.contree },
      })
      game.phase = 'ended'
    }, 2000)
    return
  }

  const winnerIdx = seats.findIndex(s => s.socketId === winner.socketId)
  trickState.trick            = []
  trickState.currentPlayerIdx = winnerIdx
  trickState.trickLeaderIdx   = winnerIdx

  setTimeout(() => emitPlayState(roomId), 2000)
}

function getRoomList() {
  return [...rooms.values()]
    .filter(r => r.players.length < 4)
    .map(r => ({ id: r.id, name: r.name, playerCount: r.players.length }))
}

function roomPayload(room) {
  return {
    id:        room.id,
    name:      room.name,
    creatorId: room.creatorId,
    players:   room.players.map(id => ({
      id,
      nickname: players.get(id)?.nickname ?? '?'
    }))
  }
}

// Push updated room list to everyone currently browsing the lobby
function pushRoomList() {
  io.to('lobby').emit('rooms:list', getRoomList())
}

// Remove a player from their current room; handle creator transfer + empty room
function leaveRoom(socketId) {
  const player = players.get(socketId)
  if (!player?.roomId) return

  const room = rooms.get(player.roomId)
  if (!room) { player.roomId = null; return }

  const roomId = room.id
  room.players = room.players.filter(id => id !== socketId)
  player.roomId = null

  if (room.players.length === 0) {
    rooms.delete(roomId)
    games.delete(roomId)
    pushRoomList()
    return
  }

  if (room.creatorId === socketId) {
    room.creatorId = room.players[0]
  }

  io.to(roomId).emit('room:updated', roomPayload(room))
  pushRoomList()
}

// ── Socket handlers ───────────────────────────────────────────────
io.on('connection', socket => {
  console.log('+ connected   :', socket.id)
  players.set(socket.id, { id: socket.id, nickname: null, roomId: null, sessionId: null })

  // ── session:restore ───────────────────────────────────────────
  socket.on('session:restore', incomingId => {
    const existing = incomingId ? sessions.get(incomingId) : null

    if (!existing) {
      // New session — issue an ID
      const sessionId = generateId()
      sessions.set(sessionId, { socketId: socket.id, timer: null })
      players.get(socket.id).sessionId = sessionId
      socket.emit('session:ready', { sessionId, restored: null })
      return
    }

    // Known session — cancel pending removal, migrate to new socketId
    clearTimeout(existing.timer)
    existing.timer  = null
    const oldId     = existing.socketId
    existing.socketId = socket.id

    migrateSocketId(oldId, socket.id)
    const player = players.get(socket.id)
    player.sessionId = incomingId

    // Re-join socket.io rooms
    if (player.roomId) socket.join(player.roomId)

    // Rebuild restored state payload
    const room = player.roomId ? rooms.get(player.roomId) : null
    const game = player.roomId ? games.get(player.roomId) : null
    let restored = null

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
          currentPlayerSocketId: game.seats[game.trickState.currentPlayerIdx].socketId,
          trick:        game.trickState.trick,
          tricksPlayed: game.trickState.tricksPlayed,
          scores:       game.trickState.scores,
          trump:        game.trump,
          bid:          { ...game.bidding.highBid, contree: game.bidding.contree },
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

    socket.emit('session:ready', { sessionId: incomingId, restored })
    if (game?.phase === 'playing') emitPlayState(player.roomId)
  })

  // ── nickname:set ──────────────────────────────────────────────
  socket.on('nickname:set', raw => {
    const nickname = String(raw).trim().slice(0, 20)
    if (!nickname) return
    players.get(socket.id).nickname = nickname
    socket.emit('nickname:ok', nickname)
  })

  // ── lobby:enter / lobby:leave ─────────────────────────────────
  socket.on('lobby:enter', () => {
    socket.join('lobby')
    socket.emit('rooms:list', getRoomList())
  })

  socket.on('lobby:leave', () => {
    socket.leave('lobby')
  })

  // ── room:create ───────────────────────────────────────────────
  socket.on('room:create', () => {
    const player = players.get(socket.id)
    if (!player?.nickname || player.roomId) return

    roomCounter++
    const room = {
      id:        generateId(),
      name:      `Salle #${roomCounter}`,
      players:   [socket.id],
      creatorId: socket.id
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
    emitBidState(player.roomId)
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

    bidding.passCount++
    bidding.currentBidderIdx = (bidding.currentBidderIdx + 1) % 4

    if (!bidding.highBid && bidding.passCount >= 4) {
      deal(rooms.get(player.roomId))
      return
    }
    if (bidding.highBid && bidding.passCount >= 3) {
      bidWon(player.roomId)
      return
    }
    emitBidState(player.roomId)
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
    const myTeam = seats.find(s => s.socketId === socket.id).team
    if (bidding.highBid.team === myTeam) return

    bidding.contree = 'contree'
    bidding.passCount++
    bidding.currentBidderIdx = (bidding.currentBidderIdx + 1) % 4

    if (bidding.passCount >= 3) { bidWon(player.roomId); return }
    emitBidState(player.roomId)
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
    const myTeam = seats.find(s => s.socketId === socket.id).team
    if (bidding.highBid.team !== myTeam) return

    bidding.contree = 'surcontree'
    io.to(player.roomId).emit('bid:surcontree-announced')
    setTimeout(() => bidWon(player.roomId), 1500)
  })

  // ── play:card ─────────────────────────────────────────────────
  socket.on('play:card', ({ rank, suit }) => {
    const player = players.get(socket.id)
    if (!player?.roomId) return
    const game = games.get(player.roomId)
    if (!game || game.phase !== 'playing') return
    const { trickState, seats, hands, trump } = game
    if (seats[trickState.currentPlayerIdx].socketId !== socket.id) return

    const hand    = hands[socket.id]
    const cardIdx = hand.findIndex(c => c.rank === rank && c.suit === suit)
    if (cardIdx === -1) return

    const valid = getValidCards(hand, trickState.trick, trump, socket.id, seats)
    if (!valid.some(c => c.rank === rank && c.suit === suit)) return

    // Belote/Rebelote detection
    const bh = trickState.beloteHolder
    let beloteAnnounce = null
    if (bh?.socketId === socket.id && suit === trump && (rank === 'K' || rank === 'Q')) {
      beloteAnnounce = (bh.played.K || bh.played.Q) ? 'rebelote' : 'belote'
      bh.played[rank] = true
    }

    hand.splice(cardIdx, 1)
    trickState.trick.push({ socketId: socket.id, rank, suit })

    if (beloteAnnounce) {
      const mySeat = seats.find(s => s.socketId === socket.id)
      io.to(player.roomId).emit('play:belote', {
        nickname: mySeat?.nickname,
        type:     beloteAnnounce,
      })
    }

    if (trickState.trick.length < 4) {
      trickState.currentPlayerIdx = (trickState.currentPlayerIdx + 1) % 4
      emitPlayState(player.roomId)
    } else {
      resolveTrick(player.roomId)
    }
  })

  // ── room:start ────────────────────────────────────────────────
  socket.on('room:start', () => {
    const player = players.get(socket.id)
    if (!player?.roomId) return

    const room = rooms.get(player.roomId)
    if (!room || room.creatorId !== socket.id || room.players.length !== 4) return

    deal(room)
  })

  // ── disconnect ────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log('- disconnected:', socket.id)
    const sessionId = players.get(socket.id)?.sessionId

    if (sessionId && sessions.has(sessionId)) {
      // Hold the player's spot for 20s before dropping them
      sessions.get(sessionId).timer = setTimeout(() => {
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
