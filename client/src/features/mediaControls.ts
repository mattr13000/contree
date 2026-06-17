import { byId } from '../dom.js'
import { toggleMute, toggleMusicMute, startMusic } from '../soundManager.js'

/** Bottom-right mute/music buttons + first-gesture music autostart. */
export function initMediaControls(): void {
  const muteBtn  = byId<HTMLButtonElement>('mute-btn')
  const musicBtn = byId<HTMLButtonElement>('music-btn')

  muteBtn.addEventListener('click', () => {
    const muted = toggleMute()
    muteBtn.textContent = muted ? '🔇' : '🔊'
  })
  musicBtn.addEventListener('click', () => {
    const muted = toggleMusicMute()
    musicBtn.classList.toggle('muted', muted)
  })

  // Autoplay is blocked until a user gesture; retry music on the first interaction.
  document.addEventListener('click',      () => startMusic(), { once: true })
  document.addEventListener('touchstart', () => startMusic(), { once: true, passive: true })
}
