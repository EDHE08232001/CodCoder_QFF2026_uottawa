// Campaign progress, kept in this browser's localStorage.
const KEY = 'codfish-qubits-vs-noise:v1'

const DEFAULTS = { unlocked: 1, stars: {}, bestEndless: 0, bonusShots: 0, muted: false, autoCollect: false }

export function loadProgress() {
  try {
    const raw = localStorage.getItem(KEY)
    const data = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('unlockAll')) data.unlocked = 99
    return data
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveProgress(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Progress just won't persist (private mode, blocked storage).
  }
}
