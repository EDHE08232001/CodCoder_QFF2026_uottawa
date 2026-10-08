import {
  CELL_H,
  CELL_W,
  COLS,
  FIELD_H,
  FIELD_RIGHT,
  FIELD_W,
  GRID_X,
  GRID_Y,
  QUBIT_X,
  ROWS,
  cellCenter,
  rowCenterY,
} from './constants.js'
import { ENEMIES, ERROR_TYPES, UNITS } from './data.js'
import { CODFISH_SPRITES } from '../codfishSprites.js'

const TAU = Math.PI * 2
export const PAULI_COLORS = { X: '#ff5d73', Y: '#7cff7a', Z: '#5db7ff' }

// CODFISH reef palette (see style.css), so the battlefield matches the rest of the app.
const INK = '#082c40'
const REEF = {
  tileA: '#124862',
  tileB: '#164f6b',
  offline: '#0b2a40',
  pod: '#0b2a40',
  podEdge: '#68cbcf',
  mint: '#a5f7c9',
  gold: '#ffe18a',
  coral: '#f2775f',
  foam: '#d5eef4',
  lavender: '#c6a9ff',
}
const CREW = ['cod', 'clown', 'tang', 'puffer', 'angel']
const POD_X = QUBIT_X - 8 // the qubit's Bloch sphere, shifted left to make room for its crew member
const POD_R = 27

// ------------------------------------------------------------------ pixel pass
//
// Sprites are drawn at 1/PIXEL resolution and scaled up without smoothing, so
// they read as the same chunky pixel art as the CODFISH fish. Text is queued
// instead and drawn afterwards at full resolution, so it stays legible.

export const PIXEL = 2
let textQueue = null
const buffers = new Map()

function fillText(ctx, text, x, y) {
  if (!textQueue) {
    ctx.fillText(text, x, y)
    return
  }
  textQueue.push({
    text,
    x,
    y,
    m: ctx.getTransform(),
    alpha: ctx.globalAlpha,
    font: ctx.font,
    align: ctx.textAlign,
    baseline: ctx.textBaseline,
    fill: ctx.fillStyle,
    stroke: ctx.__stroke || null,
    width: ctx.__strokeWidth || 0,
  })
}

// Defers `draw(ctx)` to the full-resolution pass, for small pixel art that the
// low-resolution pass would blur (the codfish crew).
function crisp(ctx, draw) {
  if (!textQueue) {
    draw(ctx)
    return
  }
  textQueue.push({ draw, m: ctx.getTransform(), alpha: ctx.globalAlpha })
}

// Draws `draw(lowResCtx)` (in ctx's current units, w × h) pixelated into ctx.
export function drawPixelated(ctx, w, h, draw) {
  const bw = Math.ceil(w / PIXEL)
  const bh = Math.ceil(h / PIXEL)
  const key = `${bw}x${bh}`
  let buf = buffers.get(key)
  if (!buf) {
    buf = document.createElement('canvas')
    buf.width = bw
    buf.height = bh
    buffers.set(key, buf)
  }
  const low = buf.getContext('2d')
  low.setTransform(1 / PIXEL, 0, 0, 1 / PIXEL, 0, 0)
  low.clearRect(0, 0, w, h)
  const queue = []
  textQueue = queue
  try {
    draw(low)
  } finally {
    textQueue = null
  }
  ctx.save()
  ctx.clearRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(buf, 0, 0, w, h)
  ctx.restore()
  const base = ctx.getTransform().scale(PIXEL)
  for (const q of queue) {
    ctx.save()
    ctx.setTransform(base.multiply(q.m))
    ctx.globalAlpha = q.alpha
    if (q.draw) {
      q.draw(ctx)
      ctx.restore()
      continue
    }
    ctx.font = q.font
    ctx.textAlign = q.align
    ctx.textBaseline = q.baseline
    if (q.stroke) {
      ctx.lineJoin = 'round'
      ctx.strokeStyle = q.stroke
      ctx.lineWidth = q.width
      ctx.strokeText(q.text, q.x, q.y)
    }
    ctx.fillStyle = q.fill
    ctx.fillText(q.text, q.x, q.y)
    ctx.restore()
  }
}

// ------------------------------------------------------------------ helpers

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function shadow(ctx, x, y, w) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(x, y, w, w * 0.28, 0, 0, TAU)
  ctx.fill()
}

function circle(ctx, x, y, r) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
}

function bolt(ctx, x, y, s) {
  ctx.beginPath()
  ctx.moveTo(x + 2 * s, y - 12 * s)
  ctx.lineTo(x - 7 * s, y + 2 * s)
  ctx.lineTo(x - 1 * s, y + 2 * s)
  ctx.lineTo(x - 3 * s, y + 12 * s)
  ctx.lineTo(x + 7 * s, y - 3 * s)
  ctx.lineTo(x + 1 * s, y - 3 * s)
  ctx.lineTo(x + 4 * s, y - 12 * s)
  ctx.closePath()
}

function outlinedText(ctx, text, x, y, fill, stroke = INK, width = 4) {
  ctx.fillStyle = fill
  if (!textQueue) {
    ctx.lineJoin = 'round'
    ctx.strokeStyle = stroke
    ctx.lineWidth = width
    ctx.strokeText(text, x, y)
    ctx.fillText(text, x, y)
    return
  }
  ctx.__stroke = stroke
  ctx.__strokeWidth = width
  fillText(ctx, text, x, y)
  ctx.__stroke = null
}

// A CODFISH crew member (160 × 96 sprite) with its top-left corner at x, y.
const fishPaths = new Map()
function drawCodfish(ctx, species, x, y, scale, flip = false) {
  ctx.save()
  ctx.translate(x + (flip ? 160 * scale : 0), y)
  ctx.scale(flip ? -scale : scale, scale)
  for (const [kind, ...a] of CODFISH_SPRITES[species]) {
    if (kind === 'path') {
      if (!fishPaths.has(a[0])) fishPaths.set(a[0], new Path2D(a[0]))
      ctx.fillStyle = a[1]
      ctx.fill(fishPaths.get(a[0]))
    } else if (kind === 'rect') {
      ctx.fillStyle = a[4]
      ctx.fillRect(a[0], a[1], a[2], a[3])
    }
  }
  ctx.restore()
}

// ------------------------------------------------------------------ units

function drawSampler(ctx, x, y, t, u) {
  const glow = u ? u.flash || 0 : 0
  const ready = u ? 1 - Math.min(1, u.timer / UNITS.sampler.produceEvery) : 0.7
  shadow(ctx, x, y + 33, 26)
  ctx.fillStyle = '#d4b04c'
  for (let i = -1; i <= 1; i++) {
    ctx.fillRect(x - 31, y + i * 12 - 2, 7, 4)
    ctx.fillRect(x + 24, y + i * 12 - 2, 7, 4)
    ctx.fillRect(x + i * 12 - 2, y - 31, 4, 7)
    ctx.fillRect(x + i * 12 - 2, y + 24, 4, 7)
  }
  rr(ctx, x - 25, y - 25, 50, 50, 8)
  ctx.fillStyle = '#2a3570'
  ctx.fill()
  ctx.strokeStyle = '#8fa0ff'
  ctx.lineWidth = 2
  ctx.stroke()
  rr(ctx, x - 17, y - 17, 34, 34, 5)
  ctx.fillStyle = '#121838'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, 14, -Math.PI / 2, -Math.PI / 2 + ready * TAU)
  ctx.strokeStyle = 'rgba(255,216,74,0.55)'
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.save()
  ctx.shadowColor = '#ffd84a'
  ctx.shadowBlur = 8 + glow * 22 + Math.sin(t * 4) * 3
  bolt(ctx, x, y, 0.85)
  ctx.fillStyle = '#ffe066'
  ctx.fill()
  ctx.restore()
}

