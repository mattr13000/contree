// ════════════════════════════════════════════════════════════════════
// uiConfig.ts — single place to tweak the GAME RENDERER's look & feel.
//
// Everything `game.ts` reads to lay out / animate / draw the table lives here:
// card size, per-viewport layout presets, pli geometry, GSAP timings, and the
// SVG card colours. Tweak a value here and the renderer follows.
//
// NOT here (pure-CSS styling, edit in client/src/style.css):
//   · bid modal / contrer modal           → #bid-modal-box, #contrer-modal-box
//   · seat name plates + HUD chrome        → .g-seat, .g-bidhud, .g-contract, .g-trickhud
//   · tap-to-confirm dim + ✓/✗ boxes       → .g-confirm-dim, .g-confirm-box
//   · "valid card" gold frame highlight    → .g-card.valid svg .frame  (uses VALID_FRAME below)
//   · team colours (ally blue / foe red)   → .g-seat.ally / .g-seat.foe
// ════════════════════════════════════════════════════════════════════

// ── Card box ──────────────────────────────────────────────────────────
// Base size in proto units (the SVG viewBox is 96×134); scaled per viewport.
export const CARD_BASE_WIDTH = 96
export const CARD_BASE_HEIGHT = 134

// ── Viewport → preset + scale ─────────────────────────────────────────
export const VIEWPORT = {
  /** Below this min(width,height) in px the portrait preset kicks in (else desktop). */
  portraitBreakpoint: 600,
  /** Card scale = clamp(minSide / referenceSide, minScale, maxScale) × preset.cardScale. */
  referenceSide: 600,
  minScale: 0.5,
  maxScale: 1,
}

// ── Layout presets (baked from proto/game-ui.html) ────────────────────
// Desktop + portrait only — landscape phones get the force-portrait overlay.
// All offsets are factors of card width (×cw) / card height (×ch) / field half-extent,
// so the layout is resolution-independent.
export interface LayoutPreset {
  /** page.margin is a FRACTION of the smaller viewport side; maxAspect caps the field width. */
  page:      { margin: number; maxAspect: number }
  /** Multiplier on the viewport-derived card scale. */
  cardScale: number
  /** My hand (bottom). bottom = how far up ×ch · step = gap ×cw · arc = curve · fan = tilt° · scale. */
  south:     { bottom: number; step: number; arc: number; fan: number; scale: number }
  /** Ally hand (top). top = descent ×ch (negative spills off-screen) · step ×cw · scale. */
  north:     { top: number; step: number; scale: number }
  /** Opponent hands (left/right). edge = inset ×ch (negative spills off) · step ×cw · vshift · scale. */
  side:      { edge: number; step: number; vshift: number; scale: number }
  /** Current trick. spread = side-card horizontal offset ×cw · rot = per-card tilt° ·
   *  messageY = "X remporte le pli" message offset ×ch below centre. */
  pli:       { spread: number; rot: number; messageY: number }
  /** Name plate positions. southY/northY ×ch from edge · sideGap ×cw toward centre · sideY ×cw. */
  plate:     { southY: number; northY: number; sideGap: number; sideY: number }
  /** HUD vertical offsets from table centre, ×ch. bidY = bid box · contractY = play-phase encart. */
  hud:       { bidY: number; contractY: number }
  /** Tap-to-confirm. cardY = lift height ×ch · scale · boxY ×ch · boxGap ×cw · boxSize px. */
  confirm:   { cardY: number; scale: number; boxY: number; boxGap: number; boxSize: number }
}

export type PresetName = 'desktop' | 'portrait'

