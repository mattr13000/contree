// Pure card-game rules — no io, no state. Deterministic and unit-testable.
import { randomInt } from 'crypto'
import type { Rank, Suit, Card, PlayedCard, Seat } from '../shared/types.js'
import {
  RANKS, GAME_SUITS, TRUMP_RANK_ORDER, REGULAR_RANK_ORDER,
  TRUMP_POINTS, REGULAR_POINTS,
} from '../shared/constants.js'

export function trumpStrength(r: Rank): number   { return TRUMP_RANK_ORDER.indexOf(r) }
export function regularStrength(r: Rank): number { return REGULAR_RANK_ORDER.indexOf(r) }

export function cardPoints(rank: Rank, suit: Suit, trump: Suit): number {
  return ((suit === trump) ? TRUMP_POINTS : REGULAR_POINTS)[rank] ?? 0
}

export function trickWinnerCard(trick: PlayedCard[], trump: Suit): PlayedCard {
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

export function buildDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of GAME_SUITS) for (const rank of RANKS) deck.push({ rank, suit })
  return deck
}

export function shuffle<T>(arr: T[]): T[] {
  // Crypto-secure Fisher–Yates: knowing the deck order wins the game, so the
  // shuffle must not be predictable. randomInt(n) draws an unbiased int in [0, n).
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