function drawZNE(ctx, x, y, t, u) {
  const recoil = u ? u.recoil || 0 : 0
  shadow(ctx, x, y + 34, 26)
  rr(ctx, x - 20, y + 18, 40, 12, 4)
  ctx.fillStyle = '#0b3f49'
  ctx.fill()
  rr(ctx, x - 24, y - 6, 44, 27, 8)
  ctx.fillStyle = '#10707f'
  ctx.fill()
  ctx.strokeStyle = '#3fe0d0'
  ctx.lineWidth = 2
  ctx.stroke()
  // barrel
  rr(ctx, x + 14 - recoil * 6, y, 21, 11, 3)
  ctx.fillStyle = '#3fe0d0'
  ctx.fill()
  ctx.fillStyle = '#0b3f49'
  ctx.fillRect(x + 31 - recoil * 6, y + 2, 3, 7)
  // chart screen: three noisy measurements extrapolated back to λ = 0
  rr(ctx, x - 28, y - 42, 48, 33, 5)
  ctx.fillStyle = '#06191f'
  ctx.fill()
  ctx.strokeStyle = '#3fe0d0'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.strokeStyle = 'rgba(63,224,208,0.45)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x - 22, y - 38)
  ctx.lineTo(x - 22, y - 14)
  ctx.lineTo(x + 15, y - 14)
  ctx.stroke()
  ctx.save()
  ctx.setLineDash([3, 2])
  ctx.strokeStyle = '#ff6bd6'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x + 9, y - 19)
  ctx.lineTo(x - 22, y - 34)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = '#ffcf5a'
  for (const [px, py] of [
    [-15, -30],
    [-3, -24],
    [9, -19],
  ]) {
    circle(ctx, x + px, y + py, 2.6)
    ctx.fill()
  }
  ctx.fillStyle = '#ff6bd6'
  circle(ctx, x - 22, y - 34, 2.5 + Math.sin(t * 5) * 0.8)
  ctx.fill()
}

function drawDD(ctx, x, y, t, u) {
  const flash = u ? u.flash || 0 : 0
  const vib = Math.sin(t * 55) * 3 * flash
  shadow(ctx, x, y + 34, 24)
  rr(ctx, x - 22, y + 14, 44, 18, 5)
  ctx.fillStyle = '#3a2270'
  ctx.fill()
  ctx.strokeStyle = '#b58cff'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#e6d9ff'
  ctx.font = 'bold 10px Courier New, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  fillText(ctx, 'X–Y–X–Y', x, y + 23)
  ctx.fillStyle = '#cdb6ff'
  ctx.fillRect(x - 4, y - 2, 8, 17)
  ctx.save()
  if (flash > 0) {
    ctx.shadowColor = '#c9a6ff'
    ctx.shadowBlur = 18 * flash
  }
  ctx.strokeStyle = '#d9c7ff'
  ctx.lineWidth = 7
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - 13 - vib, y - 40)
  ctx.lineTo(x - 13 - vib * 0.4, y - 10)
  ctx.quadraticCurveTo(x - 13, y + 1, x, y + 1)
  ctx.quadraticCurveTo(x + 13, y + 1, x + 13 + vib * 0.4, y - 10)
  ctx.lineTo(x + 13 + vib, y - 40)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 13px Georgia, serif'
  fillText(ctx, 'π', x, y - 22)
}

function drawTrex(ctx, x, y, t, u) {
  const open = u ? u.chomp || 0 : 0.35
  const bob = Math.sin(t * 3) * 1.5
  shadow(ctx, x, y + 34, 24)
  ctx.save()
  ctx.translate(x - 2, y + bob)
  // tail
  ctx.fillStyle = '#2f8f4a'
  ctx.beginPath()
  ctx.moveTo(-10, 4)
  ctx.quadraticCurveTo(-34, 8, -40, -6)
  ctx.quadraticCurveTo(-30, 20, -6, 22)
  ctx.closePath()
  ctx.fill()
  rr(ctx, -12, 18, 10, 14, 3)
  ctx.fill()
  rr(ctx, 4, 18, 10, 14, 3)
  ctx.fill()
  // body
  ctx.fillStyle = '#3fb35f'
  ctx.beginPath()
  ctx.ellipse(0, 8, 18, 17, 0, 0, TAU)
  ctx.fill()
  // belly readout meter
  ctx.fillStyle = '#e9fff0'
  ctx.beginPath()
  ctx.arc(2, 15, 9, Math.PI, TAU)
  ctx.closePath()
  ctx.fill()
  const needle = Math.PI + 0.4 + (Math.sin(t * 2.3) * 0.5 + 0.5) * (Math.PI - 0.8)
  ctx.strokeStyle = '#c0392b'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(2, 15)
  ctx.lineTo(2 + Math.cos(needle) * 8, 15 + Math.sin(needle) * 8)
  ctx.stroke()
  // little arm
  ctx.strokeStyle = '#2f8f4a'
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(12, 4)
  ctx.lineTo(19, 9)
  ctx.stroke()
  // upper jaw / head
  ctx.save()
  ctx.translate(2, -10)
  ctx.rotate(-open * 0.38)
  rr(ctx, -8, -18, 38, 18, 8)
  ctx.fillStyle = '#46c06a'
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < 4; i++) {
    ctx.beginPath()
    ctx.moveTo(10 + i * 5, 0)
    ctx.lineTo(12.5 + i * 5, 5)
    ctx.lineTo(15 + i * 5, 0)
    ctx.fill()
  }
  circle(ctx, 6, -10, 4.5)
  ctx.fill()
  ctx.fillStyle = '#111'
  circle(ctx, 7.5, -10, 2.2)
  ctx.fill()
  ctx.fillStyle = '#2f8f4a'
  circle(ctx, 26, -12, 1.5)
  ctx.fill()
  ctx.restore()
  // lower jaw
  ctx.save()
  ctx.translate(2, -8)
  ctx.rotate(open * 0.4)
  rr(ctx, -4, -1, 30, 9, 4)
  ctx.fillStyle = '#38a659'
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.moveTo(10 + i * 5, 0)
    ctx.lineTo(12.5 + i * 5, -4)
    ctx.lineTo(15 + i * 5, 0)
    ctx.fill()
  }
  ctx.restore()
  ctx.restore()
}

