import { randomUUID } from 'crypto'

export const players  = new Map()
export const rooms    = new Map()
export const games    = new Map()
export const sessions = new Map()

export function generateId() { return randomUUID() }

export function migrateSocketId(oldId, newId) {
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

export function getRoomList() {
  return [...rooms.values()]
    .filter(r => r.players.length < 4)
    .map(r => ({ id: r.id, name: r.name, playerCount: r.players.length }))
}

export function roomPayload(room) {
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
