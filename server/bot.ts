// Server-side bot driver + basic-heuristic AI for the "play vs 3 bots" solo mode.
// Bots are virtual players (no socket): a turn hook from game.ts calls scheduleBotTurn
// whenever the acting seat may have changed, and we make a move if it's a bot's turn.
import { players, games, sessions, botTimers, roomBusyUntil, isBot, generateId } from './state.js'
import { setTurnHook, applyBid, applyPass, applyContree, applyPlay } from './game.js'
import { getValidCards, trickWinnerCard, cardPoints, trumpStrength, regularStrength } from './rules.js'
import { GAME_SUITS, bidNumeric, TRUMP_POINTS } from '../shared/constants.js'
import type { Card, Suit, BidValue, Team, Seat, PlayedCard, HighBid, Contree, GameState } from '../shared/types.js'

const NAME_POOL = [
  'Léa', 'Hugo', 'Tom', 'Zoé', 'Manon', 'Nina', 'Léo', 'Jules', 'Emma', 'Lucas',
  'Chloé', 'Théo', 'Camille', 'Antoine', 'Sarah', 'Maxime', 'Juliette', 'Nathan', 'Alice', 'Gabriel',
]

// Human-like pacing: every move is jittered, and floored by the room's "busy"
// lock so bots wait out the deal / play-start animations.
const JITTER_MIN = 800
const JITTER_MAX = 1500

/** Register the turn hook so game.ts drives us. Called once at startup. */
export function initBots(): void {
  setTurnHook(scheduleBotTurn)
}

/** Create `count` bot Players (roomId set by the caller). Avoids the human's name. */
export function makeBots(count: number, humanName: string): string[] {
  const pool = NAME_POOL.filter(n => n.toLowerCase() !== humanName.trim().toLowerCase())
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const name = pool.splice(Math.floor(Math.random() * pool.length), 1)[0] ?? `Robot ${i + 1}`
    const id   = `bot:${generateId()}`
    players.set(id, { id, nickname: `🤖 ${name}`, roomId: null, sessionId: null })
    ids.push(id)
  }
  return ids
}

/** True while the room's human is mid-disconnect (grace timer pending). */
function humanDisconnected(game: GameState): boolean {
  const humanSeat = game.seats.find(s => !isBot(s.socketId))
  if (!humanSeat) return false
  const sessionId = players.get(humanSeat.socketId)?.sessionId
  if (!sessionId) return false
  const sess = sessions.get(sessionId)
  return !!sess && sess.timer !== null
}

function currentActor(game: GameState): string | undefined {
  if (game.phase === 'bidding') return game.seats[game.bidding.currentBidderIdx]?.socketId
  if (game.phase === 'playing' && game.trickState) return game.seats[game.trickState.currentPlayerIdx]?.socketId
  return undefined
}

/** If it's a bot's turn, schedule its move (idempotent: clears any pending timer first). */
export function scheduleBotTurn(roomId: string): void {
  const game = games.get(roomId)
  if (!game) return
  if (humanDisconnected(game)) return            // pause — don't race ahead off-screen

  const actorId = currentActor(game)
  if (!actorId || !isBot(actorId)) return

  const phaseAtSchedule = game.phase
  const existing = botTimers.get(roomId)
  if (existing) clearTimeout(existing)

  const jitter = JITTER_MIN + Math.random() * (JITTER_MAX - JITTER_MIN)
  const floor  = (roomBusyUntil.get(roomId) ?? 0) - Date.now()
  const delay  = Math.max(jitter, floor)

  botTimers.set(roomId, setTimeout(() => {
    botTimers.delete(roomId)
    // Re-validate — state can change during the delay (human left, room torn down,
    // another path advanced the turn).
    const g = games.get(roomId)
    if (!g || g.phase !== phaseAtSchedule) return
    if (humanDisconnected(g)) return                 // human left during the delay — pause
    if (currentActor(g) !== actorId) return

    if (g.phase === 'bidding') runBotBid(roomId, g, actorId)
    else                       runBotPlay(roomId, g, actorId)
  }, delay))
}

// ── Bidding ───────────────────────────────────────────────────────
function runBotBid(roomId: string, game: GameState, botId: string): void {
  const hand   = game.hands[botId] ?? []
  const myTeam = game.seats.find(s => s.socketId === botId)?.team ?? 'A'
  const d = decideBid(hand, game.bidding.highBid, myTeam, game.bidding.contree)
  if (d.action === 'bid')          applyBid(roomId, botId, { value: d.value, suit: d.suit })
  else if (d.action === 'contree') applyContree(roomId, botId)
  else                             applyPass(roomId, botId)
}

