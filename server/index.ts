import express from 'express'
import helmet from 'helmet'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import { players } from './state.js'
import { init as initGame } from './game.js'
import { initBots } from './bot.js'
import { init as initTurnTimerIo, initTurnTimer } from './turn-timer.js'
import { registerSessionHandlers } from './handlers/session.js'
import { registerRoomHandlers } from './handlers/room.js'
import { registerBiddingHandlers } from './handlers/bidding.js'
import { registerPlayHandlers } from './handlers/play.js'
import { rateLimit } from './rate-limit.js'
import type { AppServer } from './io-types.js'

// Last-resort safety net: a throw deep in a single room's game flow (or a stray
// rejected promise) must never take the whole process down and wipe every other
// room's in-memory state. Log and keep serving. NOT a substitute for validating
// input at the handlers — just blast-radius containment.
process.on('uncaughtException',  err => console.error('uncaughtException:', err))
process.on('unhandledRejection', err => console.error('unhandledRejection:', err))

const __dirname = dirname(fileURLToPath(import.meta.url))
const app        = express()
const httpServer = createServer(app)
const isDev      = process.env.NODE_ENV !== 'production'

const io: AppServer = new Server(httpServer, isDev ? { cors: { origin: '*' } } : {})
initGame(io)
initBots()         // registers the bot turn hook on game.ts
initTurnTimerIo(io)
initTurnTimer()    // registers the human turn-timer hook on game.ts

if (!isDev) {
  // Security headers. Production-only: dev is served by Vite, and helmet's
  // upgrade-insecure-requests would break http://localhost. CSP is tuned to what
  // the client actually loads — all same-origin, plus inline style="" attributes
  // (set via innerHTML in the renderer/HUD) which need 'unsafe-inline' for styles.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src':      ["'self'"],
        'style-src':       ["'self'", "'unsafe-inline'"],
        'img-src':         ["'self'", 'data:'],
        'media-src':       ["'self'"],          // music + SFX audio
        'connect-src':     ["'self'"],          // socket.io websocket + WebAudio fetch
        'frame-ancestors': ["'none'"],          // anti-clickjacking
      },
    },
  }))
  app.use(express.static(join(__dirname, '../dist')))
  app.get('*', (_req, res) => res.sendFile(join(__dirname, '../dist/index.html')))
}

io.on('connection', socket => {
  console.log('+ connected   :', socket.id)
  players.set(socket.id, { id: socket.id, nickname: null, roomId: null, sessionId: null })

  rateLimit(socket)

  registerSessionHandlers(io, socket)
  registerRoomHandlers(io, socket)
  registerBiddingHandlers(io, socket)
  registerPlayHandlers(io, socket)
})

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => console.log(`server on :${PORT}`))
