// ── Render-side game state ────────────────────────────────────────────
// The state object + small pure helpers that the rest of game/*.ts and the
// features/*.ts consumers read. No DOM, no GSAP here.

import type {
  Rank, Suit, Card, Team, Position, Contree, BidValue, LastAction, TeamScores,
} from '../../../shared/types.js'

/** A seat from the local player's point of view (south = me, north = ally, etc.). */
export interface RenderSeat {
  socketId: string
  nickname: string
  position: Position
  team: Team
  isAlly: boolean
  isMe: boolean
  cardCount: number
  lastBidAction: LastAction | null
}
/** Current bid as the HUD needs it (BidInfo's `team` is accepted but unused here). */
export interface RenderBid { value: BidValue; suit: Suit; contree: Contree }
export interface RenderTrickInfo {
  currentPlayerSocketId: string
  trickLeaderSocketId: string | undefined
  scores: TeamScores
  tricksPlayed: number
}
export interface RenderState {
  mySocketId: string | null
  seats: RenderSeat[]
  myHand: Card[]
  pli: Card[]
  bid: RenderBid | null
  bidderNickname: string | null
  bidderSocketId: string | null
  highBidderNickname: string | null
  trump: Suit | null
  isMyTurn: boolean
  validCards: Card[]
  trickInfo: RenderTrickInfo | null
  trickMessage: string | null
  /** The 4 cards of the last completed trick (with the seat that played each),
   *  kept so the player can review it via the HUD "Dernier pli" button. */
  lastTrick: { from: Position; rank: Rank; suit: Suit }[] | null
  /** Turn-timer countdown on the LOCAL clock (performance.now() ms at which it hits 0),
   *  null = no countdown. turnDuration = the full turn span (ms) for the ring fraction. */
  turnDeadline: number | null
  turnDuration: number
}

export const state: RenderState = {
  mySocketId: null,
  seats: [
    { socketId: '', nickname: 'Vous',    position: 'south', team: 'A', isAlly: true,  isMe: true,  cardCount: 8, lastBidAction: null },
    { socketId: '', nickname: 'Alice',   position: 'north', team: 'A', isAlly: true,  isMe: false, cardCount: 8, lastBidAction: null },
    { socketId: '', nickname: 'Bob',     position: 'west',  team: 'B', isAlly: false, isMe: false, cardCount: 8, lastBidAction: null },
    { socketId: '', nickname: 'Charlie', position: 'east',  team: 'B', isAlly: false, isMe: false, cardCount: 8, lastBidAction: null },
  ],
  myHand: [],
  pli:                [],
  bid:                null,
  bidderNickname:     null,
  bidderSocketId:     null,
  highBidderNickname: null,
  trump:        null,
  isMyTurn:     false,
  validCards:   [],
  trickInfo:    null,
  trickMessage: null,
  lastTrick:    null,
  turnDeadline: null,
  turnDuration: 0,
}

// Transient UI flags held on a mutable object so any game/*.ts module can read/clear
// them: the tap-to-confirm pending card, and whether the "Dernier pli" review overlay
// is open.
export const ui: { pendingCard: Card | null; lastTrickOpen: boolean } = { pendingCard: null, lastTrickOpen: false }

let onCardPlay: ((card: Card) => void) | null = null
export function setOnCardPlay(cb: (card: Card) => void): void { onCardPlay = cb }
export function fireCardPlay(card: Card): void { onCardPlay?.(card) }

export const seatAt = (pos: Position): RenderSeat =>
  state.seats.find(s => s.position === pos) ?? state.seats[0]
export const seatBySocket = (socketId: string): RenderSeat | undefined =>
  state.seats.find(s => s.socketId === socketId)

export const isValidCard = (card: Card): boolean =>
  state.validCards.some(c => c.rank === card.rank && c.suit === card.suit)

// ── Hand sorting ──────────────────────────────────────────────────────
// Suit order: Hearts > Spades > Diamonds > Clubs. Non-trump rank power vs the
// trump rank power (J > 9 > A > 10 > K > Q > 8 > 7). Called on deal + play-start.
const SUIT_ORDER:       Record<Suit, number> = { Hearts: 0, Spades: 1, Diamonds: 2, Clubs: 3 }
const RANK_ORDER:       Record<Rank, number> = { A: 0, '10': 1, K: 2, Q: 3, J: 4, '9': 5, '8': 6, '7': 7 }
const RANK_ORDER_TRUMP: Record<Rank, number> = { J: 0, '9': 1, A: 2, '10': 3, K: 4, Q: 5, '8': 6, '7': 7 }
export function sortHand(hand: Card[], trump: Suit | null = null): Card[] {
  return [...hand].sort((a, b) => {
    const suitDiff = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]
    if (suitDiff !== 0) return suitDiff
    const order = trump && a.suit === trump ? RANK_ORDER_TRUMP : RANK_ORDER
    return order[a.rank] - order[b.rank]
  })
}
