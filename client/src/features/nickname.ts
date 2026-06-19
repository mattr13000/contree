import { byId } from '../core/dom.js'
import { showScreen } from '../core/router.js'
import { socket } from '../core/socket.js'
import { startMusic } from '../audio/soundManager.js'

/** Nickname: 3-12 chars, alphanumeric only. */
const NICKNAME_RE = /^[a-zA-Z0-9]{3,12}$/

/** Nickname entry screen → lobby. */
export function initNickname(): void {
  const inputNickname = byId<HTMLInputElement>('input-nickname')
  const btnEnter      = byId<HTMLButtonElement>('btn-enter')
  const errorEl       = byId('nickname-error')

  function submitNickname(): void {
    const nick = inputNickname.value.trim()
    if (!NICKNAME_RE.test(nick)) {
      errorEl.textContent = '3 à 12 caractères, lettres et chiffres uniquement.'
      return
    }
    errorEl.textContent = ''
    startMusic()
    socket.emit('nickname:set', nick)
  }

  btnEnter.addEventListener('click', submitNickname)
  inputNickname.addEventListener('keydown', e => { if (e.key === 'Enter') submitNickname() })
  inputNickname.addEventListener('input', () => { errorEl.textContent = '' })

  socket.on('nickname:ok', nick => {
    byId('lobby-greeting').textContent = `Bonjour, ${nick} !`
    showScreen('screen-lobby')
  })
}
