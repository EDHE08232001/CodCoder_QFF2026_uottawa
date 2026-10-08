// Tiny synthesized sound effects, so the game ships without audio files.
let ac = null
let muted = false

function ctx() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ac = new AC()
  }
  if (ac.state === 'suspended') ac.resume()
  return ac
}

function tone(freq, dur, { type = 'sine', vol = 0.08, slide = 0, delay = 0 } = {}) {
  if (muted) return
  const a = ctx()
  if (!a) return
  const t0 = a.currentTime + delay
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur)
  gain.gain.setValueAtTime(vol, t0)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(gain).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

const SOUNDS = {
  place: () => tone(520, 0.12, { type: 'triangle', slide: 200 }),
  remove: () => tone(300, 0.15, { type: 'triangle', slide: -150 }),
  collect: () => {
    tone(880, 0.08, { type: 'sine', vol: 0.06 })
    tone(1320, 0.12, { type: 'sine', vol: 0.06, delay: 0.06 })
  },
  fire: () => tone(1200, 0.05, { type: 'square', vol: 0.012, slide: -500 }),
  pulse: () => tone(240, 0.25, { type: 'sine', vol: 0.05, slide: 240 }),
  bite: () => tone(160, 0.1, { type: 'sawtooth', vol: 0.05, slide: -60 }),
  kill: () => tone(660, 0.12, { type: 'triangle', vol: 0.04, slide: -400 }),
  armorBreak: () => {
    tone(1500, 0.2, { type: 'square', vol: 0.03, slide: -1200 })
    tone(900, 0.25, { type: 'triangle', vol: 0.05, delay: 0.05 })
  },
  qubitHit: () => tone(140, 0.35, { type: 'sawtooth', vol: 0.08, slide: -80 }),
  unitLost: () => tone(200, 0.3, { type: 'square', vol: 0.03, slide: -120 }),
  bigWave: () => {
    tone(220, 0.4, { type: 'sawtooth', vol: 0.05 })
    tone(233, 0.4, { type: 'sawtooth', vol: 0.05, delay: 0.4 })
  },
  bossSpawn: () => tone(90, 0.4, { type: 'sawtooth', vol: 0.05, slide: 60 }),
  hop: () => tone(330, 0.14, { type: 'triangle', vol: 0.04, slide: 330 }),
  won: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.07, delay: i * 0.12 })),
  lost: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.35, { type: 'sawtooth', vol: 0.05, delay: i * 0.18 })),
  click: () => tone(700, 0.04, { type: 'triangle', vol: 0.04 }),
  error: () => tone(180, 0.12, { type: 'square', vol: 0.03 }),
}

let lastFire = 0

export function play(name) {
  if (muted || !SOUNDS[name]) return
  // Rate-limit the very frequent shooting sound.
  if (name === 'fire') {
    const now = performance.now()
    if (now - lastFire < 90) return
    lastFire = now
  }
  try {
    SOUNDS[name]()
  } catch {
    // Audio is best-effort.
  }
}

export function setMuted(m) {
  muted = m
}
