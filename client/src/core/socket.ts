import { io, type Socket } from 'socket.io-client'
import type { ServerToClientEvents, ClientToServerEvents } from '../../shared/types.js'

/** The single typed Socket.io client, shared by every feature module. */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io()