function drawTwirl(ctx, x, y, t, u) {
  const spin = t * (u ? 3 + (u.recoil || 0) * 9 : 1.5)
  shadow(ctx, x, y + 34, 22)
  rr(ctx, x - 17, y + 24, 34, 9, 3)
  ctx.fillStyle = '#2a3060'
  ctx.fill()
  ctx.strokeStyle = '#8a93b8'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(x, y - 8)
  ctx.lineTo(x, y + 26)
  ctx.stroke()
  const cy = y - 12
  const letters = ['X', 'Y', 'Z']
  for (let i = 0; i < 3; i++) {
    const a = spin + (i * TAU) / 3
    ctx.save()
    ctx.translate(x, cy)
    ctx.rotate(a)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(25, -11)
    ctx.quadraticCurveTo(32, 1, 19, 10)
    ctx.closePath()
    ctx.fillStyle = PAULI_COLORS[letters[i]]
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.translate(19, 0)
    ctx.rotate(-a)
    ctx.fillStyle = '#0b0f26'
    ctx.font = 'bold 11px Courier New, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    fillText(ctx, letters[i], 0, 1)
    ctx.restore()
  }
  ctx.fillStyle = '#ffffff'
  circle(ctx, x, cy, 5)
  ctx.fill()
}

const UNIT_DRAW = { sampler: drawSampler, zne: drawZNE, dd: drawDD, trex: drawTrex, twirl: drawTwirl }

export function drawUnitSprite(ctx, type, x, y, t, u = null) {
  UNIT_DRAW[type](ctx, x, y, t, u)
}

// ------------------------------------------------------------------ enemies

function drawDepolarizer(ctx, x, y, t, e) {
  const seed = e ? e.seed : 0
  const walking = !e || !e.attacking
  const walk = t * (walking ? 8 : 2) + seed
  const bob = Math.abs(Math.sin(walk)) * 3
  const r = 24
  shadow(ctx, x, y + 34, 22)
  ctx.strokeStyle = '#3a1470'
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - 8, y + 18)
  ctx.lineTo(x - 10 + Math.sin(walk) * 5, y + 32)
  ctx.moveTo(x + 8, y + 18)
  ctx.lineTo(x + 10 - Math.sin(walk) * 5, y + 32)
  ctx.stroke()
  const cy = y - bob
  ctx.beginPath()
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * TAU
    const rad = r + Math.sin(t * 9 + i * 1.9 + seed) * 2.3
    const px = x + Math.cos(a) * rad
    const py = cy + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  const g = ctx.createRadialGradient(x - 8, cy - 10, 3, x, cy, r + 4)
  g.addColorStop(0, '#d9a8ff')
  g.addColorStop(0.5, '#8a3be0')
  g.addColorStop(1, '#4a1488')
  ctx.fillStyle = g
  ctx.fill()
  // eyes looking at the qubits (left)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(x - 9, cy - 5, 6, 7, 0, 0, TAU)
  ctx.ellipse(x + 6, cy - 5, 6, 7, 0, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#14052b'
  circle(ctx, x - 11, cy - 4, 3)
  ctx.fill()
  circle(ctx, x + 4, cy - 4, 3)
  ctx.fill()
  ctx.strokeStyle = '#2a0b55'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(x - 16, cy - 15)
  ctx.lineTo(x - 4, cy - 11)
  ctx.moveTo(x + 13, cy - 15)
  ctx.lineTo(x + 1, cy - 11)
  ctx.stroke()
  // jagged mouth
  ctx.lineWidth = 2
  ctx.beginPath()
  const open = walking ? 0 : Math.abs(Math.sin(t * 10)) * 3
  ctx.moveTo(x - 10, cy + 8)
  for (let i = 1; i <= 5; i++) ctx.lineTo(x - 10 + i * 4, cy + 8 + (i % 2 ? 3 + open : 0))
  ctx.stroke()
  // orbiting Pauli errors
  ctx.font = 'bold 11px Courier New, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const letters = ['X', 'Y', 'Z']
  for (let k = 0; k < 3; k++) {
    const a = t * 2 + (k * TAU) / 3 + seed
    ctx.fillStyle = PAULI_COLORS[letters[k]]
    fillText(ctx, letters[k], x + Math.cos(a) * (r + 9), cy + Math.sin(a) * (r * 0.55) - 2)
  }
}

function drawDephaser(ctx, x, y, t, e) {
  const seed = e ? e.seed : 0
  const out = e ? e.outOfPhase : false
  const refocus = e ? e.refocusT > 0 : false
  const drift = e ? e.drift || 0 : 0.3
  const f = Math.sin(t * 3 + seed) * 3
  shadow(ctx, x, y + 34, 18)
  ctx.save()
  ctx.globalAlpha *= out ? 0.3 + 0.1 * Math.sin(t * 22) : 1
  const top = y - 8 + f
  ctx.beginPath()
  ctx.arc(x, top, 22, Math.PI, 0)
  ctx.lineTo(x + 22, y + 20 + f)
  for (let k = 0; k < 4; k++) {
    const x0 = x + 22 - k * 11
    ctx.quadraticCurveTo(x0 - 5.5, y + 20 + f + (k % 2 ? -7 : 7) * Math.sin(t * 6 + k), x0 - 11, y + 20 + f)
  }
  ctx.closePath()
  const g = ctx.createLinearGradient(x, top - 22, x, y + 24)
  g.addColorStop(0, '#8be3ff')
  g.addColorStop(1, '#1b5f9e')
  ctx.fillStyle = g
  if (refocus) {
    ctx.shadowColor = '#ffffff'
    ctx.shadowBlur = 16
  }
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = refocus ? '#ffffff' : '#bdf0ff'
  ctx.lineWidth = refocus ? 2.5 : 1.5
  ctx.stroke()
  // eyes
  ctx.fillStyle = '#06203a'
  circle(ctx, x - 8, top - 6, 3)
  ctx.fill()
  circle(ctx, x + 6, top - 6, 3)
  ctx.fill()
  // phase dial: precessing around the equator, faster as drift builds
  const dy = top + 12
  ctx.fillStyle = '#0b2340'
  circle(ctx, x, dy, 11)
  ctx.fill()
  ctx.strokeStyle = '#bdf0ff'
  ctx.lineWidth = 1.5
  ctx.stroke()
  const phi = t * (2 + drift * 9) + seed
  ctx.strokeStyle = '#ffe36b'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(x, dy)
  ctx.lineTo(x + Math.cos(phi) * 9, dy + Math.sin(phi) * 9)
  ctx.stroke()
  ctx.restore()
}

