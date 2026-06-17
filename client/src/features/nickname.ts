import { byId } from '../dom.js'
import { showScreen } from '../router.js'
import { socket } from '../socket.js'
import { startMusic } from '../soundManager.js'

/** Nickname entry screen → lobby. */
export function initNickname(): void {
  const inputNickname = byId<HTMLInputElement>('input-nickname')
  const btnEnter      = byId<HTMLButtonElement>('btn-enter')

  function submitNickname(): void {
    const nick = inputNickname.value.trim()
    if (nick) { startMusic(); socket.emit('nickname:set', nick) }
  }

  btnEnter.addEventListener('click', submitNickname)
  inputNickname.addEventListener('keydown', e => { if (e.key === 'Enter') submitNickname() })

  socket.on('nickname:ok', nick => {
    byId('lobby-greeting').textContent = `Bonjour, ${nick} !`
    showScreen('screen-lobby')
  })
}
