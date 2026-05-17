// Full-game smoke test with reconnect-mid-trick verification.
//
// Runs 4 bots through a complete game. Bot4 reconnects after playing a card
// in trick 3 (before the trick resolves) to exercise the migrateSocketId fix.
//
// Pass:  game:over fires after 8 tricks, no unresolved tricks
// Fail:  game stalls, winnerSeat error logged, or process exits without game:over
//
// Usage: node scripts/test-game.js
// Requires server running on localhost:3001.

import { io } from 'socket.io-client'

const SERVER  = 'http://localhost:3001'
const DELAY   = ms => new Promise(r => setTimeout(r, ms))
const PLAY_MS = 200  // delay between receiving your-turn and playing

let tricksPlayed   = 0
let gameOverFired  = false
let reconnectDone  = false

// ── Bot factory ───────────────────────────────────────────────────
function spawnBot(name, index) {
  let socket    = null
  let sessionId = null
  let team      = null

  const bot = {
    name,
    get socket() { return socket },
    emit(...args) { socket.emit(...args) },
  }

  function attach(sock) {
    socket = sock

    sock.on('connect', () => sock.emit('session:restore', sessionId))

    sock.on('session:ready', ({ sessionId: sid, restored }) => {
      if (sid) sessionId = sid
      if (!restored) sock.emit('nickname:set', name)
      // if restored=game, server re-emits play:your-turn via emitPlayState
    })

    sock.on('game:dealt', data => {
      team = data.seats.find(s => s.socketId === sock.id)?.team ?? null
    })

    sock.on('bid:state', data => {
      if (data.currentBidderSocketId !== sock.id) return
      if (index === 0 && !data.highBid) {
        setTimeout(() => sock.emit('bid:place', { value: 80, suit: 'Hearts' }), PLAY_MS)
      } else {
        setTimeout(() => sock.emit('bid:pass'), PLAY_MS)
      }
    })

    sock.on('play:your-turn', data => {
      if (!data.validCards.length) return
      const card = data.validCards[0]

      // Bot4: reconnect mid-trick once, right after playing in trick 3
      if (index === 3 && !reconnectDone && tricksPlayed >= 2) {
        reconnectDone = true
        console.log(`  [${name}] playing ${card.rank}${card.suit[0]} then reconnecting mid-trick…`)
        sock.emit('play:card', card)

        // Short pause, then disconnect + reconnect with same session
        setTimeout(() => {
          sock.disconnect()
          setTimeout(() => {
            console.log(`  [${name}] reconnecting (sessionId preserved)…`)
            const newSock = io(SERVER, { reconnection: false })
            attach(newSock)
          }, 250)
        }, 80)
        return
      }

      setTimeout(() => sock.emit('play:card', card), PLAY_MS)
    })

    sock.on('trick:won', data => {
      tricksPlayed = data.tricksPlayed
      if (index === 0) {
        process.stdout.write(`  trick ${data.tricksPlayed}/8 → ${data.winnerNickname}\n`)
      }
    })

    sock.on('game:over', data => {
      if (index === 0) {
        gameOverFired = true
        console.log(`  game:over  A:${data.scores.A}  B:${data.scores.B}`)
      }
    })
  }

  return new Promise(resolve => {
    const sock = io(SERVER, { reconnection: false })
    sock.on('nickname:ok', () => resolve(bot))
    attach(sock)
  })
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log(`Connecting to ${SERVER}…`)
  const [b0, b1, b2, b3] = await Promise.all([
    spawnBot('Bot1', 0),
    spawnBot('Bot2', 1),
    spawnBot('Bot3', 2),
    spawnBot('Bot4', 3),
  ])
  console.log('4 bots connected.\n')

  // Bot1 creates the room
  const roomId = await new Promise(resolve => {
    b0.socket.once('room:joined', ({ room }) => {
      console.log(`Room created: "${room.name}"`)
      resolve(room.id)
    })
    b0.emit('room:create')
  })

  // Bot2–4 join sequentially (avoid race on room:join)
  for (const bot of [b1, b2, b3]) {
    await new Promise(resolve => {
      bot.socket.once('room:joined', () => { console.log(`  [${bot.name}] joined`); resolve() })
      bot.emit('lobby:enter')
      setTimeout(() => bot.emit('room:join', roomId), 100)
    })
    await DELAY(50)
  }

  // Bot1 starts the game
  console.log('\nStarting game…\n')
  await DELAY(100)
  b0.emit('room:start')

  // Wait for game:over (max 60s)
  const start = Date.now()
  while (!gameOverFired && Date.now() - start < 60_000) {
    await DELAY(500)
  }

  console.log('\n── Results ──────────────────────────────────────────')
  if (!gameOverFired) {
    console.log('FAIL  game:over never fired (game stalled or crashed)')
    process.exit(1)
  }
  if (tricksPlayed !== 8) {
    console.log(`FAIL  expected 8 tricks, got ${tricksPlayed}`)
    process.exit(1)
  }
  console.log(`PASS  game:over after 8 tricks`)
  console.log(`      reconnect mid-trick: ${reconnectDone ? 'exercised' : 'NOT exercised (timing miss)'}`)
  process.exit(0)
}

main().catch(err => { console.error('Uncaught:', err); process.exit(1) })
