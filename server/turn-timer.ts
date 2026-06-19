// Server-authoritative per-turn countdown for HUMAN seats. A sibling of the bot
// driver (bot.ts): both subscribe to game.ts's turn hook and react to the current
// actor. Where the bot driver auto-acts fast, this arms a long fixed deadline for a
// human seat and, on expiry, acts for them — PASS while bidding, a random valid
// card while playing — so a slow/AFK player can never stall the table.
//
// The visible countdown is sent to clients as a *relative* remaining time (not an
// absolute deadline) so it runs on each client's own clock with no skew.
import { games, players, sessions, turnTimers, roomBusyUntil, isBot, clearTurnTimer } from './state.js'
import { addTurnHook, currentActorId, applyPass, applyPlay } from './game.js'
import { getValidCards } from './rules.js'
import { TURN_TIMEOUT_MS } from '../shared/constants.js'
import type { AppServer } from './io-types.js'
import type { Phase } from '../shared/types.js'

let io!: AppServer
export function init(_io: AppServer): void { io = _io }

/** Register the turn hook so game.ts drives us. Called once at startup. */
export function initTurnTimer(): void {
  addTurnHook(scheduleTurnTimeout)
}

/** True while `actorId`'s session is mid-disconnect (20s grace timer pending). */
function actorDisconnected(actorId: string): boolean {
  const sessionId = players.get(actorId)?.sessionId
  if (!sessionId) return false
  const sess = sessions.get(sessionId)
  return !!sess && sess.timer !== null
}

/** Arm (or keep) the auto-act countdown for the room's current actor. Idempotent:
 *  if a timer is already running for the same seat it is preserved, so a no-op
 *  re-emit (e.g. another player reconnecting) never resets a live countdown. */
export function scheduleTurnTimeout(roomId: string): void {
  const game = games.get(roomId)
  if (!game) return

  const actorId = currentActorId(game)
  // No active turn, a bot's turn, or the actor is mid-disconnect → no human countdown.
  if (!actorId || isBot(actorId) || actorDisconnected(actorId)) {
    clearTurnTimer(roomId)
    game.turnDeadline = null
    io.to(roomId).emit('turn:timer', null)
    return
  }

  const existing = turnTimers.get(roomId)
  if (existing && existing.actorId === actorId && existing.deadline > Date.now()) return  // already running for this seat

  clearTurnTimer(roomId)
  const phaseAtArm = game.phase
  // Start counting AFTER the table's busy lock (deal / play-start animations) so the
  // clock never bleeds into the deck cascade.
  const start    = Math.max(Date.now(), roomBusyUntil.get(roomId) ?? 0)
  const deadline = start + TURN_TIMEOUT_MS
  game.turnDeadline = deadline
  const timer = setTimeout(() => onExpire(roomId, actorId, phaseAtArm), deadline - Date.now())
  turnTimers.set(roomId, { actorId, deadline, timer })

  io.to(roomId).emit('turn:timer', { remainingMs: deadline - Date.now(), durationMs: TURN_TIMEOUT_MS })
}

function onExpire(roomId: string, actorId: string, phaseAtArm: Phase): void {
  turnTimers.delete(roomId)   // it fired
  const game = games.get(roomId)
  // Re-validate — the world can change during the 20s (turn advanced, game restarted,
  // player reconnected under a new id, or left). Bail unless it's still this seat's turn.
  if (!game || game.phase !== phaseAtArm) return
  if (currentActorId(game) !== actorId) return
  if (actorDisconnected(actorId)) return
  if (!players.get(actorId)) return   // seat was abandoned (left mid-game) — leave the known limitation as-is
  game.turnDeadline = null

  if (game.phase === 'bidding') {
    applyPass(roomId, actorId)   // always legal; can't stall the auction
    return
  }
  if (game.phase === 'playing' && game.trickState && game.trump) {
    const valid = getValidCards(game.hands[actorId] ?? [], game.trickState.trick, game.trump, actorId, game.seats)
    if (!valid.length) return
    const card = valid[Math.floor(Math.random() * valid.length)]
    applyPlay(roomId, actorId, { rank: card.rank, suit: card.suit })
  }
}
