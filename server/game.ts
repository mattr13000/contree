import type { Server } from 'socket.io'
import { players, rooms, games, getRoomList, roomPayload } from './state.js'
import type {
  Rank, Suit, Team, Card, PlayedCard, Seat, Room,
  TeamScores, BidInfo, LastAction, BeloteHolder, TrickState,
  ClientToServerEvents, ServerToClientEvents,
} from '../shared/types.js'
import {
  RANKS, GAME_SUITS, TRUMP_RANK_ORDER, REGULAR_RANK_ORDER,
  TRUMP_POINTS, REGULAR_POINTS, POSITIONS, TEAMS,
  BELOTE_BONUS, WINNING_SCORE,
} from '../shared/constants.js'
import { computeGameScore } from '../shared/scoring.js'

// ── Pure helpers ──────────────────────────────────────────────────
function trumpStrength(r: Rank): number   { return TRUMP_RANK_ORDER.indexOf(r) }
function regularStrength(r: Rank): number { return REGULAR_RANK_ORDER.indexOf(r) }

function cardPoints(rank: Rank, suit: Suit, trump: Suit): number {
  return ((suit === trump) ? TRUMP_POINTS : REGULAR_POINTS)[rank] ?? 0
}

function trickWinnerCard(trick: PlayedCard[], trump: Suit): PlayedCard {
  return trick.reduce((best, c) => {
    if (c.suit === trump && (best.suit !== trump || trumpStrength(c.rank) > trumpStrength(best.rank))) return c
    if (c.suit !== trump && c.suit === best.suit && best.suit !== trump && regularStrength(c.rank) > regularStrength(best.rank)) return c
    return best
  })
}

export function getValidCards(hand: Card[], trick: PlayedCard[], trump: Suit, mySocketId: string, seats: Seat[]): Card[] {
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
    .reduce<PlayedCard | null>((b, c) => (!b || trumpStrength(c.rank) > trumpStrength(b.rank)) ? c : b, null)
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

function buildDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of GAME_SUITS) for (const rank of RANKS) deck.push({ rank, suit })
  return deck
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── io injection ──────────────────────────────────────────────────
let io!: Server<ClientToServerEvents, ServerToClientEvents>
export function init(_io: Server<ClientToServerEvents, ServerToClientEvents>): void { io = _io }

// ── Lobby helpers ─────────────────────────────────────────────────
export function pushRoomList(): void {
  io.to('lobby').emit('rooms:list', getRoomList())
}

export function leaveRoom(socketId: string): void {
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
export function deal(room: Room): void {
  const deck      = shuffle(buildDeck())
  const prevGame  = games.get(room.id)
  const dealerIdx = prevGame ? (prevGame.dealerIdx + 1) % 4 : 0
  const bidderIdx = (dealerIdx + 1) % 4

  const playerOrder = prevGame
    ? prevGame.seats.map(s => s.socketId)
    : shuffle([...room.players])
  const seats: Seat[] = playerOrder.map((socketId, i) => ({
    socketId,
    nickname: players.get(socketId)?.nickname ?? '?',
    position: POSITIONS[i],
    team:     TEAMS[i],
  }))

  const hands: Record<string, Card[]> = {}
  seats.forEach((seat, i) => { hands[seat.socketId] = deck.slice(i * 8, (i + 1) * 8) })

  games.set(room.id, {
    roomId: room.id, seats, hands, dealerIdx, bidderIdx, phase: 'bidding',
    cumulativeScores: prevGame?.cumulativeScores ?? { A: 0, B: 0 },
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

export function emitBidState(roomId: string, lastAction: LastAction | null = null): void {
  const game = games.get(roomId)
  if (!game) return
  const { bidding, seats } = game
  io.to(roomId).emit('bid:state', {
    currentBidderSocketId: seats[bidding.currentBidderIdx].socketId,
    highBid:               bidding.highBid,
    contree:               bidding.contree,
    lastAction,
  })
}

export function bidWon(roomId: string): void {
  const game = games.get(roomId)
  if (!game || !game.bidding.highBid) return
  game.phase = 'playing'
  const trump          = game.bidding.highBid.suit
  game.trump           = trump
  const firstPlayerIdx = (game.dealerIdx + 1) % 4

  const beloteEntry = Object.entries(game.hands).find(([, hand]) =>
    hand.some(c => c.suit === trump && c.rank === 'K') &&
    hand.some(c => c.suit === trump && c.rank === 'Q')
  )
  const beloteHolder: BeloteHolder | null = beloteEntry ? {
    socketId: beloteEntry[0],
    team:     game.seats.find(s => s.socketId === beloteEntry[0])?.team,
    played:   { K: false, Q: false },
  } : null
  const trickState: TrickState = {
    currentPlayerIdx: firstPlayerIdx,
    trickLeaderIdx:   firstPlayerIdx,
    trick:            [],
    tricksPlayed:     0,
    scores:           { A: 0, B: 0 },
    tricksWon:        { A: 0, B: 0 },
    beloteHolder,
  }
  game.trickState = trickState

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

export function emitPlayState(roomId: string): void {
  const game = games.get(roomId)
  if (!game?.trickState || !game.trump) return
  const { trickState, seats, hands, trump } = game
  const current = seats[trickState.currentPlayerIdx]

  io.to(roomId).emit('play:state', {
    currentPlayerSocketId: current.socketId,
    trickLeaderSocketId:   seats[trickState.trickLeaderIdx].socketId,
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

export function resolveTrick(roomId: string): void {
  const game = games.get(roomId)
  if (!game?.trickState || !game.trump || !game.bidding.highBid) return
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
    const beloteBonus: TeamScores = { A: 0, B: 0 }
    const bh = trickState.beloteHolder
    if (bh?.played.K && bh?.played.Q && bh.team) beloteBonus[bh.team] += BELOTE_BONUS

    setTimeout(() => {
      const hb = game.bidding.highBid!
      const bid: BidInfo = { value: hb.value, suit: hb.suit, team: hb.team, contree: game.bidding.contree }
      io.to(roomId).emit('game:over', {
        scores:     trickState.scores,
        tricksWon:  trickState.tricksWon,
        beloteBonus,
        bid,
      })
      game.phase = 'ended'

      const gameResult = computeGameScore(trickState.scores, trickState.tricksWon, beloteBonus, bid).result
      game.cumulativeScores.A += gameResult.A
      game.cumulativeScores.B += gameResult.B

      const r = rooms.get(roomId)
      setTimeout(() => {
        if (!r || r.players.length !== 4) return
        const { cumulativeScores, seats } = game
        if (cumulativeScores.A >= WINNING_SCORE || cumulativeScores.B >= WINNING_SCORE) {
          const winnerTeam: Team = (cumulativeScores.A >= WINNING_SCORE && cumulativeScores.B >= WINNING_SCORE)
            ? (cumulativeScores.A >= cumulativeScores.B ? 'A' : 'B')
            : cumulativeScores.A >= WINNING_SCORE ? 'A' : 'B'
          const winnerNicknames = seats.filter(s => s.team === winnerTeam).map(s => s.nickname)
          io.to(roomId).emit('game:victory', { winnerTeam, winnerNicknames, cumulativeScores })
        } else {
          deal(r)
        }
      }, 8000)
    }, 2000)
    return
  }

  const winnerIdx = seats.findIndex(s => s.socketId === winner.socketId)
  trickState.trick            = []
  trickState.currentPlayerIdx = winnerIdx
  trickState.trickLeaderIdx   = winnerIdx

  setTimeout(() => emitPlayState(roomId), 2000)
}
