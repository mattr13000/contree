// ── Layout & geometry ─────────────────────────────────────────────────
// Viewport → preset + card size, the inner playfield, and where every card /
// plate / pli card sits. Pure geometry: returns numbers, touches no DOM.
// All tunable values live in uiConfig.ts.

import {
  CARD_BASE_WIDTH, CARD_BASE_HEIGHT, VIEWPORT, LAYOUT_PRESETS, PLI,
} from './uiConfig.js'
import type { LayoutPreset, PresetName } from './uiConfig.js'
import type { Position } from '../../../shared/types.js'

const pickPreset = (): PresetName =>
  Math.min(window.innerWidth, window.innerHeight) < VIEWPORT.portraitBreakpoint ? 'portrait' : 'desktop'

// Active preset + current card size in px (recomputed by computeScale). Exported
// as `let` so other modules see the live values after each computeScale().
export let cfg: LayoutPreset = LAYOUT_PRESETS.desktop
export let presetName: PresetName = 'desktop'   // which preset cfg currently points at
export let cardW = CARD_BASE_WIDTH    // current card width  in px (scaled per viewport + preset)
export let cardH = CARD_BASE_HEIGHT   // current card height in px

export function computeScale(): void {
  presetName = pickPreset()
  cfg = LAYOUT_PRESETS[presetName]
  const minSide = Math.min(window.innerWidth, window.innerHeight)
  const viewportScale = Math.max(VIEWPORT.minScale, Math.min(VIEWPORT.maxScale, minSide / VIEWPORT.referenceSide))
  cardW = Math.round(CARD_BASE_WIDTH * viewportScale * cfg.cardScale)
  cardH = Math.round(CARD_BASE_HEIGHT * viewportScale * cfg.cardScale)
}

// Inner playfield, inset by margin and width-capped on wide screens.
interface Playfield { centerX: number; centerY: number; halfW: number; halfH: number }
export function playfield(): Playfield {
  const winW = window.innerWidth, winH = window.innerHeight
  const margin = cfg.page.margin * Math.min(winW, winH)
  const halfH = winH / 2 - margin
  let halfW = winW / 2 - margin
  const widthCap = halfH * cfg.page.maxAspect
  if (halfW > widthCap) halfW = widthCap
  return { centerX: winW / 2, centerY: winH / 2, halfW, halfH }
}

// One placement per card: [x, y, rotationDeg, scale], centred on the card.
export type Placement = [number, number, number, number]

export function layoutHand(pos: Position, count: number): Placement[] {
  const area = playfield(), placements: Placement[] = []
  if (pos === 'south') {
    const baseY = area.centerY + area.halfH - cardH * cfg.south.bottom, step = cardW * cfg.south.step
    for (let i = 0; i < count; i++) {
      const rel = count > 1 ? i / (count - 1) - 0.5 : 0
      placements.push([area.centerX + rel * step * (count - 1), baseY + rel * rel * cfg.south.arc, rel * cfg.south.fan, cfg.south.scale])
    }
  } else if (pos === 'north') {
    const step = cardW * cfg.north.step, topY = area.centerY - area.halfH + cardH * cfg.north.top
    for (let i = 0; i < count; i++) {
      const rel = count > 1 ? i / (count - 1) - 0.5 : 0
      placements.push([area.centerX + rel * step * (count - 1), topY, 180, cfg.north.scale])
    }
  } else {
    const x = pos === 'west' ? area.centerX - area.halfW + cardH * cfg.side.edge : area.centerX + area.halfW - cardH * cfg.side.edge
    const step = cardW * cfg.side.step, rot = pos === 'west' ? 90 : -90, cy = area.centerY + cfg.side.vshift * 2 * area.halfH
    for (let i = 0; i < count; i++) {
      const rel = count > 1 ? i / (count - 1) - 0.5 : 0
      placements.push([x, cy + rel * step * (count - 1), rot, cfg.side.scale])
    }
  }
  return placements
}

export const platePos: Record<Position, () => [number, number]> = {
  south: () => { const a = playfield(); return [a.centerX, a.centerY + a.halfH - cardH * cfg.plate.southY] },
  north: () => { const a = playfield(); return [a.centerX, a.centerY - a.halfH + cardH * cfg.plate.northY] },
  west:  () => { const a = playfield(), handX = a.centerX - a.halfW + cardH * cfg.side.edge, cy = a.centerY + cfg.side.vshift * 2 * a.halfH
                 return [handX + cardH * cfg.side.scale * 0.5 + cardW * cfg.plate.sideGap, cy + cardW * cfg.plate.sideY] },
  east:  () => { const a = playfield(), handX = a.centerX + a.halfW - cardH * cfg.side.edge, cy = a.centerY + cfg.side.vshift * 2 * a.halfH
                 return [handX - cardH * cfg.side.scale * 0.5 - cardW * cfg.plate.sideGap, cy + cardW * cfg.plate.sideY] },
}

// Where a card played by `from` lands in the pli (offset from table centre).
export function pliOffset(from: Position): [number, number] {
  const v = cardH * PLI.verticalOffsetFactor
  const offsets: Record<Position, [number, number]> = {
    south: [0, v], north: [0, -v],
    west:  [-cardW * cfg.pli.spread, 0], east: [cardW * cfg.pli.spread, 0],
  }
  return offsets[from]
}
