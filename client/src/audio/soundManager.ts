// ── Sound + music manager ─────────────────────────────────────────────
// SFX (hover/play) and looping background music, each with a 0–100% volume
// (10% steps) persisted in localStorage so refresh (F5) keeps the setting.
// Music autoplay is gated behind a user gesture; startMusic() self-re-arms a
// one-shot gesture retry if the browser blocks it, and raising the volume from
// 0 resumes playback — so muting (0%) never kills the music permanently.

const STORE_KEY = 'contree-audio'

const SFX_DEFAULT   = 0.5
const MUSIC_DEFAULT = 0.5          // fraction; element volume = fraction * MUSIC_MAX
const MUSIC_MAX     = 0.2          // 100% music → element volume 0.2 (default 50% ≈ the old 0.1)

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
const round1  = (v: number): number => Math.round(clamp01(v) * 10) / 10   // snap to 10% steps

let sfxVol   = SFX_DEFAULT
let musicVol = MUSIC_DEFAULT

;(function load(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as { sfx?: number; music?: number }
      if (typeof p.sfx   === 'number') sfxVol   = round1(p.sfx)
      if (typeof p.music === 'number') musicVol = round1(p.music)
    }
  } catch { /* ignore corrupt storage */ }
})()

function save(): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ sfx: sfxVol, music: musicVol })) } catch { /* ignore */ }
}

// ── SFX ───────────────────────────────────────────────────────────────
const sounds = {
  hover: new Audio('/assets/card-hover.mp3'),
  play:  new Audio('/assets/card-play.mp3'),
}

export function soundHover(): void {
  if (sfxVol <= 0) return
  sounds.hover.volume = clamp01(sfxVol * 0.8)
  sounds.hover.currentTime = 0
  sounds.hover.play().catch(() => {})
}
export function soundPlay(): void {
  if (sfxVol <= 0) return
  sounds.play.volume = sfxVol
  sounds.play.currentTime = 0
  sounds.play.play().catch(() => {})
}

export function getSfxVolume(): number { return sfxVol }
export function setSfxVolume(v: number): void { sfxVol = round1(v); save() }

// ── Background music ──────────────────────────────────────────────────
const music = new Audio('/assets/game-music.mp3')
music.loop   = true
music.volume = 0

let musicStarted = false             // has begun playing at least once (→ fade in only the first time)
let fadeTimer: number | null = null

function applyMusicVolume(fade: boolean): void {
  if (fadeTimer !== null) { clearInterval(fadeTimer); fadeTimer = null }
  const target = musicVol * MUSIC_MAX
  if (!fade) { music.volume = target; return }
  const from = music.volume, steps = 30, dur = 1500
  let i = 0
  fadeTimer = window.setInterval(() => {
    i++
    music.volume = from + (target - from) * (i / steps)
    if (i >= steps) { music.volume = target; clearInterval(fadeTimer!); fadeTimer = null }
  }, dur / steps)
}

function armGestureRetry(): void {
  const retry = (): void => startMusic()
  document.addEventListener('click',      retry, { once: true })
  document.addEventListener('touchstart', retry, { once: true, passive: true })
}

/** Begin (or resume) the music if it should be audible. Safe to call repeatedly. */
export function startMusic(): void {
  if (musicVol <= 0) return          // nothing to play while muted
  if (!music.paused) return          // already playing
  music.play().then(() => {
    const firstTime = !musicStarted
    musicStarted = true
    applyMusicVolume(firstTime)      // gentle fade-in on the very first start, snap otherwise
  }).catch(() => {
    armGestureRetry()                // autoplay blocked → retry on the next user gesture
  })
}

export function getMusicVolume(): number { return musicVol }
export function setMusicVolume(v: number): void {
  musicVol = round1(v)
  save()
  if (musicVol > 0) { applyMusicVolume(false); startMusic() }
  else applyMusicVolume(false)       // → 0 (stays "playing" silently so unmuting resumes instantly)
}
