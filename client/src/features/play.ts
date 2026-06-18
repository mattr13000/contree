import { socket } from '../core/socket.js'
import { setOnCardPlay, applyPlayState, applyYourTurn, applyTrickWon } from '../game/index.js'
import { flashAnnouncement } from '../ui/announcements.js'
import type { Rank, Suit } from '../../../shared/types.js'

/** Trick play: send clicked cards, apply trick state, belote announcements. */
export function initPlay(): void {
  setOnCardPlay((card: { rank: Rank; suit: Suit }) => socket.emit('play:card', card))

  socket.on('play:state',     data => applyPlayState(data))
  socket.on('play:your-turn', data => applyYourTurn(data))
  socket.on('trick:won',      data => applyTrickWon(data))
  socket.on('play:belote', ({ nickname, type }) => {
    const label = type === 'rebelote' ? `Rebelote ! (${nickname})` : `Belote ! (${nickname})`
    flashAnnouncement('belote-announcement', label, 2500)
  })
}
