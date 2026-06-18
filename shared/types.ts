// ──────────────────────────────────────────────────────────────────
// Shared domain + socket contract for Contrée.
// Imported by both the server (server/*.ts) and the client (client/src/*.ts).
// ──────────────────────────────────────────────────────────────────

// ── Card primitives ───────────────────────────────────────────────
export type Suit = 'Hearts' | 'Diamonds' | 'Clubs' | 'Spades'
export type Rank = '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'
export type Team = 'A' | 'B'
export type Position = 'south' | 'west' | 'north' | 'east'

export interface Card {
  rank: Rank
  suit: Suit
}

/** A card after it has been played to a trick — carries who played it. */
export interface PlayedCard extends Card {
  socketId: string
}

// ── Bidding ────────────────────────────────────────────────────────
/** Numeric contract value, or 'Capot' (worth 250). */
export type BidValue = number | 'Capot'
/** false = no contrée yet; then escalates. */
export type Contree = false | 'contree' | 'surcontree'

export interface HighBid {
  value: BidValue
  suit: Suit
  team: Team
  bidderNickname: string
}

/** Final/locked bid info passed to the play phase and scoring. */
export interface BidInfo {
  value: BidValue
  suit: Suit
  team: Team
  contree: Contree
}

export type LastAction =
  | { type: 'bid'; socketId: string; nickname: string; value: BidValue; suit: Suit }
  | { type: 'pass'; socketId: string; nickname: string }
  | { type: 'contree'; socketId: string; nickname: string }

// ── Per-team scores ────────────────────────────────────────────────
export interface TeamScores {
  A: number
  B: number
}

// ── Game state (authoritative, server-side) ────────────────────────
export type Phase = 'bidding' | 'playing' | 'ended'

export interface Seat {
  socketId: string
  nickname: string
  position: Position
  team: Team
}

export interface BiddingState {
  currentBidderIdx: number
  passCount: number
  highBid: HighBid | null
  contree: Contree
}

export interface BeloteHolder {
  socketId: string
  team: Team | undefined
  played: { K: boolean; Q: boolean }
}

export interface TrickState {
  currentPlayerIdx: number
  trickLeaderIdx: number
  trick: PlayedCard[]
  tricksPlayed: number
  scores: TeamScores
  tricksWon: TeamScores
  beloteHolder: BeloteHolder | null
}

export interface GameState {
  roomId: string
  seats: Seat[]
  hands: Record<string, Card[]>
  dealerIdx: number
  bidderIdx: number
  phase: Phase
  trump?: Suit
  cumulativeScores: TeamScores
  bidding: BiddingState
  trickState?: TrickState
}

// ── Lobby / session entities ───────────────────────────────────────
export interface Player {
  id: string
  nickname: string | null
  roomId: string | null
  sessionId: string | null
}

export interface Room {
  id: string
  name: string
  players: string[]
  creatorId: string
}

export interface Session {
  socketId: string
  timer: ReturnType<typeof setTimeout> | null
}

// ── Socket payloads (server → client) ──────────────────────────────
export interface RoomListItem {
  id: string
  name: string
  playerCount: number
}

export interface RoomPayload {
  id: string
  name: string
  creatorId: string
  players: { id: string; nickname: string }[]
}

export interface DealtPayload {
  seats: Seat[]
  myHand: Card[]
  dealerPosition: Position
  firstBidderPosition: Position
}

export interface BidStatePayload {
  currentBidderSocketId: string
  highBid: HighBid | null
  contree: Contree
  /** Omitted on session restore; null on initial deal. */
  lastAction?: LastAction | null
}

export interface PlayStartPayload {
  bid: BidInfo
  firstPlayerSocketId: string
  trump: Suit
}

export interface PlayStatePayload {
  currentPlayerSocketId: string
  trickLeaderSocketId: string
  trick: PlayedCard[]
  tricksPlayed: number
  scores: TeamScores
  trump: Suit
}

export interface TrickWonPayload {
  winnerSocketId: string
  winnerNickname: string
  trick: PlayedCard[]
  scores: TeamScores
  tricksPlayed: number
}

export interface GameOverPayload {
  scores: TeamScores
  tricksWon: TeamScores
  beloteBonus: TeamScores
  bid: BidInfo
}

export interface VictoryPayload {
  winnerTeam: Team
  winnerNicknames: string[]
  cumulativeScores: TeamScores
}

/** Snapshot sent on session:restore so the client jumps to the right screen. */
export type Restored =
  | {
      state: 'game'
      nickname: string | null
      dealt: DealtPayload
      bidState: Omit<BidStatePayload, 'lastAction'> | null
      playState:
        | (Omit<PlayStatePayload, 'trickLeaderSocketId'> & { bid: BidInfo })
        | null
    }
  | { state: 'waiting'; nickname: string | null; room: RoomPayload; isCreator: boolean }
  | { state: 'lobby'; nickname: string | null }

export interface SessionReadyPayload {
  sessionId: string
  restored: Restored | null
}

// ── Socket event maps (typed io / socket) ──────────────────────────
export interface ServerToClientEvents {
  'session:ready': (p: SessionReadyPayload) => void
  'nickname:ok': (nickname: string) => void
  'rooms:list': (rooms: RoomListItem[]) => void
  'room:joined': (p: { room: RoomPayload; isCreator: boolean }) => void
  'room:updated': (room: RoomPayload) => void
  'room:left': () => void
  'room:error': (msg: string) => void
  'game:dealt': (p: DealtPayload) => void
  'bid:state': (p: BidStatePayload) => void
  'bid:contree-announced': () => void
  'bid:surcontree-announced': () => void
  'game:play-start': (p: PlayStartPayload) => void
  'play:state': (p: PlayStatePayload) => void
  'play:your-turn': (p: { validCards: Card[] }) => void
  'play:belote': (p: { nickname: string | undefined; type: 'belote' | 'rebelote' }) => void
  'trick:won': (p: TrickWonPayload) => void
  'game:over': (p: GameOverPayload) => void
  'game:victory': (p: VictoryPayload) => void
}

export interface ClientToServerEvents {
  'session:restore': (sessionId: string | null) => void
  'nickname:set': (raw: string) => void
  'lobby:enter': () => void
  'lobby:leave': () => void
  'room:create': () => void
  'room:create-solo': () => void
  'room:join': (roomId: string) => void
  'room:leave': () => void
  'room:start': () => void
  'bid:place': (p: { value: BidValue; suit: Suit }) => void
  'bid:pass': () => void
  'bid:contree': () => void
  'bid:surcontree': () => void
  'play:card': (p: { rank: Rank; suit: Suit }) => void
}
