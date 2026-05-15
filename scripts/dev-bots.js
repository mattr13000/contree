// Dev helper: spins up 3 bot players on the server so you only need 1 browser tab.
// Bot1 creates the room and auto-starts the game when the 4th player (you) joins.
//
// Bidding behaviour:
//   - Bot1 opens with a bid (default 80 Hearts) so you can test contree/surcontree/overbid
//   - If you contree, Bot1's ally surcontrees instead of passing
//   - All other bids: bots pass
//   - Bots auto-play their first valid card each trick
//
// Usage:
//   npm run dev:bots                  →  Bot1 opens 80 Hearts
//   npm run dev:bots -- 100 Spades   →  Bot1 opens 100 Spades
//   npm run dev:bots -- pass         →  all bots pass (redeal scenario)

import { io } from 'socket.io-client'

const SERVER = process.env.SERVER || 'http://localhost:3001'
const DELAY  = ms => new Promise(r => setTimeout(r, ms))
const JITTER = () => 500 + Math.random() * 700

// Parse CLI args: `node dev-bots.js [pass | VALUE SUIT]`
const [,, arg1, arg2] = process.argv
let openerBid = null
if (arg1 && arg1.toLowerCase() !== 'pass') {
  const value = arg1 === 'Capot' ? 'Capot' : parseInt(arg1)
  const suit  = arg2 ?? 'Hearts'
  openerBid = { value, suit }
} else if (!arg1) {
  openerBid = { value: 80, suit: 'Hearts' }
}
// openerBid === null means all-pass mode

if (openerBid) {
  console.log(`Opener bid: ${openerBid.value} ${openerBid.suit}`)
} else {
  console.log('All-pass mode')
}

function makeBot(name, index) {
  return new Promise(resolve => {
    const socket = io(SERVER, { reconnection: true })
    const bot = { socket, name, index, team: null, hasOpened: false }

    socket.on('connect', () => socket.emit('session:restore', null))
    socket.on('session:ready', () => socket.emit('nickname:set', name))
    socket.on('nickname:ok', () => resolve(bot))

    socket.on('game:dealt', data => {
      const seat = data.seats.find(s => s.socketId === socket.id)
      bot.team = seat?.team ?? null
      bot.hasOpened = false
    })

    socket.on('bid:state', data => {
      if (data.currentBidderSocketId !== socket.id) return

      // Surcontree: we're on the bidding team and opponent just contreed
      if (data.contree === 'contree' && data.highBid?.team === bot.team) {
        console.log(`[${name}] surcontree!`)
        setTimeout(() => socket.emit('bid:surcontree'), JITTER())
        return
      }

      // Opener: Bot1 places the configured bid on its first turn, no existing bid
      if (openerBid && index === 0 && !bot.hasOpened && !data.highBid) {
        bot.hasOpened = true
        console.log(`[${name}] bid ${openerBid.value} ${openerBid.suit}`)
        setTimeout(() => socket.emit('bid:place', openerBid), JITTER())
        return
      }

      setTimeout(() => socket.emit('bid:pass'), JITTER())
    })

    socket.on('play:your-turn', data => {
      if (!data.validCards.length) return
      setTimeout(() => socket.emit('play:card', data.validCards[0]), JITTER())
    })

    socket.on('game:over', data => {
      console.log(`\n[game over] A: ${data.scores.A}  B: ${data.scores.B}\n`)
    })

    socket.on('disconnect', () => console.log(`[${name}] disconnected`))
  })
}

async function main() {
  console.log(`Connecting to ${SERVER}…`)

  const [bot0, bot1, bot2] = await Promise.all([
    makeBot('Bot1', 0),
    makeBot('Bot2', 1),
    makeBot('Bot3', 2),
  ])
  console.log('3 bots connected.')

  const roomId = await new Promise(resolve => {
    bot0.socket.once('room:joined', ({ room }) => {
      console.log(`[Bot1] created room "${room.name}"`)
      resolve(room.id)
    })
    bot0.socket.emit('room:create')
  })

  await Promise.all([bot1, bot2].map((bot, i) => new Promise(resolve => {
    bot.socket.once('room:joined', () => { console.log(`[${bot.name}] joined`); resolve() })
    bot.socket.emit('lobby:enter')
    DELAY(150 * (i + 1)).then(() => bot.socket.emit('room:join', roomId))
  })))

  console.log('\n✓ Room ready. Open http://localhost:5173, join the room → game auto-starts.\n')

  bot0.socket.on('room:updated', room => {
    if (room.players.length === 4) {
      console.log('[Bot1] 4 players — starting…')
      setTimeout(() => bot0.socket.emit('room:start'), 600)
    }
  })

  process.on('SIGINT', () => {
    console.log('\nShutting down bots.')
    ;[bot0, bot1, bot2].forEach(b => b.socket.disconnect())
    process.exit(0)
  })
}

main().catch(err => { console.error(err); process.exit(1) })
