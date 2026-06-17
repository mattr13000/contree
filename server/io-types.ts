import type { Server, Socket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types.js'

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents>
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>
