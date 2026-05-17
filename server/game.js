import { players, rooms, games, getRoomList, roomPayload } from './state.js'

// ── Constants ─────────────────────────────────────────────────────
export const RANKS      = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A']
export const GAME_SUITS = ['Hearts', 'Diamonds', 'Clubs', 'Spades']
export const BID_VALUES = [80, 90, 100, 110, 120, 130, 140, 150, 160, 'Capot']
export function bidNumeric(v) { return v === 'Capot' ? 250 : v }

const TRUMP_RANK_ORDER   = ['7','8','Q','K','10','A','9','J']
const REGULAR_RANK_ORDER = ['7','8','9','J','Q','K','10','A']
const TRUMP_POINTS   = { 'J':20,'9':14,'A':11,'10':10,'K':4,'Q':3,'8':0,'7':0 }
const REGULAR_POINTS = { 'A':11,'10':10,'K':4,'Q':3,'J':2,'9':0,'8':0,'7':0 }

const POSITIONS = ['south', 'west', 'north', 'east']
const TEAMS     = ['A',     'B',    'A',     'B'   ]

// ── Pure helpers ──────────────────────────────────────────────────
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

export function getValidCards(hand, trick, trump, mySocketId, seats) {
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

// ── io injection ──────────────────────────────────────────────────
let io
export function init(_io) { io = _io }

// ── Lobby helpers ─────────────────────────────────────────────────
export function pushRoomList() {
  io.to('lobby').emit('rooms:list', getRoomList())
}

export function leaveRoom(socketId) {
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

  if (room.creatorId === socketId) room.creatorId = room.players[0]

  io.to(roomId).emit('room:updated', roomPayload(room))
  pushRoomList()
}

// ── Game flow ─────────────────────────────────────────────────────
export function deal(room) {
  const deck      = shuffle(buildDeck())
  const prevGame  = games.get(room.id)
  const dealerIdx = prevGame ? (prevGame.dealerIdx + 1) % 4 : 0
  const bidderIdx = (dealerIdx + 1) % 4

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

  games.set(room.id, {
    roomId: room.id, seats, hands, dealerIdx, bidderIdx, phase: 'bidding',
    bidding: { currentBidderIdx: bidderIdx, passCount: 0, highBid: null, contree: false },
  })

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

export function emitBidState(roomId) {
  const game = games.get(roomId)
  if (!game) return
  const { bidding, seats } = game
  io.to(roomId).emit('bid:state', {
    currentBidderSocketId: seats[bidding.currentBidderIdx].socketId,
    highBid:               bidding.highBid,
    contree:               bidding.contree,
  })
}

export function bidWon(roomId) {
  const game = games.get(roomId)
  if (!game) return
  game.phase = 'playing'
  const trump          = game.bidding.highBid.suit
  game.trump           = trump
  const firstPlayerIdx = (game.dealerIdx + 1) % 4

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
    tricksWon:        { A: 0, B: 0 },
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

export function emitPlayState(roomId) {
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

export function resolveTrick(roomId) {
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
  if (isLast) pts += 10

  trickState.scores[winnerSeat.team]    += pts
  trickState.tricksWon[winnerSeat.team] += 1

  io.to(roomId).emit('trick:won', {
    winnerSocketId: winner.socketId,
    winnerNickname: winnerSeat.nickname,
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
        scores:     trickState.scores,
        tricksWon:  trickState.tricksWon,
        beloteBonus,
        bid:        { ...game.bidding.highBid, contree: game.bidding.contree },
      })
      game.phase = 'ended'
      const r = rooms.get(roomId)
      setTimeout(() => { if (r && r.players.length === 4) deal(r) }, 8000)
    }, 2000)
    return
  }

  const winnerIdx = seats.findIndex(s => s.socketId === winner.socketId)
  trickState.trick            = []
  trickState.currentPlayerIdx = winnerIdx
  trickState.trickLeaderIdx   = winnerIdx

  setTimeout(() => emitPlayState(roomId), 2000)
}
