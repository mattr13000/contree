// ── Persistent visual model (the live DOM registry) ───────────────────
// Card elements live across events so GSAP can tween them. This module owns
// the registry; cards.ts builds the elements, animations.ts moves them,
// chrome.ts/index.ts read them.

import type { Position, Rank, Suit } from '../../../shared/types.js'

/** A card element that lives across events so GSAP can tween it.
 *  rank/suit are null for face-down opponent cards until revealed. */
export interface CardNode { rank: Rank | null; suit: Suit | null; faceUp: boolean; el: HTMLDivElement }

// The #game element. Set once by initGame; read live (ESM binding) everywhere.
export let root: HTMLElement | null = null
export function setRoot(el: HTMLElement): void { root = el }

export const handNodes: Record<Position, CardNode[]> = { south: [], west: [], north: [], east: [] }
/** Current trick cards, in play order. Mutated in place (push / length=0) so the
 *  exported reference stays stable across modules — never reassign it. */
export const pliNodes: { from: Position; socketId: string; node: CardNode }[] = []

export const findSouthNode = (rank: Rank, suit: Suit): CardNode | undefined =>
  handNodes.south.find(n => n.rank === rank && n.suit === suit)
