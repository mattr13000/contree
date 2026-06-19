import { players, rooms, games, generateId, getRoomList, roomPayload } from '../state.js'
import { pushRoomList, leaveRoom, deal } from '../game.js'
import { makeBots } from '../bot.js'
import type { Room } from '../../shared/types.js'
import type { AppServer, AppSocket } from '../io-types.js'

const NICKNAME_RE  = /^[a-zA-Z0-9]{3,12}$/
const PLAYER_COUNT = 4

let roomCounter = 0

/** nickname:set, lobby:enter/leave, room:create/join/leave/start. */
export function registerRoomHandlers(io: AppServer, socket: AppSocket): void {
  socket.on('nickname:set', raw => {
    const nickname = String(raw).trim()
    if (!NICKNAME_RE.test(nickname)) return
    players.get(socket.id)!.nickname = nickname
    socket.emit('nickname:ok', nickname)
  })

  socket.on('lobby:enter', () => {
    socket.join('lobby')
    socket.emit('rooms:list', getRoomList())
  })

  socket.on('lobby:leave', () => socket.leave('lobby'))

  socket.on('room:create', () => {
    const player = players.get(socket.id)
    if (!player?.nickname || player.roomId) return

    roomCounter++
    const room: Room = {
      id:        generateId(),
      name:      `Salle #${roomCounter}`,
      players:   [socket.id],
      creatorId: socket.id,
    }
    rooms.set(room.id, room)
    player.roomId = room.id
    socket.leave('lobby')
    socket.join(room.id)

    socket.emit('room:joined', { room: roomPayload(room), isCreator: true })
    pushRoomList()
  })

  socket.on('room:create-solo', () => {
    const player = players.get(socket.id)
    if (!player?.nickname || player.roomId) return

    roomCounter++
    const room: Room = {
      id:        generateId(),
      name:      `Solo de ${player.nickname}`,
      players:   [socket.id],
      creatorId: socket.id,
    }
    const botIds = makeBots(PLAYER_COUNT - 1, player.nickname)
    room.players.push(...botIds)
    rooms.set(room.id, room)

    player.roomId = room.id
    botIds.forEach(id => { const b = players.get(id); if (b) b.roomId = room.id })

    socket.leave('lobby')
    socket.join(room.id)

    // No waiting screen: deal() emits game:dealt, which jumps the client to the table.
    deal(room)
  })

  socket.on('room:join', roomId => {
    const player = players.get(socket.id)
    if (!player?.nickname || player.roomId) return

    const room = rooms.get(roomId)
    if (!room || room.players.length >= PLAYER_COUNT) {
      socket.emit('room:error', 'Cette salle est pleine ou introuvable')
      return
    }

    room.players.push(socket.id)
    player.roomId = room.id
    socket.leave('lobby')
    socket.join(room.id)

    socket.emit('room:joined', { room: roomPayload(room), isCreator: false })
    io.to(room.id).emit('room:updated', roomPayload(room))
    pushRoomList()
  })

  socket.on('room:leave', () => {
    const roomId = players.get(socket.id)?.roomId
    leaveRoom(socket.id)
    if (roomId) socket.leave(roomId)
    socket.emit('room:left')
  })

  socket.on('room:start', () => {
    const player = players.get(socket.id)
    if (!player?.roomId) return
    const room = rooms.get(player.roomId)
    if (!room || room.creatorId !== socket.id || room.players.length !== PLAYER_COUNT) return
    if (games.get(player.roomId)) return
    deal(room)
  })
}