type BidDecision =
  | { action: 'bid'; value: BidValue; suit: Suit }
  | { action: 'contree' }
  | { action: 'pass' }

/** Score each suit as trump from hand strength → a conservative bid, else pass. */
export function decideBid(hand: Card[], highBid: HighBid | null, myTeam: Team, contree: Contree): BidDecision {
  if (contree) return { action: 'pass' }   // never surcontrée; if opponents contréed, just pass

  // Best suit by estimated strength as trump.
  let bestSuit: Suit = GAME_SUITS[0]
  let bestScore = -1
  for (const suit of GAME_SUITS) {
    const score = suitStrength(hand, suit)
    if (score > bestScore) { bestScore = score; bestSuit = suit }
  }

  const level = strengthToBid(bestScore)   // null = too weak to open

  if (highBid) {
    if (highBid.team === myTeam) return { action: 'pass' }            // partner owns it — let them play
    if (level !== null && bidNumeric(level) > bidNumeric(highBid.value)) {
      return { action: 'bid', value: level, suit: bestSuit }
    }
    // Can't outbid the opponents — rarely contrée a high contract we look strong against.
    const defence = suitStrength(hand, highBid.suit)
    if (bidNumeric(highBid.value) >= 100 && defence >= 30 && Math.random() < 0.5) {
      return { action: 'contree' }
    }
    return { action: 'pass' }
  }

  return level !== null ? { action: 'bid', value: level, suit: bestSuit } : { action: 'pass' }
}

/** Rough point-estimate of a hand if `suit` were trump. */
function suitStrength(hand: Card[], suit: Suit): number {
  let score = 0
  let trumpCount = 0
  for (const c of hand) {
    if (c.suit === suit) { score += TRUMP_POINTS[c.rank]; trumpCount++ }
    else if (c.rank === 'A') score += 11
    else if (c.rank === '10') score += 5
  }
  return score + trumpCount * 3   // length bonus
}

function strengthToBid(score: number): BidValue | null {
  if (score >= 55) return 110
  if (score >= 45) return 100
  if (score >= 36) return 90
  if (score >= 28) return 80
  return null
}

// ── Card play ─────────────────────────────────────────────────────
function runBotPlay(roomId: string, game: GameState, botId: string): void {
  const ts    = game.trickState
  const trump = game.trump
  if (!ts || !trump) return
  const valid = getValidCards(game.hands[botId] ?? [], ts.trick, trump, botId, game.seats)
  if (!valid.length) return
  const card = decideCard(valid, ts.trick, trump, game.seats, botId)
  applyPlay(roomId, botId, { rank: card.rank, suit: card.suit })
}

/** Win cheaply when possible, otherwise dump the lowest-value card. */
export function decideCard(valid: Card[], trick: PlayedCard[], trump: Suit, seats: Seat[], botId: string): Card {
  if (valid.length === 1) return valid[0]

  // Leading: cash a side-suit Ace, else shed a low card.
  if (trick.length === 0) {
    const ace = valid.find(c => c.suit !== trump && c.rank === 'A')
    if (ace) return ace
    const nonTrump = valid.filter(c => c.suit !== trump)
    return lowest(nonTrump.length ? nonTrump : valid, trump)
  }

  // Following.
  const winner     = trickWinnerCard(trick, trump)
  const winnerTeam = seats.find(s => s.socketId === winner.socketId)?.team
  const myTeam     = seats.find(s => s.socketId === botId)?.team
  if (winnerTeam && myTeam && winnerTeam === myTeam) return lowest(valid, trump)   // partner winning → dump

  const winners = valid.filter(c => beats(c, trick, trump, botId))
  return lowest(winners.length ? winners : valid, trump)   // cheapest win, else cheapest dump
}

/** Would playing `card` win the trick as it stands? */
function beats(card: Card, trick: PlayedCard[], trump: Suit, botId: string): boolean {
  const w = trickWinnerCard([...trick, { ...card, socketId: botId }], trump)
  return w.socketId === botId
}

function pointsOf(c: Card, trump: Suit): number { return cardPoints(c.rank, c.suit, trump) }
function strengthOf(c: Card, trump: Suit): number {
  return c.suit === trump ? trumpStrength(c.rank) : regularStrength(c.rank)
}

/** Fewest points, then weakest rank. */
function lowest(cards: Card[], trump: Suit): Card {
  return [...cards].sort((a, b) =>
    pointsOf(a, trump) - pointsOf(b, trump) || strengthOf(a, trump) - strengthOf(b, trump)
  )[0]
}
