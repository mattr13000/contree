import { randomUUID } from 'crypto'
import type { Player, Room, GameState, Session, RoomListItem, RoomPayload } from '../shared/types.js'

export const players  = new Map<string, Player>()
export const rooms    = new Map<string, Room>()
export const games    = new Map<string, GameState>()
export const sessions = new Map<string, Session>()

// ── Bot bookkeeping ─────────────────────────────────────────────────
/** One pending bot-move timer per room (cleared/reset on every reschedule). */
export const botTimers     = new Map<string, ReturnType<typeof setTimeout>>()
/** "Table is animating a transition until this ts" — paces bots past UI animations. */
export const roomBusyUntil = new Map<string, number>()

// ── Turn-timer bookkeeping ──────────────────────────────────────────
/** One pending auto-act timer per room for the current HUMAN actor. `actorId` is
 *  the seat it was armed for, so a no-op re-emit (e.g. another player reconnecting)
 *  can keep the running countdown instead of resetting it. */
export const turnTimers = new Map<string, { actorId: string; deadline: number; timer: ReturnType<typeof setTimeout> }>()

/** Cancel + forget a room's pending turn timer (no-op if none). */
export function clearTurnTimer(roomId: string): void {
  const t = turnTimers.get(roomId)
  if (t) clearTimeout(t.timer)
  turnTimers.delete(roomId)
}

/** Virtual (server-driven) players carry a `bot:` id prefix — no real socket. */
export function isBot(id: string): boolean { return id.startsWith('bot:') }

export function generateId(): string { return randomUUID() }

export function migrateSocketId(oldId: string, newId: string): void {
  const player = players.get(oldId)
  if (!player) return
  player.id = newId
  players.delete(oldId)
  players.set(newId, player)

  if (!player.roomId) return
  const room = rooms.get(player.roomId)
  if (room) {
    room.players = room.players.map(id => id === oldId ? newId : id)
    if (room.creatorId === oldId) room.creatorId = newId
  }
  const game = games.get(player.roomId)
  if (game) {
    game.seats = game.seats.map(s => s.socketId === oldId ? { ...s, socketId: newId } : s)
    if (game.hands[oldId]) {
      game.hands[newId] = game.hands[oldId]
      delete game.hands[oldId]
    }
    if (game.trickState) {
      game.trickState.trick = game.trickState.trick.map(c =>
        c.socketId === oldId ? { ...c, socketId: newId } : c
      )
    }
  }
}

export function getRoomList(): RoomListItem[] {
  return [...rooms.values()]
    .filter(r => r.players.length < 4)
    .map(r => ({ id: r.id, name: r.name, playerCount: r.players.length }))
}

export function roomPayload(room: Room): RoomPayload {
  return {
    id:        room.id,
    name:      room.name,
    creatorId: room.creatorId,
    players:   room.players.map(id => ({
      id,
      nickname: players.get(id)?.nickname ?? '?'
    }))
  }
}
