import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import { players } from './state.js'
import { init as initGame } from './game.js'
import { initBots } from './bot.js'
import { registerSessionHandlers } from './handlers/session.js'
import { registerRoomHandlers } from './handlers/room.js'
import { registerBiddingHandlers } from './handlers/bidding.js'
import { registerPlayHandlers } from './handlers/play.js'
import type { AppServer } from './io-types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app        = express()
const httpServer = createServer(app)
const isDev      = process.env.NODE_ENV !== 'production'

const io: AppServer = new Server(httpServer, isDev ? { cors: { origin: '*' } } : {})
initGame(io)
initBots()   // registers the bot turn hook on game.ts

if (!isDev) {
  app.use(express.static(join(__dirname, '../dist')))
  app.get('*', (_req, res) => res.sendFile(join(__dirname, '../dist/index.html')))
}

io.on('connection', socket => {
  console.log('+ connected   :', socket.id)
  players.set(socket.id, { id: socket.id, nickname: null, roomId: null, sessionId: null })

  registerSessionHandlers(io, socket)
  registerRoomHandlers(io, socket)
  registerBiddingHandlers(io, socket)
  registerPlayHandlers(io, socket)
})

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => console.log(`server on :${PORT}`))