function drawOverRotator(ctx, x, y, t, e) {
  const armored = e ? e.armor > 0 : true
  const seed = e ? e.seed : 0
  const wob = Math.sin(t * 4 + seed) * 0.08
  shadow(ctx, x, y + 34, 22)
  ctx.save()
  ctx.translate(x, y + 2)
  ctx.rotate(wob)
  ctx.beginPath()
  ctx.moveTo(-26, -6)
  ctx.quadraticCurveTo(-24, -26, 0, -27)
  ctx.quadraticCurveTo(24, -26, 26, -6)
  ctx.lineTo(3, 28)
  ctx.lineTo(-3, 28)
  ctx.closePath()
  const g = ctx.createLinearGradient(-26, -27, 26, 28)
  if (armored) {
    g.addColorStop(0, '#ffc07a')
    g.addColorStop(1, '#d9541c')
  } else {
    g.addColorStop(0, '#d3a6ff')
    g.addColorStop(1, '#6a2bb8')
  }
  ctx.fillStyle = g
  ctx.fill()
  // spinning stripes
  ctx.save()
  ctx.clip()
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 5
  const off = (t * 40 + seed * 10) % 16
  for (let sx = -50 + off; sx < 50; sx += 16) {
    ctx.beginPath()
    ctx.moveTo(sx, -30)
    ctx.lineTo(sx + 14, 30)
    ctx.stroke()
  }
  ctx.restore()
  ctx.fillStyle = '#7a3a12'
  ctx.fillRect(-3, -36, 6, 10)
  // angry eyes
  ctx.fillStyle = '#ffffff'
  circle(ctx, -9, -12, 5)
  ctx.fill()
  circle(ctx, 6, -12, 5)
  ctx.fill()
  ctx.fillStyle = '#1a0a00'
  circle(ctx, -10.5, -11, 2.5)
  ctx.fill()
  circle(ctx, 4.5, -11, 2.5)
  ctx.fill()
  ctx.strokeStyle = '#4a1d05'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(-15, -20)
  ctx.lineTo(-4, -16)
  ctx.moveTo(12, -20)
  ctx.lineTo(1, -16)
  ctx.stroke()
  ctx.restore()
  if (armored) {
    ctx.save()
    ctx.translate(x, y - 2)
    ctx.rotate(Math.sin(t * 1.3 + seed) * 0.2)
    ctx.strokeStyle = '#ffd24a'
    ctx.shadowColor = '#ffd24a'
    ctx.shadowBlur = 8
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.ellipse(0, 0, 36, 11, 0, 0, TAU)
    ctx.stroke()
    ctx.shadowBlur = 0
    const ga = t * 4 + seed
    ctx.fillStyle = '#ffffff'
    circle(ctx, Math.cos(ga) * 36, Math.sin(ga) * 11, 2.5)
    ctx.fill()
    ctx.restore()
    ctx.font = 'italic bold 12px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    outlinedText(ctx, 'θ+ε', x, y - 58, '#ffd24a', INK, 3)
  }
}

function drawGremlin(ctx, x, y, t, e) {
  const seed = e ? e.seed : 0
  const jx = Math.sin(t * 25 + seed) * 1.5
  const hop = Math.abs(Math.sin(t * 9 + seed)) * 6
  shadow(ctx, x, y + 34, 16)
  ctx.save()
  ctx.globalAlpha *= 0.62 + 0.2 * Math.sin(t * 6 + seed)
  const cx = x + jx
  const cy = y + 6 - hop
  ctx.fillStyle = '#7dffc7'
  ctx.beginPath()
  ctx.moveTo(cx - 14, cy - 8)
  ctx.lineTo(cx - 20, cy - 26)
  ctx.lineTo(cx - 5, cy - 15)
  ctx.lineTo(cx + 5, cy - 15)
  ctx.lineTo(cx + 20, cy - 26)
  ctx.lineTo(cx + 14, cy - 8)
  ctx.closePath()
  ctx.fill()
  circle(ctx, cx, cy, 17)
  ctx.fill()
  ctx.fillStyle = '#ff3355'
  circle(ctx, cx - 6, cy - 3, 3)
  ctx.fill()
  circle(ctx, cx + 6, cy - 3, 3)
  ctx.fill()
  ctx.strokeStyle = '#0b3d2a'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy + 4, 7, 0.2, Math.PI - 0.2)
  ctx.stroke()
  ctx.restore()
  // the sign it waves: a flipped measurement outcome
  const flip = Math.floor(t * 2.5 + seed) % 2
  ctx.save()
  ctx.translate(x + 18, y - 26 - hop)
  ctx.rotate(Math.sin(t * 5 + seed) * 0.15)
  rr(ctx, -15, -10, 30, 18, 4)
  ctx.fillStyle = 'rgba(240,255,248,0.92)'
  ctx.fill()
  ctx.strokeStyle = '#2b8a66'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = '#c0392b'
  ctx.font = 'bold 11px Courier New, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  fillText(ctx, flip ? '1→0' : '0→1', 0, 0)
  ctx.restore()
}

function drawCnotCrusher(ctx, x, y, t, e) {
  const seed = e ? e.seed : 0
  const walking = !e || !e.attacking
  const stomp = t * (walking ? 5 : 9) + seed
  const bob = Math.abs(Math.sin(stomp)) * (walking ? 2.5 : 1.5)
  shadow(ctx, x, y + 38, 30)
  // stubby legs
  ctx.fillStyle = '#2a2266'
  rr(ctx, x - 20 + Math.sin(stomp) * 3, y + 20, 14, 18, 4)
  ctx.fill()
  rr(ctx, x + 6 - Math.sin(stomp) * 3, y + 20, 14, 18, 4)
  ctx.fill()
  const cy = y - bob
  // hulking body
  rr(ctx, x - 30, cy - 30, 60, 54, 16)
  const g = ctx.createLinearGradient(x - 30, cy - 30, x + 30, cy + 24)
  g.addColorStop(0, '#8f7bff')
  g.addColorStop(1, '#2f2378')
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = '#c5b9ff'
  ctx.lineWidth = 2
  ctx.stroke()
  // fists, swinging harder while it attacks
  const swing = walking ? Math.sin(stomp) * 3 : Math.sin(t * 14) * 7
  ctx.fillStyle = '#5b4bc4'
  circle(ctx, x - 34 - swing, cy + 8, 9)
  ctx.fill()
  circle(ctx, x + 34 + swing * 0.3, cy + 8, 9)
  ctx.fill()
  // angry eyes under a heavy brow
  ctx.fillStyle = '#ffffff'
  circle(ctx, x - 12, cy - 16, 5)
  ctx.fill()
  circle(ctx, x + 4, cy - 16, 5)
  ctx.fill()
  ctx.fillStyle = '#120a33'
  circle(ctx, x - 13.5, cy - 15, 2.5)
  ctx.fill()
  circle(ctx, x + 2.5, cy - 15, 2.5)
  ctx.fill()
  ctx.strokeStyle = '#1b1247'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(x - 20, cy - 24)
  ctx.lineTo(x + 12, cy - 22)
  ctx.stroke()
  // CNOT emblem on its chest: control dot wired to a target ⊕
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 2
  circle(ctx, x - 2, cy - 2, 3.2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x - 2, cy - 2)
  ctx.lineTo(x - 2, cy + 18)
  ctx.stroke()
  circle(ctx, x - 2, cy + 12, 7)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x - 9, cy + 12)
  ctx.lineTo(x + 5, cy + 12)
  ctx.stroke()
}

