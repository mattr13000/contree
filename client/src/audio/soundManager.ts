// ── Sound + music manager ─────────────────────────────────────────────
// SFX (hover/play) and looping background music, each with a 0–100% volume
// (10% steps) persisted in localStorage so refresh (F5) keeps the setting.
// Music autoplay is gated behind a user gesture; startMusic() self-re-arms a
// one-shot gesture retry if the browser blocks it, and raising the volume from
// 0 resumes playback — so muting (0%) never kills the music permanently.

import type { Position } from '../../../shared/types.js'

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
// Every clip is preloaded (and warmed on the first user gesture) so the first
// play doesn't fetch/decode mid-flight — that JIT decode is what clipped the
// sound. Overlapping plays (the deal cascade) round-robin a small pool of
// already-decoded voices per clip rather than spawning fresh elements.
const VOICES = 4   // preloaded instances per clip → rapid overlaps never re-decode

function makeVoices(src: string): HTMLAudioElement[] {
  return Array.from({ length: VOICES }, () => {
    const a = new Audio(src)
    a.preload = 'auto'
    a.load()
    return a
  })
}

const hoverVoices = makeVoices('/assets/card-hover.mp3')
let hoverIdx = 0

// Interchangeable "card hits the table" clips (deck deal + playing a card).
// One is chosen at random each time. The list is the single source of truth —
// add/remove files here and the picker spans whatever length it has, so the
// number of clips can change freely.
const cardPlacePool = [
  '/assets/card-place-1.ogg',
  '/assets/card-place-2.ogg',
  '/assets/card-place-3.ogg',
  '/assets/card-place-4.ogg',
].map(src => ({ voices: makeVoices(src), idx: 0 }))

export function soundHover(): void {
  if (sfxVol <= 0) return
  const a = hoverVoices[hoverIdx]
  hoverIdx = (hoverIdx + 1) % hoverVoices.length
  a.volume = clamp01(sfxVol * 0.8)
  a.currentTime = 0
  a.play().catch(() => {})
}

/** Play a random card-place clip from a preloaded, round-robined voice pool. */
export function soundCardPlace(): void {
  if (sfxVol <= 0 || cardPlacePool.length === 0) return
  const clip = cardPlacePool[Math.floor(Math.random() * cardPlacePool.length)]
  const a = clip.voices[clip.idx]
  clip.idx = (clip.idx + 1) % clip.voices.length
  a.volume = sfxVol
  a.currentTime = 0
  a.play().catch(() => {})
}

// Decode every voice once on the first interaction so the very first real play
// is instant (load() fetches; the actual decode otherwise happens on first play).
let warmed = false
function warmSfx(): void {
  if (warmed) return
  warmed = true
  const all = [...hoverVoices, ...cardPlacePool.flatMap(c => c.voices)]
  for (const a of all) {
    a.muted = true
    a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false }).catch(() => { a.muted = false })
  }
  ensureDealAudio()   // create/resume the WebAudio context on the first gesture
}
document.addEventListener('pointerdown', warmSfx, { once: true })

export function getSfxVolume(): number { return sfxVol }
export function setSfxVolume(v: number): void { sfxVol = round1(v); save() }

// ── Deal sound (WebAudio) ─────────────────────────────────────────────
// Ported from proto/deal-sound.html: one panned "slide" accent per dealt packet
// (3-2-3 belote deal) plus a soft shuffle "bed" under the whole cascade. WebAudio
// gives true stereo pan + perfect overlap; falls back to a plain <audio> element
// (no pan) if the context is unavailable. All gains are scaled by sfxVol so the
// user's SFX slider still controls them.
const DEAL = {
  clips: ['/assets/card-slide-5.ogg'],   // single source of truth; picker spans the array
  accentVol: 0.6, accentJitter: 0.18, rateMin: 0.86, rateMax: 1.18,
  panAmount: 0.7, distance: 0.5,         // pan: west L / east R; distance: north farthest
  bed: true, bedVol: 0.22, bedRate: 0.6, // bed = same clip slowed → a longer, grave whoosh
}
// Visual seat (south = me) → stereo pan and distance attenuation (0 near, 1 far).
const SEAT_PAN:  Record<Position, number> = { south: 0, west: -1, north: 0, east: 1 }
const SEAT_DIST: Record<Position, number> = { south: 0, west: 0.6, north: 1, east: 0.6 }

let actx: AudioContext | null = null
let dealReady = false, dealFailed = false
const dealBuffers = new Map<string, AudioBuffer>()
const dealHtml = new Map<string, HTMLAudioElement[]>()   // fallback voices

function ensureDealAudio(): void {
  if (actx || dealFailed) { if (actx?.state === 'suspended') actx.resume().catch(() => {}); return }
  // Preload <audio> fallback first so the very first deal isn't silent while WebAudio decodes.
  for (const src of DEAL.clips) { const a = new Audio(src); a.preload = 'auto'; a.load(); dealHtml.set(src, [a]) }
  try {
    actx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    Promise.all(DEAL.clips.map(async src => {
      const res = await fetch(src)
      dealBuffers.set(src, await actx!.decodeAudioData(await res.arrayBuffer()))
    })).then(() => { dealReady = true }).catch(() => { dealFailed = true })
  } catch { dealFailed = true }
}

const rndRange = (a: number, b: number): number => a + Math.random() * (b - a)
const pickDealClip = (): string => DEAL.clips[Math.floor(Math.random() * DEAL.clips.length)]

function playDealClip(src: string, vol: number, pan: number, rate: number): void {
  vol = clamp01(vol)
  if (dealReady && actx) {
    if (actx.state === 'suspended') actx.resume().catch(() => {})
    const node = actx.createBufferSource(); node.buffer = dealBuffers.get(src)!; node.playbackRate.value = rate
    const g = actx.createGain(); g.gain.value = vol
    const p = actx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan))
    node.connect(g).connect(p).connect(actx.destination); node.start()
  } else {
    const arr = dealHtml.get(src); if (!arr) return
    let a = arr.find(v => v.paused || v.ended)
    if (!a) { a = new Audio(src); a.preload = 'auto'; arr.push(a) }   // never cut a ringing voice
    a.volume = vol; a.playbackRate = rate; a.currentTime = 0; a.play().catch(() => {})
  }
}

/** Panned "slide" accent for a packet dealt to the given visual seat. */
export function soundDealAccent(pos: Position): void {
  if (sfxVol <= 0 || DEAL.clips.length === 0) return
  ensureDealAudio()
  const dist = 1 - DEAL.distance * SEAT_DIST[pos]
  const vol  = DEAL.accentVol * sfxVol * dist * (1 + (Math.random() * 2 - 1) * DEAL.accentJitter)
  playDealClip(pickDealClip(), vol, SEAT_PAN[pos] * DEAL.panAmount, rndRange(DEAL.rateMin, DEAL.rateMax))
}
/** Soft shuffle bed played once at the start of the deal cascade. */
export function soundDealBed(): void {
  if (sfxVol <= 0 || !DEAL.bed || DEAL.clips.length === 0) return
  ensureDealAudio()
  playDealClip(pickDealClip(), DEAL.bedVol * sfxVol, 0, DEAL.bedRate)
}

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
