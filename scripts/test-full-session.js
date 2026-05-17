// Full-session smoke test: plays repeated games until game:victory fires (first team to 500).
//
// Usage: node scripts/test-full-session.js
// Requires server running on localhost:3001.

import { io } from 'socket.io-client'

const SERVER  = 'http://localhost:3001'
const DELAY   = ms => new Promise(r => setTimeout(r, ms))
const PLAY_MS = 150   // ms between receiving play:your-turn and playing

let gameCount      = 0
let tricksThisGame = 0
let victoryFired   = false
let cumulativeA    = 0
let cumulativeB    = 0

function spawnBot(name, index) {
  let socket    = null
  let sessionId = null

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
    })

    sock.on('game:dealt', () => {
      if (index === 0) {
        gameCount++
        tricksThisGame = 0
        console.log(`\n── Game ${gameCount} ──────────────────────────────────`)
      }
    })

    sock.on('bid:state', data => {
      if (data.currentBidderSocketId !== sock.id) return
      // Bot1 always opens 80♥; everyone else passes
      if (index === 0 && !data.highBid) {
        setTimeout(() => sock.emit('bid:place', { value: 80, suit: 'Hearts' }), PLAY_MS)
      } else {
        setTimeout(() => sock.emit('bid:pass'), PLAY_MS)
      }
    })

    sock.on('play:your-turn', data => {
      if (!data.validCards.length) return
      setTimeout(() => sock.emit('play:card', data.validCards[0]), PLAY_MS)
    })

    sock.on('trick:won', data => {
      tricksThisGame = data.tricksPlayed
      if (index === 0) {
        process.stdout.write(`  trick ${data.tricksPlayed}/8 → ${data.winnerNickname}\n`)
      }
    })

    sock.on('game:over', data => {
      if (index === 0) {
        console.log(`  game:over  A:${data.scores.A}  B:${data.scores.B}`)
        console.log(`  (cumulative tracked by server; waiting for redeal or victory…)`)
      }
    })

    sock.on('game:victory', data => {
      if (index === 0) {
        victoryFired   = true
        cumulativeA    = data.cumulativeScores.A
        cumulativeB    = data.cumulativeScores.B
      }
    })
  }

  return new Promise(resolve => {
    const sock = io(SERVER, { reconnection: false })
    sock.on('nickname:ok', () => resolve(bot))
    attach(sock)
  })
}

async function main() {
  console.log(`Connecting to ${SERVER}…`)
  const [b0, b1, b2, b3] = await Promise.all([
    spawnBot('TestBot1', 0),
    spawnBot('TestBot2', 1),
    spawnBot('TestBot3', 2),
    spawnBot('TestBot4', 3),
  ])
  console.log('4 bots connected.\n')

  const roomId = await new Promise(resolve => {
    b0.socket.once('room:joined', ({ room }) => {
      console.log(`Room created: "${room.name}"`)
      resolve(room.id)
    })
    b0.emit('room:create')
  })

  for (const bot of [b1, b2, b3]) {
    await new Promise(resolve => {
      bot.socket.once('room:joined', () => { console.log(`  [${bot.name}] joined`); resolve() })
      bot.emit('lobby:enter')
      setTimeout(() => bot.emit('room:join', roomId), 100)
    })
    await DELAY(50)
  }

  console.log('\nStarting first game…')
  await DELAY(100)
  b0.emit('room:start')

  // Wait for game:victory (max 10 minutes — safety net)
  const deadline = Date.now() + 10 * 60_000
  while (!victoryFired && Date.now() < deadline) {
    await DELAY(500)
  }

  console.log('\n══ Final results ══════════════════════════════════')
  if (!victoryFired) {
    console.log(`FAIL  game:victory never fired after ${gameCount} games (stalled or crashed)`)
    process.exit(1)
  }
  console.log(`PASS  game:victory after ${gameCount} game(s)`)
  console.log(`      Cumulative A: ${cumulativeA}  B: ${cumulativeB}`)
  const winner = cumulativeA >= cumulativeB ? 'Team A' : 'Team B'
  console.log(`      Winner: ${winner}`)
  process.exit(0)
}

main().catch(err => { console.error('Uncaught:', err); process.exit(1) })