function drawZZHopper(ctx, x, y, t, e) {
  const seed = e ? e.seed : 0
  const refocus = e ? e.refocusT > 0 : false
  const hop = refocus ? Math.abs(Math.sin(t * 3 + seed)) * 2 : Math.abs(Math.sin(t * 6 + seed)) * 9
  shadow(ctx, x, y + 34, 20)
  const cy = y + 4 - hop
  // springy ZZ coil coupling its two lobes
  ctx.strokeStyle = refocus ? '#ffffff' : '#d7c4ff'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  const coils = 6
  const stretch = 1 + Math.sin(t * 6 + seed) * (refocus ? 0.02 : 0.12)
  for (let i = 0; i <= coils; i++) {
    const px = x - 4 + i * 4.2 * stretch
    const py = cy - 6 + (i % 2 ? -6 : 6)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
  const lobe = (lx, ly, r, c0, c1) => {
    const g = ctx.createRadialGradient(lx - r / 3, ly - r / 3, 2, lx, ly, r)
    g.addColorStop(0, c0)
    g.addColorStop(1, c1)
    ctx.fillStyle = g
    circle(ctx, lx, ly, r)
    ctx.fill()
    if (refocus) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }
  lobe(x + 26 * stretch, cy - 8, 10, '#e6dbff', '#7a52d6')
  lobe(x - 8, cy, 19, '#d9c7ff', '#5b2fb0')
  // big hoppy feet
  ctx.fillStyle = '#4a2596'
  ctx.beginPath()
  ctx.ellipse(x - 18, cy + 18 + hop * 0.6, 8, 4, -0.3, 0, TAU)
  ctx.ellipse(x + 2, cy + 18 + hop * 0.6, 8, 4, 0.3, 0, TAU)
  ctx.fill()
  // eyes and a cheeky grin
  ctx.fillStyle = '#ffffff'
  circle(ctx, x - 15, cy - 5, 5)
  ctx.fill()
  circle(ctx, x - 3, cy - 5, 5)
  ctx.fill()
  ctx.fillStyle = '#1d0b45'
  circle(ctx, x - 16.5, cy - 4, 2.4)
  ctx.fill()
  circle(ctx, x - 4.5, cy - 4, 2.4)
  ctx.fill()
  ctx.strokeStyle = '#1d0b45'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x - 9, cy + 4, 6, 0.3, Math.PI - 0.3)
  ctx.stroke()
  ctx.font = 'bold 10px Courier New, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  outlinedText(ctx, 'ZZ', x + 26 * stretch, cy - 8, '#ffffff', 'rgba(40,10,90,0.9)', 3)
}

