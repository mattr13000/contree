// ── Card primitives ───────────────────────────────────────────────────
// The inline-SVG card face, the persistent-node factory, and the GSAP
// positioning helper. Everything that knows how a single card looks / moves.

import { gsap } from 'gsap'
import { ANIMATION, CARD_COLORS } from './uiConfig.js'
import { cardW, cardH } from './layout.js'
import { root } from './nodes.js'
import type { CardNode } from './nodes.js'
import type { Rank, Suit } from '../../../shared/types.js'

export const SUIT_SYMBOLS: Record<Suit, string> = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' }
export const isRedSuit = (suit: Suit): boolean => suit === 'Hearts' || suit === 'Diamonds'

// Inline SVG card face (ported from proto/game-ui.html). The corner index is
// drawn once and mirrored 180° about the centre; `.frame` is restyled to gold
// when the card div carries `.valid`.
export function cardSVG(rank: Rank | null, suit: Suit | null, faceUp: boolean): string {
  if (!faceUp || !rank || !suit) return `
    <svg viewBox="0 0 96 134">
      <rect class="frame" x="3" y="3" width="90" height="128" rx="11" fill="${CARD_COLORS.backFill}" stroke="${CARD_COLORS.backStroke}" stroke-width="3"/>
      <rect x="11" y="11" width="74" height="112" rx="7" fill="none" stroke="${CARD_COLORS.backInner}" stroke-width="2" stroke-dasharray="5 4"/>
      <text x="48" y="80" text-anchor="middle" font-size="30" fill="${CARD_COLORS.backInner}">♣</text>
    </svg>`
  const colour = isRedSuit(suit) ? CARD_COLORS.redSuit : CARD_COLORS.blackSuit, pip = SUIT_SYMBOLS[suit]
  const index = `<g><text x="10" y="27" font-size="21">${rank}</text><text x="11" y="45" font-size="16">${pip}</text></g>`
  return `
    <svg viewBox="0 0 96 134">
      <rect class="frame" x="3" y="3" width="90" height="128" rx="11" fill="${CARD_COLORS.faceFill}" stroke="${CARD_COLORS.faceStroke}" stroke-width="1.5"/>
      <g fill="${colour}" font-family="Georgia, serif" font-weight="bold">
        ${index}
        <g transform="rotate(180 48 67)">${index}</g>
        <text x="48" y="84" font-size="46" text-anchor="middle">${pip}</text>
      </g>
    </svg>`
}

export function makeCardNode(rank: Rank | null, suit: Suit | null, faceUp: boolean): CardNode {
  const el = document.createElement('div')
  el.className = 'g-card'
  el.style.width = cardW + 'px'; el.style.height = cardH + 'px'
  el.innerHTML = cardSVG(rank, suit, faceUp)
  root!.appendChild(el)
  return { rank, suit, faceUp, el }
}

export function setNodeFace(node: CardNode, rank: Rank, suit: Suit): void {
  node.rank = rank; node.suit = suit; node.faceUp = true
  node.el.innerHTML = cardSVG(rank, suit, true)
}

/** Position a card element via GSAP (animate = tween, else snap). */
export function place(el: HTMLElement, centerX: number, centerY: number, rotationDeg: number, scale: number, animate: boolean): void {
  const props = { x: centerX - cardW / 2, y: centerY - cardH / 2, rotation: rotationDeg, scale }
  if (animate) gsap.to(el, { ...props, duration: ANIMATION.cardMove.duration, ease: ANIMATION.cardMove.ease })
  else gsap.set(el, props)
}
