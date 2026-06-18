// ── Gameplay UI settings (persisted) ──────────────────────────────────
// Small key/value prefs the player tweaks from the gear menu and that should
// survive refresh. Audio volumes live in audio/soundManager.ts; this is for
// non-audio toggles (currently: the tap-to-confirm card prompt).

const STORE_KEY = 'contree-settings'

interface Settings {
  confirmPlay: boolean   // require a ✓/✗ confirmation before playing a card
}
const defaults: Settings = { confirmPlay: true }

let current: Settings = (function load(): Settings {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch { /* ignore corrupt storage */ }
  return { ...defaults }
})()

function save(): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(current)) } catch { /* ignore */ }
}

export function getConfirmPlay(): boolean { return current.confirmPlay }
export function setConfirmPlay(v: boolean): void { current.confirmPlay = v; save() }
