// Shared game constants — single source of truth for server + client.
import type { Rank, Suit, Team, Position, BidValue } from './types.js'

// ── Deck / bidding ─────────────────────────────────────────────────
export const RANKS:      Rank[]     = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A']
export const GAME_SUITS: Suit[]     = ['Hearts', 'Diamonds', 'Clubs', 'Spades']
export const BID_VALUES: BidValue[] = [80, 90, 100, 110, 120, 130, 140, 150, 160, 'Capot']

/** Numeric value of a bid ('Capot' = 250). */
export function bidNumeric(v: BidValue): number { return v === 'Capot' ? 250 : v }

// ── Card strength / points ─────────────────────────────────────────
export const TRUMP_RANK_ORDER:   Rank[] = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J']
export const REGULAR_RANK_ORDER: Rank[] = ['7', '8', '9', 'J', 'Q', 'K', '10', 'A']
export const TRUMP_POINTS:   Record<Rank, number> = { 'J': 20, '9': 14, 'A': 11, '10': 10, 'K': 4, 'Q': 3, '8': 0, '7': 0 }
export const REGULAR_POINTS: Record<Rank, number> = { 'A': 11, '10': 10, 'K': 4, 'Q': 3, 'J': 2, '9': 0, '8': 0, '7': 0 }

// ── Seat layout ────────────────────────────────────────────────────
export const POSITIONS: Position[] = ['south', 'west', 'north', 'east']
export const TEAMS:      Team[]     = ['A',     'B',    'A',     'B'   ]

// ── Display ────────────────────────────────────────────────────────
export const SUIT_SYMBOLS: Record<Suit, string> = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' }

// ── Scoring magic numbers ──────────────────────────────────────────
export const CAPOT_VALUE   = 250
export const CHUTE_POINTS  = 160
export const BELOTE_BONUS  = 20
export const WINNING_SCORE = 500

// ── Turn timer ─────────────────────────────────────────────────────
/** Time a human seat has to act before the server auto-acts (pass while bidding,
 *  a random valid card while playing). The countdown starts AFTER the table's
 *  busy lock (deal/play-start animations), so it never runs during the cascade. */
export const TURN_TIMEOUT_MS      = 20_000
/** Below this remaining time the client paints the countdown red. */
export const TURN_TIMER_DANGER_MS = 5_000