export const LAYOUT_PRESETS: Record<PresetName, LayoutPreset> = {
  desktop: {
    page:    { margin: 0.098, maxAspect: 1.4 },
    cardScale: 1.15,
    south:   { bottom: 0.30, step: 0.59, arc: 90, fan: 22, scale: 1.0 },
    north:   { top: 0.43, step: 0.45, scale: 1.0 },
    side:    { edge: 0.44, step: 0.45, vshift: 0.0, scale: 0.95 },
    pli:     { spread: 0.78, rot: 6, messageY: 0.95 },
    plate:   { southY: 1.10, northY: 1.16, sideGap: 0.40, sideY: 0.0 },
    hud:     { bidY: 0.0, contractY: 1.3},
    confirm: { cardY: 0.90, scale: 1.30, boxY: 1.89, boxGap: 0.40, boxSize: 58 },
  },
  portrait: {
    page:    { margin: 0.06, maxAspect: 1.4 },
    cardScale: 1.2,
    south:   { bottom: 1.0, step: 0.5, arc: 80, fan: 22, scale: 1.1 },
    north:   { top: -0.45, step: 0.24, scale: 0.9 },
    side:    { edge: -0.5, step: 0.4, vshift: 0.0, scale: 0.9 },
    pli:     { spread: 0.62, rot: 6, messageY: 0.92 },
    plate:   { southY: 1.9, northY: 0.55, sideGap: 0.45, sideY: 0.0 },
    hud:     { bidY: 0.0, contractY: 1.2 },
    confirm: { cardY: -0.10, scale: 1.35, boxY: 1.30, boxGap: 1.20, boxSize: 60 },
  },
}

// ── Pli (current trick) geometry ──────────────────────────────────────
export const PLI = {
  /** South/north trick cards sit this fraction of a card height below/above centre. */
  verticalOffsetFactor: 0.46,
}

// ── GSAP animation timings & easings ──────────────────────────────────
export const ANIMATION = {
  /** Generic card move: deal snap-to-place, hand re-fan, fly-to-pli. */
  cardMove: { duration: 0.34, ease: 'power3.out' },
  /** Deck deal (tuned in proto/deal-anim.html): every card starts stacked on a
   *  central deck, then flies one-by-one to its slot. Cards are dealt index-major /
   *  seat-minor so the four hands fill in parallel. A single deck shadow stands in
   *  for the 32 stacked card shadows (per-card shadow returns at liftoff).
   *    deckScale — size of the deck stack (≈ opponent-card scale, the side preset).
   *    deckOffsetY — deck position ×ch below table centre (0 = dead centre).
   *    fromRotation — rotation of a card while still on the deck.
   *    perCardDuration / ease — each card's individual flight.
   *    stagger — delay (s) between consecutive cards leaving the deck. */
  deal: { deckScale: 0.95, fromRotation: 0, deckOffsetY: 0, perCardDuration: 0.8, stagger: 0.09, ease: 'back.out(1.3)' },
  /** South cards only: face-down on the deck, flip to face-up mid-flight (scaleX
   *  squish + face swap at the pinch). start = fraction of the flight when the flip
   *  begins; duration = total flip seconds. */
  flip: { start: 0.2, duration: 0.45, ease: 'power2.inOut' },
  /** "Annonces" banner shown after the deal, before interactions unlock. Slides in
   *  from the right to centre, holds, slides out to the left.
   *    enterFrom / exitTo — start/end x offsets as a fraction of innerWidth
   *    (positive = right, negative = left). pause* in seconds. */
  annonce: { pauseBefore: 0.3, enterFrom: 0.8, enterDuration: 1.35, enterEase: 'expo.out',
             hold: 0.1, exitTo: -0.8, exitDuration: 0.8, exitEase: 'power2.in', pauseAfter: 0.25 },
  /** Trick sweep toward the winner's plate. */
  sweep: { duration: 0.45, ease: 'power2.in', stagger: 0.05, toScale: 0.35 },
  /** Pause after a trick completes before it sweeps away (ms). */
  trickSweepDelayMs: 750,
}

// ── SVG card colours ──────────────────────────────────────────────────
export const CARD_COLORS = {
  /** Face. */
  faceFill: '#fbfbf2',
  faceStroke: 'rgba(0,0,0,.28)',
  redSuit: '#c0392b',
  blackSuit: '#1c1c1c',
  /** Back (face-down). */
  backFill: '#3a6ea5',
  backStroke: '#fbfbf2',
  backInner: '#5b8fc4',
}

/** Gold stroke for a playable card's frame. Applied in CSS (.g-card.valid svg .frame) —
 *  kept here so the colour reference lives alongside the others; mirror both if you change it. */
export const VALID_FRAME = '#daa520'
