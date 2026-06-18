import { byId } from '../dom.js'
import { showScreen } from '../router.js'
import { socket } from '../socket.js'
import { startMusic } from '../soundManager.js'
import { initGame, applyDealt, applyBidState, applyPlayState, runAfterDeal } from '../game.js'
import { applyBidUIState } from '../bid-ui.js'
import { renderWaiting } from './waiting.js'
import { getMyTeam, setMyTeam } from '../clientState.js'

/** Session persistence: restore on (re)connect and jump to the right screen. */
export function initSession(): void {
  socket.on('connect', () => {
    socket.emit('session:restore', sessionStorage.getItem('sessionId') || null)
  })

  socket.on('session:ready', ({ sessionId, restored }) => {
    sessionStorage.setItem('sessionId', sessionId)
    if (!restored) return

    startMusic()

    if (restored.state === 'lobby') {
      byId('lobby-greeting').textContent = `Bonjour, ${restored.nickname} !`
      showScreen('screen-lobby')
    } else if (restored.state === 'waiting') {
      renderWaiting(restored.room, restored.isCreator)
      showScreen('screen-waiting')
    } else if (restored.state === 'game') {
      setMyTeam(restored.dealt.seats.find(s => s.socketId === socket.id)?.team ?? null)
      showScreen('game')
      initGame(byId<HTMLDivElement>('game'), socket.id).then(() => {
        applyDealt(restored.dealt)
        if (restored.bidState) {
          applyBidState(restored.bidState)
          runAfterDeal(() => applyBidUIState(restored.bidState!, socket.id!, getMyTeam()))
        } else if (restored.playState) {
          applyPlayState(restored.playState)
        }
      })
    }
  })
}
