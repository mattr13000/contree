const sounds = {
  hover: new Audio('/assets/card-hover.mp3'),
  play:  new Audio('/assets/card-play.mp3'),
}

sounds.hover.volume = 0.4
sounds.play.volume  = 0.5

let muted = false

export function toggleMute(): boolean {
  muted = !muted
  return muted
}

export function soundHover(): void {
  if (muted) return
  sounds.hover.currentTime = 0
  sounds.hover.play().catch(() => {})
}

export function soundPlay(): void {
  if (muted) return
  sounds.play.currentTime = 0
  sounds.play.play().catch(() => {})
}

// ── Background music ──────────────────────────────────────────────
const music = new Audio('/assets/game-music.mp3')
const MUSIC_TARGET = 0.1
music.loop   = true
music.volume = 0

let musicMuted   = false
let musicStarted = false

export function startMusic(): void {
  if (musicStarted) return
  music.play().then(() => {
    musicStarted = true
    const duration = 2000
    const steps    = 60
    const interval = duration / steps
    let   step     = 0
    const timer = setInterval(() => {
      step++
      music.volume = Math.min(MUSIC_TARGET, MUSIC_TARGET * (step / steps))
      if (step >= steps) clearInterval(timer)
    }, interval)
  }).catch(() => {})
}

export function toggleMusicMute(): boolean {
  musicMuted   = !musicMuted
  music.muted  = musicMuted
  return musicMuted
}