function drawFlipBird(ctx, x, y, t, seed) {
  const flap = Math.sin(t * 14 + seed)
  const cy = y + Math.sin(t * 4 + seed) * 4
  ctx.save()
  ctx.globalAlpha *= 0.7 + 0.15 * Math.sin(t * 6 + seed)
  ctx.fillStyle = '#5fe8a8'
  for (const dir of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(x, cy - 2)
    ctx.quadraticCurveTo(x + dir * 10, cy - 16 * flap - 4, x + dir * 22, cy - 10 * flap)
    ctx.quadraticCurveTo(x + dir * 12, cy - 2, x + dir * 4, cy + 4)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = '#9dffd0'
  ctx.beginPath()
  ctx.ellipse(x, cy, 11, 9, 0, 0, TAU)
  ctx.fill()
  // beak pointing at the qubits
  ctx.fillStyle = '#ffb347'
  ctx.beginPath()
  ctx.moveTo(x - 10, cy - 1)
  ctx.lineTo(x - 17, cy + 1)
  ctx.lineTo(x - 10, cy + 3)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ff3355'
  circle(ctx, x - 5, cy - 3, 2)
  ctx.fill()
  ctx.restore()
  // the bit it is busy flipping
  const bit = Math.floor(t * 3 + seed) % 2
  ctx.font = 'bold 10px Courier New, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  outlinedText(ctx, String(bit), x + 3, cy + 1, '#0b3d2a', 'rgba(200,255,230,0.9)', 2)
}

function drawFlipFlock(ctx, x, y, t, e) {
  shadow(ctx, x, y + 34, 12)
  drawFlipBird(ctx, x, y, t, e ? e.seed : 0)
}

function drawDetuner(ctx, x, y, t, e) {
  const seed = e ? e.seed : 0
  const b = e ? e.buildup || 0 : 0.5
  const twirled = e ? e.twirledT > 0 : false
  shadow(ctx, x, y + 34, 18)
  // build-up rings: the coherent error growing like (Nε)²
  if (b > 0.05) {
    ctx.save()
    for (let i = 0; i < 3; i++) {
      const k = (t * 1.5 + i / 3) % 1
      ctx.strokeStyle = `rgba(255,192,74,${(1 - k) * b * 0.8})`
      ctx.lineWidth = 2
      circle(ctx, x, y - 6, 18 + k * (16 + b * 18))
      ctx.stroke()
    }
    ctx.restore()
  }
  // a tuning fork, slightly out of tune
  const amp = 1 + b * 3
  const vib = twirled ? 0 : Math.sin(t * 40 + seed) * amp
  ctx.save()
  ctx.lineCap = 'round'
  const g = ctx.createLinearGradient(x, y - 40, x, y + 30)
  g.addColorStop(0, '#ffe08a')
  g.addColorStop(1, '#d9741c')
  ctx.strokeStyle = g
  ctx.lineWidth = 9
  ctx.beginPath()
  ctx.moveTo(x - 12 - vib, y - 38)
  ctx.lineTo(x - 12 - vib * 0.4, y - 6)
  ctx.quadraticCurveTo(x - 12, y + 6, x, y + 6)
  ctx.quadraticCurveTo(x + 12, y + 6, x + 12 + vib * 0.4, y - 6)
  ctx.lineTo(x + 12 + vib, y - 38)
  ctx.stroke()
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.moveTo(x, y + 6)
  ctx.lineTo(x, y + 30)
  ctx.stroke()
  ctx.restore()
  // face on the stem, sweating as it detunes
  ctx.fillStyle = '#fff4d6'
  circle(ctx, x, y - 2, 11)
  ctx.fill()
  ctx.fillStyle = '#4a2205'
  circle(ctx, x - 4, y - 4, 2)
  ctx.fill()
  circle(ctx, x + 4, y - 4, 2)
  ctx.fill()
  ctx.strokeStyle = '#4a2205'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(x - 4, y + 3)
  ctx.lineTo(x - 1, y + 2)
  ctx.lineTo(x + 2, y + 4)
  ctx.lineTo(x + 5, y + 2)
  ctx.stroke()
  // Nε dial: the accumulated rotation angle
  ctx.font = 'italic bold 11px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  outlinedText(ctx, b > 0.66 ? '(Nε)²' : 'Nε', x, y - 52, '#ffc04a', INK, 3)
}

function drawColossus(ctx, x, y, t, e) {
  const seed = e ? e.seed : 0
  const armored = e ? e.armor > 0 : true
  const r = 44
  shadow(ctx, x, y + 40, 40)
  if (e && e.zapT > 0) {
    ctx.save()
    ctx.strokeStyle = `rgba(255,120,140,${e.zapT / 0.6})`
    ctx.lineWidth = 3
    for (const dir of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(x, y + dir * r * 0.8)
      for (let k = 1; k <= 6; k++) ctx.lineTo(x + (k % 2 ? 10 : -10), y + dir * (r * 0.8 + (k * (CELL_H - r * 0.8)) / 6))
      ctx.stroke()
    }
    ctx.restore()
  }
  ctx.beginPath()
  for (let i = 0; i <= 30; i++) {
    const a = (i / 30) * TAU
    const rad = r + Math.sin(t * 5 + i * 1.3 + seed) * 3
    const px = x + Math.cos(a) * rad
    const py = y + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  const g = ctx.createRadialGradient(x - 14, y - 18, 6, x, y, r + 6)
  g.addColorStop(0, '#ff9aa8')
  g.addColorStop(0.55, '#c3243f')
  g.addColorStop(1, '#5e0a1d')
  ctx.fillStyle = g
  ctx.fill()
  if (armored) {
    ctx.save()
    ctx.strokeStyle = '#ffd24a'
    ctx.shadowColor = '#ffd24a'
    ctx.shadowBlur = 10
    ctx.lineWidth = 6
    for (let k = 0; k < 4; k++) {
      const a = t * 0.8 + (k * TAU) / 4
      ctx.beginPath()
      ctx.arc(x, y, r + 7, a, a + 0.9)
      ctx.stroke()
    }
    ctx.restore()
  }
  for (const [ex, ey, er] of [
    [-16, -12, 8],
    [6, -16, 9],
    [-4, 4, 6],
  ]) {
    ctx.fillStyle = '#fff3c4'
    circle(ctx, x + ex, y + ey, er)
    ctx.fill()
    ctx.fillStyle = '#2b0008'
    circle(ctx, x + ex - 2, y + ey + 1, er * 0.45)
    ctx.fill()
  }
  ctx.strokeStyle = '#2b0008'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(x - 20, y + 22)
  for (let i = 1; i <= 8; i++) ctx.lineTo(x - 20 + i * 5, y + 22 + (i % 2 ? 5 : 0))
  ctx.stroke()
  ctx.font = 'bold 13px Courier New, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  outlinedText(ctx, 'ZZ', x, y - r - 8, '#ffb3c0', INK, 3)
}

const ENEMY_DRAW = {
  depolarizer: drawDepolarizer,
  cnotCrusher: drawCnotCrusher,
  dephaser: drawDephaser,
  zzHopper: drawZZHopper,
  gremlin: drawGremlin,
  flipFlock: drawFlipFlock,
  overRotator: drawOverRotator,
  detuner: drawDetuner,
  colossus: drawColossus,
}

// The colored type badge every error wears, so players can pick the right tool.
export function drawTypeBadge(ctx, x, y, etype, r = 9) {
  const info = ERROR_TYPES[etype]
  ctx.fillStyle = INK
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r)
  ctx.strokeStyle = info.color
  ctx.lineWidth = 2
  ctx.strokeRect(x - r, y - r, 2 * r, 2 * r)
  ctx.fillStyle = info.color
  ctx.font = `bold ${Math.round(r * 1.25)}px Courier New, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  fillText(ctx, info.glyph, x, y + 0.5)
}

export function drawEnemySprite(ctx, type, x, y, t, e = null) {
  ENEMY_DRAW[type](ctx, x, y, t, e)
}

// ------------------------------------------------------------------ field

// A small, stable hash for scattering seabed specks.
function speck(r, c, k) {
  const v = Math.sin(r * 127.1 + c * 311.7 + k * 74.7) * 43758.5453
  return v - Math.floor(v)
}

function drawBackground(ctx, engine, t) {
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, FIELD_W, FIELD_H)
  for (let r = 0; r < ROWS; r++) {
    const active = engine.qubits[r].active
    for (let c = 0; c < COLS; c++) {
      const x = GRID_X + c * CELL_W
      const y = GRID_Y + r * CELL_H
      ctx.fillStyle = active ? ((r + c) % 2 ? REEF.tileA : REEF.tileB) : REEF.offline
      ctx.fillRect(x, y, CELL_W, CELL_H)
      if (active) {
        // seabed specks and pixel corner marks, like the reef cover art
        ctx.fillStyle = 'rgba(165,247,201,0.10)'
        for (let k = 0; k < 3; k++) ctx.fillRect(x + 8 + speck(r, c, k) * (CELL_W - 20), y + 8 + speck(c, r, k) * (CELL_H - 20), 4, 4)
        ctx.fillStyle = 'rgba(133,239,220,0.16)'
        ctx.fillRect(x + 2, y + 2, 4, 4)
        ctx.fillRect(x + CELL_W - 6, y + CELL_H - 6, 4, 4)
      }
    }
    const cy = rowCenterY(r)
    if (active) {
      // the qubit's wire, like in a circuit diagram
      ctx.fillStyle = 'rgba(133,239,220,0.22)'
      ctx.fillRect(GRID_X, cy - 1, FIELD_W - GRID_X, 2)
    } else {
      ctx.save()
      ctx.beginPath()
      ctx.rect(GRID_X, GRID_Y + r * CELL_H, COLS * CELL_W, CELL_H)
      ctx.clip()
      ctx.strokeStyle = 'rgba(104,203,207,0.08)'
      ctx.lineWidth = 6
      for (let k = -CELL_H; k < COLS * CELL_W; k += 22) {
        ctx.beginPath()
        ctx.moveTo(GRID_X + k, GRID_Y + r * CELL_H + CELL_H)
        ctx.lineTo(GRID_X + k + CELL_H, GRID_Y + r * CELL_H)
        ctx.stroke()
      }
      ctx.restore()
      ctx.fillStyle = 'rgba(199,224,237,0.45)'
      ctx.font = 'bold 13px Courier New, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      fillText(ctx, 'qubit offline in this level', GRID_X + (COLS * CELL_W) / 2, cy)
    }
  }
  // light shafts from the surface
  const sway = Math.sin(t * 0.25) * 18
  ctx.fillStyle = 'rgba(190,255,240,0.035)'
  for (const [x0, w] of [
    [260, 70],
    [610, 50],
  ]) {
    ctx.beginPath()
    ctx.moveTo(x0 + sway, 0)
    ctx.lineTo(x0 + w + sway, 0)
    ctx.lineTo(x0 + w - 120, FIELD_H)
    ctx.lineTo(x0 - 170, FIELD_H)
    ctx.closePath()
    ctx.fill()
  }
  // the noise current flowing in from the open sea on the right
  const g = ctx.createLinearGradient(FIELD_RIGHT - 30, 0, FIELD_W, 0)
  g.addColorStop(0, 'rgba(176,140,255,0)')
  g.addColorStop(1, 'rgba(176,140,255,0.32)')
  ctx.fillStyle = g
  ctx.fillRect(FIELD_RIGHT - 30, 0, FIELD_W - FIELD_RIGHT + 30, FIELD_H)
  ctx.fillStyle = 'rgba(214,190,255,0.6)'
  for (let i = 0; i < 40; i++) {
    const sx = FIELD_RIGHT + ((i * 37.3 + t * 60 * ((i % 3) + 1)) % (FIELD_W - FIELD_RIGHT))
    const sy = (i * 97.1 + Math.sin(t * 3 + i) * 10) % FIELD_H
    ctx.fillRect(FIELD_W - (sx - FIELD_RIGHT), sy, 2, 2)
  }
  // seaweed and coral where the current comes in
  ctx.fillStyle = '#4aaf9c'
  for (const [x, h] of [
    [FIELD_W - 66, 54],
    [FIELD_W - 26, 38],
  ]) {
    const lean = Math.round(Math.sin(t * 1.4 + x) * 2) * 2
    ctx.fillRect(x, FIELD_H - h, 8, h)
    ctx.fillRect(x - 8 + lean, FIELD_H - h - 14, 8, 22)
    ctx.fillRect(x + 8 - lean, FIELD_H - h * 0.6, 8, 14)
  }
  ctx.fillStyle = '#b69be0'
  ctx.fillRect(FIELD_W - 46, FIELD_H - 26, 8, 26)
  ctx.fillRect(FIELD_W - 54, FIELD_H - 34, 8, 12)
  ctx.fillRect(FIELD_W - 38, FIELD_H - 40, 8, 16)
  // rising bubbles
  ctx.strokeStyle = 'rgba(159,243,236,0.45)'
  ctx.lineWidth = 2
  for (let i = 0; i < 9; i++) {
    const rise = (t * (12 + (i % 3) * 6) + i * 61) % (FIELD_H + 20)
    const bx = ((i * 113 + 70) % (FIELD_W - 40)) + Math.sin(t * 1.3 + i) * 6
    const s = 6 + (i % 3) * 2
    ctx.strokeRect(bx, FIELD_H + 10 - rise, s, s)
  }
  // qubit panel: the crew's research pods
  ctx.fillStyle = REEF.pod
  ctx.fillRect(0, 0, GRID_X - 4, FIELD_H)
  ctx.fillStyle = REEF.podEdge
  ctx.fillRect(GRID_X - 6, 0, 2, FIELD_H)
  ctx.fillStyle = INK
  ctx.fillRect(GRID_X - 4, 0, 4, FIELD_H)
}

function drawQubits(ctx, engine, t) {
  for (const q of engine.qubits) {
    const cy = rowCenterY(q.row)
    const shake = q.hitFlash > 0 ? Math.sin(t * 70) * 4 * q.hitFlash : 0
    const cx = POD_X + shake
    const r = POD_R
    ctx.save()
    ctx.globalAlpha = q.active ? 1 : 0.3
    ctx.fillStyle = '#0e354e'
    circle(ctx, cx, cy, r)
    ctx.fill()
    ctx.strokeStyle = q.hitFlash > 0 ? `rgba(242,119,95,${0.5 + q.hitFlash / 2})` : '#85efdc'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.strokeStyle = 'rgba(133,239,220,0.35)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, r * 0.32, 0, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx, cy + r)
    ctx.stroke()
    // Bloch vector: its length is the qubit's fidelity (purity)
    const f = q.fidelity / 100
    const color = f > 0.6 ? REEF.mint : f > 0.3 ? REEF.gold : REEF.coral
    if (q.active && f > 0) {
      const a = -Math.PI / 2 + 0.55 + Math.sin(t * 1.1 + q.row) * 0.12
      const len = r * 0.92 * f
      const tx = cx + Math.cos(a) * len
      const ty = cy + Math.sin(a) * len * 0.95
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(tx, ty)
      ctx.stroke()
      ctx.fillRect(tx - 4, ty - 4, 8, 8)
    }
    ctx.fillStyle = REEF.foam
    ctx.fillRect(cx - 2, cy - 2, 4, 4)
    // the codfish crew member guarding this qubit; it flinches when the qubit is hit
    const bob = Math.round(Math.sin(t * 2 + q.row * 1.7) * 1.5)
    crisp(ctx, (c) => drawCodfish(c, CREW[q.row % CREW.length], 82 + Math.round(shake), cy - 13 + bob, 0.25))
    ctx.font = 'bold 13px Courier New, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = REEF.foam
    fillText(ctx, `q${q.row}`, 6, cy - r - 4)
    if (q.active) {
      ctx.textAlign = 'center'
      ctx.fillStyle = color
      fillText(ctx, `${Math.round(q.fidelity)}%`, POD_X, cy + r + 12)
    }
    ctx.restore()
  }
}

function drawBars(ctx, x, y, w, hp, maxHp, armor, maxArmor, color) {
  const damaged = hp < maxHp || (maxArmor && armor < maxArmor)
  if (!damaged) return
  ctx.fillStyle = INK
  ctx.fillRect(x - w / 2 - 2, y - 2, w + 4, 8)
  ctx.fillStyle = color
  ctx.fillRect(x - w / 2, y, (w * Math.max(0, hp)) / maxHp, 4)
  if (maxArmor && armor > 0) {
    ctx.fillStyle = INK
    ctx.fillRect(x - w / 2 - 2, y - 8, w + 4, 8)
    ctx.fillStyle = REEF.gold
    ctx.fillRect(x - w / 2, y - 6, (w * armor) / maxArmor, 4)
  }
}

function drawUnit(ctx, u, t) {
  drawUnitSprite(ctx, u.type, u.x, u.y, t, u)
  if (u.hitFlash > 0) {
    ctx.fillStyle = `rgba(242,119,95,${u.hitFlash * 0.3})`
    circle(ctx, u.x, u.y, 30)
    ctx.fill()
  }
  drawBars(ctx, u.x, u.y + 38, 44, u.hp, u.maxHp, 0, 0, REEF.mint)
}

function drawEnemy(ctx, e, t) {
  if (e.slowT > 0) {
    ctx.strokeStyle = 'rgba(198,169,255,0.75)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(e.x, e.y + 34, e.radius * 0.9, 6, 0, 0, TAU)
    ctx.stroke()
  }
  drawEnemySprite(ctx, e.type, e.x, e.y, t, e)
  if (e.hitFlash > 0) {
    // Right tool: a bright flash. Wrong tool: a dull grey one.
    ctx.save()
    ctx.globalAlpha = e.hitFlash * (e.hitKind === 'effective' ? 0.45 : 0.3)
    ctx.fillStyle = e.hitKind === 'effective' ? '#ffffff' : '#5a6f80'
    circle(ctx, e.x, e.y, e.radius)
    ctx.fill()
    ctx.restore()
  }
  if (e.twirledT > 0 && e.armor <= 0) {
    const letters = ['X', 'Y', 'Z']
    for (let k = 0; k < 3; k++) {
      const a = t * 5 + (k * TAU) / 3
      ctx.fillStyle = PAULI_COLORS[letters[k]]
      ctx.fillRect(e.x + Math.cos(a) * 9 - 3, e.y - e.radius - 21 + Math.sin(a) * 3, 6, 6)
    }
  }
  const barW = e.type === 'colossus' ? 80 : 40
  drawBars(ctx, e.x, e.y - e.radius - 12, barW, e.hp, e.maxHp, e.armor, e.maxArmor, REEF.coral)
  drawTypeBadge(ctx, e.x - barW / 2 - 12, e.y - e.radius - 9, e.etype)
}

function drawProjectile(ctx, p) {
  if (p.kind === 'zne') {
    ctx.fillStyle = 'rgba(95,242,227,0.3)'
    ctx.fillRect(p.x - 18, p.y - 4, 10, 8)
    ctx.save()
    ctx.shadowColor = '#5ff2e3'
    ctx.shadowBlur = 12
    ctx.fillStyle = '#c9fff9'
    ctx.fillRect(p.x - 6, p.y - 6, 12, 12)
    ctx.restore()
  } else {
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.spin)
    ctx.font = 'bold 18px Courier New, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    outlinedText(ctx, p.letter, 0, 1, PAULI_COLORS[p.letter], INK, 4)
    ctx.restore()
  }
}

function drawPulse(ctx, p) {
  const k = 1 - p.life / p.maxLife
  for (let i = 0; i < 3; i++) {
    const rad = Math.max(4, k * p.range - i * 16)
    ctx.strokeStyle = `rgba(198,169,255,${(1 - k) * (0.8 - i * 0.2)})`
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(p.x, p.y, rad, -0.75, 0.75)
    ctx.stroke()
  }
}

// A chamfered pixel coin, like the bubbles and chips on the reef cover.
function coin(ctx, r) {
  const c = r * 0.45
  ctx.beginPath()
  ctx.moveTo(-r + c, -r)
  ctx.lineTo(r - c, -r)
  ctx.lineTo(r, -r + c)
  ctx.lineTo(r, r - c)
  ctx.lineTo(r - c, r)
  ctx.lineTo(-r + c, r)
  ctx.lineTo(-r, r - c)
  ctx.lineTo(-r, -r + c)
  ctx.closePath()
}

function drawToken(ctx, tk, t) {
  let { x, y } = tk
  let s = 1
  if (tk.collected) {
    const k = Math.min(1, tk.collectT / 0.5)
    x = x + (40 - x) * k
    y = y + (-30 - y) * k
    s = 1 - k * 0.6
  }
  const blink = !tk.collected && tk.landed && tk.life < 3 ? 0.35 + 0.65 * Math.abs(Math.sin(t * 9)) : 1
  const bob = tk.landed && !tk.collected ? Math.sin(t * 3 + tk.id) * 2 : 0
  ctx.save()
  ctx.globalAlpha = blink
  ctx.translate(x, y + bob)
  ctx.scale(s, s)
  const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 28)
  g.addColorStop(0, 'rgba(255,240,170,0.85)')
  g.addColorStop(1, 'rgba(255,200,90,0)')
  ctx.fillStyle = g
  circle(ctx, 0, 0, 28)
  ctx.fill()
  ctx.fillStyle = '#c89c37'
  ctx.save()
  ctx.translate(3, 3)
  coin(ctx, 15)
  ctx.fill()
  ctx.restore()
  coin(ctx, 15)
  ctx.fillStyle = REEF.gold
  ctx.fill()
  ctx.strokeStyle = '#fff6cf'
  ctx.lineWidth = 2
  ctx.stroke()
  bolt(ctx, 0, 0, 0.75)
  ctx.fillStyle = '#7a4b00'
  ctx.fill()
  ctx.restore()
}

function drawPlacementGhost(ctx, engine, ui, t) {
  const { hover } = ui
  if (!hover) return
  const x = GRID_X + hover.col * CELL_W
  const y = GRID_Y + hover.row * CELL_H
  if (ui.selected) {
    const ok = engine.canPlace(ui.selected, hover.row, hover.col).ok
    ctx.fillStyle = 'rgba(165,247,201,0.06)'
    ctx.fillRect(GRID_X, y, COLS * CELL_W, CELL_H)
    ctx.fillStyle = ok ? 'rgba(165,247,201,0.18)' : 'rgba(242,119,95,0.2)'
    ctx.fillRect(x, y, CELL_W, CELL_H)
    ctx.strokeStyle = ok ? REEF.mint : REEF.coral
    ctx.lineWidth = 4
    ctx.strokeRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4)
    if (engine.qubits[hover.row].active && !engine.unitAt(hover.row, hover.col)) {
      const c = cellCenter(hover.row, hover.col)
      ctx.save()
      ctx.globalAlpha = 0.5
      drawUnitSprite(ctx, ui.selected, c.x, c.y, t)
      ctx.restore()
    }
  } else if (ui.shovel && engine.unitAt(hover.row, hover.col)) {
    ctx.fillStyle = 'rgba(242,119,95,0.24)'
    ctx.fillRect(x, y, CELL_W, CELL_H)
    ctx.strokeStyle = REEF.coral
    ctx.lineWidth = 4
    ctx.strokeRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4)
  }
}

// Wave banners use the cover title's stacked pixel shadow.
function drawBanner(ctx, banner) {
  const k = banner.maxLife - banner.life
  const alpha = Math.min(1, k * 4, banner.life * 2)
  const scale = 1 + Math.max(0, 0.25 - k) * 1.2
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(GRID_X + (COLS * CELL_W) / 2, FIELD_H / 2 - 10)
  ctx.scale(scale, scale)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 40px Courier New, monospace'
  ctx.fillStyle = '#124a65'
  fillText(ctx, banner.text, 6, 6)
  ctx.fillStyle = '#218f8d'
  fillText(ctx, banner.text, 3, 3)
  ctx.fillStyle = '#baffda'
  fillText(ctx, banner.text, 0, 0)
  if (banner.sub) {
    ctx.font = 'bold 17px Courier New, monospace'
    ctx.fillStyle = '#124a65'
    fillText(ctx, banner.sub, 2, 40)
    ctx.fillStyle = '#ffd08d'
    fillText(ctx, banner.sub, 0, 38)
  }
  ctx.restore()
}

function drawScene(ctx, engine, ui) {
  const t = engine.time
  drawBackground(ctx, engine, t)
  drawQubits(ctx, engine, t)
  for (const p of engine.pulses) drawPulse(ctx, p)
  for (let r = 0; r < ROWS; r++) {
    for (const u of engine.units) if (u.row === r) drawUnit(ctx, u, t)
    const row = engine.enemies.filter((e) => e.row === r).sort((a, b) => a.x - b.x)
    for (const e of row) drawEnemy(ctx, e, t)
  }
  for (const p of engine.projectiles) drawProjectile(ctx, p)
  for (const p of engine.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife)
    if (p.text) {
      ctx.font = 'bold 13px Courier New, monospace'
      ctx.textAlign = 'center'
      ctx.fillStyle = PAULI_COLORS[p.text] || p.color
      fillText(ctx, p.text, p.x, p.y)
    } else {
      ctx.fillStyle = p.color
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
    }
  }
  ctx.globalAlpha = 1
  drawPlacementGhost(ctx, engine, ui, t)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const f of engine.floaters) {
    ctx.globalAlpha = Math.min(1, (f.life / f.maxLife) * 2)
    if (f.etype) {
      ctx.font = 'bold 18px Courier New, monospace'
      outlinedText(ctx, f.text, f.x, f.y, ERROR_TYPES[f.etype].color)
    } else {
      ctx.font = 'bold 13px Courier New, monospace'
      outlinedText(ctx, f.text, f.x, f.y, f.color)
    }
  }
  ctx.globalAlpha = 1
  for (const tk of engine.tokens) drawToken(ctx, tk, t)
  if (engine.banner) drawBanner(ctx, engine.banner)
}

// `ctx` must be set up in field units (FIELD_W × FIELD_H).
export function renderField(ctx, engine, ui = {}) {
  drawPixelated(ctx, FIELD_W, FIELD_H, (low) => drawScene(low, engine, ui))
}

function drawIconScene(ctx, kind, type, t) {
  if (kind === 'unit') drawUnitSprite(ctx, type, 48, 52, t)
  else if (type === 'flipFlock') {
    drawFlipBird(ctx, 30, 34, t, 1)
    drawFlipBird(ctx, 66, 44, t, 3)
    drawFlipBird(ctx, 40, 68, t, 5)
  } else {
    if (ENEMIES[type].boss) {
      ctx.translate(48, 52)
      ctx.scale(0.72, 0.72)
      ctx.translate(-48, -52)
    }
    drawEnemySprite(ctx, type, 48, 54, t)
  }
}

// Static icon used by cards, lessons and the Almanac, in the same pixel style as the field.
// `ctx` must be set up so that 96 units span the icon.
export function drawIcon(ctx, kind, type, t = 0.8) {
  drawPixelated(ctx, 96, 96, (low) => drawIconScene(low, kind, type, t))
}
