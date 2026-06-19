import { byId } from '../core/dom.js'
import { socket } from '../core/socket.js'
import {
  startMusic,
  getMusicVolume, setMusicVolume,
  getSfxVolume, setSfxVolume,
} from '../audio/soundManager.js'
import { getConfirmPlay, setConfirmPlay, getShowNames, setShowNames } from '../core/settings.js'
import { render } from '../game/index.js'

/** Bottom-right gear → settings menu: music/SFX volume (10% steps), the
 *  tap-to-confirm toggle, and an in-game surrender. Also kicks off the music
 *  on the first user gesture (autoplay needs one). */
export function initSettingsMenu(): void {
  const gearBtn    = byId<HTMLButtonElement>('settings-btn')
  const modal      = byId('settings-modal')
  const closeBtn   = byId<HTMLButtonElement>('settings-close')
  const surrender  = byId<HTMLButtonElement>('settings-surrender')
  const confirmBtn = byId<HTMLButtonElement>('confirm-toggle')
  const namesBtn   = byId<HTMLButtonElement>('names-toggle')

  const pct = (v: number): string => Math.round(v * 100) + '%'
  // Names default to hidden (avatars only) until the player opts in.
  const namesShown = (): boolean => getShowNames() ?? false

  function refresh(): void {
    byId('music-vol-value').textContent = pct(getMusicVolume())
    byId('sfx-vol-value').textContent   = pct(getSfxVolume())
    confirmBtn.textContent = getConfirmPlay() ? 'Activé' : 'Désactivé'
    confirmBtn.classList.toggle('off', !getConfirmPlay())
    namesBtn.textContent = namesShown() ? 'Affichés' : 'Masqués'
    namesBtn.classList.toggle('off', !namesShown())
    // Surrender only makes sense once a game is on screen.
    surrender.classList.toggle('hidden', !byId('game').classList.contains('active'))
    surrender.textContent = 'Abandonner la partie'
    surrender.classList.remove('confirming')
  }

  function open():  void { refresh(); modal.classList.remove('hidden') }
  function close(): void { modal.classList.add('hidden') }

  gearBtn.addEventListener('click', open)
  closeBtn.addEventListener('click', close)
  modal.addEventListener('click', e => { if (e.target === modal) close() })   // click backdrop to dismiss

  // Volume steppers (±10%).
  modal.querySelectorAll<HTMLButtonElement>('.vol-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = Number(btn.dataset.dir)
      if (btn.dataset.target === 'music') setMusicVolume(getMusicVolume() + dir * 0.1)
      else                                setSfxVolume(getSfxVolume() + dir * 0.1)
      refresh()
    })
  })

  confirmBtn.addEventListener('click', () => { setConfirmPlay(!getConfirmPlay()); refresh() })
  namesBtn.addEventListener('click', () => { setShowNames(!namesShown()); render(); refresh() })

  // Surrender → leave the room (two-step to avoid an accidental forfeit).
  surrender.addEventListener('click', () => {
    if (!surrender.classList.contains('confirming')) {
      surrender.classList.add('confirming')
      surrender.textContent = 'Confirmer l’abandon ?'
      return
    }
    close()
    socket.emit('room:leave')
  })

  // Autoplay is blocked until a user gesture; retry music on the first interaction.
  document.addEventListener('click',      () => startMusic(), { once: true })
  document.addEventListener('touchstart', () => startMusic(), { once: true, passive: true })
}
