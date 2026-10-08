import {
  CELL_W,
  COLS,
  FIELD_H,
  FIELD_RIGHT,
  FIELD_W,
  GRID_X,
  MAX_FIDELITY,
  QUBIT_LINE,
  ROWS,
  SPAWN_X,
  cellCenter,
  rowCenterY,
} from './constants.js'
import { EFFECTIVE_MULT, ENEMIES, ERROR_TYPES, RESISTED_MULT, UNITS, formatMult, matchup, typeMultiplier } from './data.js'
import { endlessWave } from './levels.js'

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SKY_DROP_EVERY = 9
const TOKEN_VALUE = 25
const TOKEN_LIFE = 10
const PAULIS = ['X', 'Y', 'Z']
const MATCHUP_TAG_EVERY = 1.2 // seconds between ×2 / ×½ floaters on one error

export class GameEngine {
  constructor(level, { seed = (Math.random() * 2 ** 32) >>> 0, bonusShots = 0, autoCollect = false } = {}) {
    this.level = level
    this.rng = mulberry32(seed)
    this.autoCollect = autoCollect
    this.time = 0
    this.shots = level.startShots + bonusShots
    this.state = 'playing' // 'playing' | 'won' | 'lost'
    this.lostTo = null
    this.nextId = 1

    this.qubits = Array.from({ length: ROWS }, (_, row) => ({
      row,
      active: level.rows.includes(row),
      fidelity: MAX_FIDELITY,
      hitFlash: 0,
    }))
    this.cards = level.cards.map((type) => ({ type, cooldown: 0 }))

    this.units = []
    this.enemies = []
    this.projectiles = []
    this.pulses = []
    this.tokens = []
    this.floaters = []
    this.particles = []
    this.events = []
    this.banner = null

    this.waveIndex = 0 // index of the next wave to start
    this.nextWaveAt = level.prepTime
    this.waveStartedAt = -Infinity
    this.spawnQueue = []
    this.skyTimer = 3
    this.stats = { kills: {}, leaks: {}, placed: {}, hits: { effective: 0, resisted: 0 }, dealt: { effective: 0, resisted: 0 } }
  }

  get totalWaves() {
    return this.level.endless ? Infinity : this.level.waves.length
  }

  waveAt(i) {
    return this.level.endless ? endlessWave(i) : this.level.waves[i]
  }

  // ---------------------------------------------------------------- public API

  update(dt) {
    if (this.state !== 'playing') {
      this.updateCosmetics(dt)
      return
    }
    this.time += dt
    this.updateWaves(dt)
    this.updateCards(dt)
    this.updateSky(dt)
    this.updateUnits(dt)
    this.updateProjectiles(dt)
    this.updateEnemies(dt)
    this.updateTokens(dt)
    this.updateCosmetics(dt)
    this.checkEnd()
  }

  setAutoCollect(on) {
    this.autoCollect = on
  }

  canPlace(type, row, col) {
    if (this.state !== 'playing') return { ok: false, reason: 'Game over' }
    const card = this.cards.find((c) => c.type === type)
    if (!card) return { ok: false, reason: 'Not available in this level' }
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return { ok: false, reason: 'Off the board' }
    if (!this.qubits[row].active) return { ok: false, reason: 'That qubit is offline' }
    if (this.unitAt(row, col)) return { ok: false, reason: 'Tile occupied' }
    if (card.cooldown > 0) return { ok: false, reason: 'Recharging…' }
    if (this.shots < UNITS[type].cost) return { ok: false, reason: 'Not enough Shots' }
    return { ok: true }
  }

  place(type, row, col) {
    const check = this.canPlace(type, row, col)
    if (!check.ok) return check
    const def = UNITS[type]
    const card = this.cards.find((c) => c.type === type)
    this.shots -= def.cost
    card.cooldown = def.recharge
    const { x, y } = cellCenter(row, col)
    const unit = {
      id: this.nextId++,
      type,
      row,
      col,
      x,
      y,
      hp: def.hp,
      maxHp: def.hp,
      timer: type === 'sampler' ? def.firstProduce : 0.3,
      anim: 0,
      hitFlash: 0,
      placedAt: this.time,
    }
    this.units.push(unit)
    this.stats.placed[type] = (this.stats.placed[type] || 0) + 1
    this.emit({ type: 'place', unit: type })
    return { ok: true, unit }
  }

  remove(row, col) {
    const unit = this.unitAt(row, col)
    if (!unit || this.state !== 'playing') return false
    this.units = this.units.filter((u) => u !== unit)
    this.puff(unit.x, unit.y, '#8899cc', 10)
    this.emit({ type: 'remove' })
    return true
  }

  unitAt(row, col) {
    return this.units.find((u) => u.row === row && u.col === col) || null
  }

  // Click on the field. Returns true if a token was collected.
  collectAt(x, y) {
    let best = null
    let bestD = 34
    for (const t of this.tokens) {
      if (t.collected) continue
      const d = Math.hypot(t.x - x, t.y - y)
      if (d < bestD) {
        best = t
        bestD = d
      }
    }
    if (!best) return false
    this.collectToken(best)
    return true
  }

  collectToken(t) {
    t.collected = true
    t.collectT = 0
    this.shots += t.value
    this.emit({ type: 'collect' })
  }

  drainEvents() {
    const e = this.events
    this.events = []
    return e
  }

  progress() {
    if (this.level.endless) return { done: this.waveIndex, total: null, flags: [] }
    const total = this.level.waves.length
    const flags = this.level.waves.map((wv, i) => (wv.flag ? (i + 1) / total : null)).filter((f) => f !== null)
    return { done: this.waveIndex, total, flags }
  }

  averageFidelity() {
    const active = this.qubits.filter((q) => q.active)
    return active.reduce((s, q) => s + q.fidelity, 0) / active.length
  }

  stars() {
    const f = this.averageFidelity()
    if (f >= 90) return 3
    if (f >= 65) return 2
    return 1
  }

  // ------------------------------------------------------------------ internals

  emit(ev) {
    this.events.push(ev)
  }

  rand(a = 0, b = 1) {
    return a + (b - a) * this.rng()
  }

  pick(arr) {
    return arr[Math.floor(this.rng() * arr.length)]
  }

  showBanner(text, sub = '', duration = 3) {
    this.banner = { text, sub, life: duration, maxLife: duration }
  }

  updateWaves() {
    const moreWaves = this.waveIndex < this.totalWaves
    if (moreWaves) {
      // Start the next wave early if the board is clear and nothing is queued.
      const clear = this.enemies.length === 0 && this.spawnQueue.length === 0
      if (clear && this.waveIndex > 0 && this.time - this.waveStartedAt > 5) {
        this.nextWaveAt = Math.min(this.nextWaveAt, this.time + 3)
      }
      if (this.time >= this.nextWaveAt) this.startWave()
    }

    for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
      const s = this.spawnQueue[i]
      if (this.time >= s.at) {
        this.spawnQueue.splice(i, 1)
        this.spawnGroup(s.type, s.row, s.hpScale)
      }
    }
  }

  startWave() {
    const wave = this.waveAt(this.waveIndex)
    const isLast = this.waveIndex === this.totalWaves - 1
    const lead = wave.flag ? 3 : 0
    if (wave.flag || isLast) {
      if (isLast) this.showBanner('FINAL WAVE', 'Protect your qubits!', 3.5)
      else this.showBanner('A burst of noise is approaching!', this.level.endless ? `Wave ${this.waveIndex + 1}` : '', 3)
      this.emit({ type: 'bigWave' })
    } else if (this.level.endless) {
      this.showBanner(`Wave ${this.waveIndex + 1}`, '', 1.6)
    }

    const types = []
    for (const [type, count] of Object.entries(wave.spawn)) for (let k = 0; k < count; k++) types.push(type)
    // Shuffle so mixed waves interleave.
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[types[i], types[j]] = [types[j], types[i]]
    }
    const rows = this.level.rows
    let lastRow = -1
    types.forEach((type, k) => {
      let row = this.pick(rows)
      if (row === lastRow && rows.length > 1) row = this.pick(rows)
      // Bosses avoid the edge lanes so their spill-over has somewhere to go.
      if (ENEMIES[type].boss) row = rows[Math.floor(rows.length / 2)]
      lastRow = row
      const at = this.time + lead + (types.length === 1 ? 0 : (k / (types.length - 1)) * wave.spread)
      this.spawnQueue.push({ at, type, row, hpScale: wave.hpScale || 1 })
    })

    this.waveIndex++
    this.waveStartedAt = this.time
    this.nextWaveAt = this.time + wave.gap
  }

  // A Flip Flock spawns one bird in its lane and in each active neighbouring lane.
  spawnGroup(type, row, hpScale = 1, x = SPAWN_X) {
    if (!ENEMIES[type].flock) return [this.spawnEnemy(type, row, hpScale, x)]
    const rows = [row - 1, row, row + 1].filter((r) => r >= 0 && r < ROWS && this.qubits[r].active)
    return rows.map((r, k) => this.spawnEnemy(type, r, hpScale, x + k * 14))
  }

  spawnEnemy(type, row, hpScale = 1, x = SPAWN_X) {
    const def = ENEMIES[type]
    const hp = Math.round(def.hp * hpScale)
    const armor = Math.round((def.armor || 0) * hpScale)
    const e = {
      id: this.nextId++,
      type,
      row,
      x,
      y: rowCenterY(row),
      hp,
      maxHp: hp,
      armor,
      maxArmor: armor,
      radius: def.radius,
      etype: def.errorType, // current error type; coherent armor decays to def.decaysTo
      seed: this.rng() * 100,
      age: 0,
      slowT: 0,
      twirledT: 0,
      refocusT: 0,
      hitFlash: 0,
      outOfPhase: false,
      drift: 0,
      buildup: 0,
      hopT: def.hopEvery ? def.hopEvery * this.rand(0.6, 1) : 0,
      tagT: 0,
      attacking: null,
      spawnT: def.spawnEvery || 0,
      zapT: 0,
    }
    this.enemies.push(e)
    return e
  }

  updateCards(dt) {
    for (const c of this.cards) c.cooldown = Math.max(0, c.cooldown - dt)
  }

  updateSky(dt) {
    this.skyTimer -= dt
    if (this.skyTimer <= 0) {
      this.skyTimer = SKY_DROP_EVERY
      const x = GRID_X + this.rand(0.3, COLS - 0.3) * CELL_W
      this.tokens.push({
        id: this.nextId++,
        x,
        y: -20,
        targetY: this.rand(60, FIELD_H - 50),
        vy: 45,
        value: TOKEN_VALUE,
        life: TOKEN_LIFE,
        landed: false,
        age: 0,
        source: 'sky',
        collected: false,
      })
    }
  }

  enemiesAhead(unit, { rangeCells = Infinity } = {}) {
    const maxX = Math.min(FIELD_RIGHT + 10, unit.x + rangeCells * CELL_W)
    return this.enemies.filter((e) => e.row === unit.row && e.hp > 0 && e.x >= unit.x - CELL_W * 0.45 && e.x <= maxX)
  }

  updateUnits(dt) {
    for (const u of this.units) {
      u.anim += dt
      u.hitFlash = Math.max(0, u.hitFlash - dt * 3)
      u.recoil = Math.max(0, (u.recoil || 0) - dt * 6)
      u.flash = Math.max(0, (u.flash || 0) - dt * 2.5)
      u.chomp = Math.max(0, (u.chomp || 0) - dt * 3)
      u.timer = Math.max(0, u.timer - dt)
      const def = UNITS[u.type]

      if (u.type === 'sampler') {
        if (u.timer <= 0) {
          u.timer = def.produceEvery
          u.flash = 1
          this.tokens.push({
            id: this.nextId++,
            x: u.x + this.rand(-18, 18),
            y: u.y - 10,
            targetY: u.y + this.rand(8, 22),
            vy: -90,
            value: def.value,
            life: TOKEN_LIFE,
            landed: false,
            age: 0,
            source: 'sampler',
            collected: false,
          })
        }
      } else if (u.type === 'zne' || u.type === 'twirl') {
        if (u.timer <= 0 && this.enemiesAhead(u).length > 0) {
          u.timer = def.fireEvery
          u.recoil = 1
          const p = {
            id: this.nextId++,
            kind: u.type,
            row: u.row,
            x: u.x + 28,
            y: u.y - (u.type === 'zne' ? 2 : 8),
            speed: def.projectileSpeed,
            passed: new Set(),
            spin: this.rand(0, Math.PI * 2),
          }
          if (u.type === 'zne') p.dmg = this.rand(def.dmgMin, def.dmgMax)
          else {
            p.dmg = def.dmg
            p.letter = this.pick(PAULIS)
          }
          this.projectiles.push(p)
          this.emit({ type: 'fire', unit: u.type })
        }
      } else if (u.type === 'dd') {
        const targets = this.enemiesAhead(u, { rangeCells: def.range })
        if (u.timer <= 0 && targets.length > 0) {
          u.timer = def.pulseEvery
          u.flash = 1
          this.pulses.push({ x: u.x + 16, y: u.y, life: 0.6, maxLife: 0.6, range: def.range * CELL_W })
          for (const e of targets) {
            // Echo pulses refocus idle errors: dephasers stop dodging, hoppers stop hopping.
            if (e.etype === 'idle') {
              if (e.refocusT <= 0) this.floater(e.x, e.y - 30, 'refocused!', '#d9c2ff')
              e.refocusT = def.refocusTime
              e.outOfPhase = false
            }
            e.slowT = Math.max(e.slowT, def.slowTime)
            this.damage(e, def.dmg, 'dd')
          }
          this.emit({ type: 'pulse' })
        }
      } else if (u.type === 'trex') {
        const inRange = this.enemiesAhead(u, { rangeCells: def.range })
        if (inRange.length > 0) {
          u.chomp = Math.max(u.chomp, 0.35) // jaws open while something is in range
          if (u.timer <= 0) {
            u.timer = def.biteEvery
            u.chomp = 1
            // Readout errors first, then whatever is closest.
            const readout = inRange.filter((e) => e.etype === 'readout')
            const pool = readout.length > 0 ? readout : inRange
            const target = pool.reduce((a, b) => (a.x < b.x ? a : b))
            if (this.damage(target, def.dmg, 'trex') === 'effective') {
              this.floater(target.x, target.y - 26, '0⇄1 fixed!', '#9dffb0', 0.9)
            }
            this.emit({ type: 'bite' })
          }
        }
      }
    }
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      p.x += p.speed * dt
      p.spin += dt * 10
      for (const e of this.enemies) {
        if (e.row !== p.row || e.hp <= 0) continue
        if (Math.abs(e.x - p.x) > e.radius * 0.8) continue
        if (e.outOfPhase) {
          if (!p.passed.has(e.id)) {
            p.passed.add(e.id)
            this.floater(e.x, e.y - 30, 'phase slip!', '#7fd8ff', 0.8)
          }
          continue
        }
        this.damage(e, p.dmg, p.kind)
        if (p.kind === 'twirl') {
          if (e.buildup > 0.25) this.floater(e.x, e.y - 34, 'build-up scrambled!', '#ffe680', 0.9)
          else if (e.twirledT <= 0 && e.armor <= 0) this.floater(e.x, e.y - 34, 'twirled', '#ffe680', 0.8)
          e.twirledT = UNITS.twirl.twirlTime
          e.buildup = 0
        }
        this.sparks(p.x, p.y, p.kind === 'zne' ? '#5ff2e3' : this.letterColor(p.letter), 5)
        p.dead = true
        break
      }
      if (p.x > FIELD_W + 20) p.dead = true
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead)
  }

  letterColor(l) {
    return l === 'X' ? '#ff5d73' : l === 'Y' ? '#7cff7a' : '#5db7ff'
  }

  // Deals `amount` base damage from a technique to an error, scaled by the
  // type chart: ×2 if the technique is built for the error's type, ×½ if not.
  // Returns 'effective' or 'resisted' (or null if the error was already dead).
  damage(e, amount, source) {
    if (e.hp <= 0) return null
    const result = matchup(source, e.etype)
    const dealt = amount * typeMultiplier(source, e.etype)
    e.hitFlash = 1
    e.hitKind = result
    this.stats.hits[result]++
    if (e.tagT <= 0) {
      // Pop a ×2 / ×½ tag to the right of the health bar (the type badge sits on its left).
      e.tagT = MATCHUP_TAG_EVERY
      const tx = e.x + Math.max(34, e.radius + 8)
      const ty = e.y - e.radius - 8
      if (result === 'effective') this.floater(tx, ty, formatMult(EFFECTIVE_MULT), '#ffffff', 0.7, e.etype)
      else this.floater(tx, ty, formatMult(RESISTED_MULT), '#8b93b8', 0.7)
    }
    this.stats.dealt[result] += dealt
    if (e.armor > 0) {
      e.armor -= dealt
      if (e.armor <= 0) {
        e.armor = 0
        // Twirled away: what's left is ordinary stochastic noise.
        e.etype = ENEMIES[e.type].decaysTo || e.etype
        e.twirledT = Math.max(e.twirledT, UNITS.twirl.twirlTime)
        this.floater(e.x, e.y - 40, 'coherent → stochastic!', '#ffd24a', 1.4)
        for (let i = 0; i < 14; i++) {
          this.particles.push({
            x: e.x,
            y: e.y,
            vx: this.rand(-120, 120),
            vy: this.rand(-160, 40),
            life: 0.9,
            maxLife: 0.9,
            color: '#ffd24a',
            size: this.rand(2, 5),
            text: i % 3 === 0 ? this.pick(PAULIS) : null,
          })
        }
        this.emit({ type: 'armorBreak' })
      }
      return result
    }
    const bonus = source === 'zne' && e.twirledT > 0 ? UNITS.zne.twirledBonus : 1
    e.hp -= dealt * bonus
    if (e.hp <= 0) this.kill(e)
    return result
  }

  kill(e) {
    e.hp = 0
    e.dead = true
    this.stats.kills[e.type] = (this.stats.kills[e.type] || 0) + 1
    this.puff(e.x, e.y, e.etype === 'readout' ? '#7dffc7' : '#c08bff', e.type === 'colossus' ? 40 : 14)
    this.emit({ type: 'kill', enemy: e.type })
  }

  updateEnemies(dt) {
    for (const e of this.enemies) {
      if (e.dead) continue
      const def = ENEMIES[e.type]
      e.age += dt
      e.slowT = Math.max(0, e.slowT - dt)
      e.twirledT = Math.max(0, e.twirledT - dt)
      e.refocusT = Math.max(0, e.refocusT - dt)
      e.hitFlash = Math.max(0, e.hitFlash - dt * 5)
      e.zapT = Math.max(0, e.zapT - dt)
      e.tagT = Math.max(0, e.tagT - dt)
      // Glide toward the lane centre (only differs right after a hop).
      e.y += (rowCenterY(e.row) - e.y) * Math.min(1, dt * 10)
      const onBoard = e.x < FIELD_RIGHT

      if (e.type === 'dephaser') {
        const phase = ((e.age + e.seed) % def.phasePeriod) / def.phasePeriod
        e.outOfPhase = e.refocusT <= 0 && phase < def.outOfPhaseFrac
        // Idle phase error accumulates until an echo pulse refocuses it.
        e.drift = e.refocusT > 0 ? 0 : Math.min(1, e.drift + dt / def.driftTime)
      }

      if (def.buildupTime && onBoard) {
        // Coherent build-up: the same small rotation keeps adding up, unless twirled.
        e.buildup = e.twirledT > 0 ? 0 : Math.min(1, e.buildup + dt / def.buildupTime)
      }

      if (def.hopEvery && onBoard) {
        e.hopT -= dt
        if (e.hopT <= 0) {
          e.hopT = def.hopEvery
          this.hop(e)
        }
      }

      if (def.boss) {
        e.spawnT -= dt
        if (e.spawnT <= 0 && onBoard) {
          e.spawnT = def.spawnEvery
          e.zapT = 0.6
          for (const r of [e.row - 1, e.row + 1]) {
            if (r >= 0 && r < ROWS && this.qubits[r].active) this.spawnEnemy('dephaser', r, 1, e.x)
          }
          this.emit({ type: 'bossSpawn' })
        }
      }

      const blocker = this.findBlocker(e)
      e.attacking = blocker
      if (blocker) {
        blocker.hp -= def.dps * dt
        blocker.hitFlash = 1
        if (blocker.hp <= 0) {
          this.units = this.units.filter((u) => u !== blocker)
          this.puff(blocker.x, blocker.y, '#ff6b6b', 12)
          this.floater(blocker.x, blocker.y - 30, 'decohered!', '#ff8080')
          this.emit({ type: 'unitLost', unit: blocker.type })
        }
      } else {
        const slow = e.slowT > 0 ? 1 - UNITS.dd.slow : 1
        const rush = 1 + e.drift + e.buildup * (def.buildupSpeed || 0)
        e.x -= def.speed * rush * slow * dt
      }

      if (e.x <= QUBIT_LINE) this.hitQubit(e)
    }
    this.enemies = this.enemies.filter((e) => !e.dead)
  }

  // ZZ crosstalk: jump to a neighbouring qubit's wire, unless DD has refocused it.
  hop(e) {
    if (e.refocusT > 0) return false
    const options = [e.row - 1, e.row + 1].filter((r) => r >= 0 && r < ROWS && this.qubits[r].active)
    if (options.length === 0) return false
    e.row = this.pick(options)
    e.attacking = null
    this.floater(e.x, e.y - 34, 'ZZ hop!', ERROR_TYPES.idle.color, 0.9)
    this.emit({ type: 'hop' })
    return true
  }

  fidelityDamage(e) {
    const def = ENEMIES[e.type]
    return Math.round(def.fidelityDmg * (1 + e.buildup * (def.buildupDmg || 0)))
  }

  findBlocker(e) {
    const ghost = ENEMIES[e.type].ghost
    const front = e.x - e.radius * 0.7
    let best = null
    for (const u of this.units) {
      if (u.row !== e.row) continue
      if (ghost && u.type !== 'trex') continue
      // The error's front edge has reached the unit, and the error hasn't walked past it.
      if (front <= u.x + 26 && e.x >= u.x - 10) {
        if (!best || u.x > best.x) best = u
      }
    }
    return best
  }

  hitQubit(e) {
    const def = ENEMIES[e.type]
    const q = this.qubits[e.row]
    const loss = this.fidelityDamage(e)
    q.fidelity = Math.max(0, q.fidelity - loss)
    q.hitFlash = 1
    e.dead = true
    this.stats.leaks[e.type] = (this.stats.leaks[e.type] || 0) + 1
    this.floater(GRID_X - 40, e.y - 40, `-${loss}% fidelity`, '#ff7b7b', 1.4)
    this.emit({ type: 'qubitHit', row: e.row, enemy: e.type })
    if (q.fidelity <= 0 && this.state === 'playing') {
      this.state = 'lost'
      this.lostTo = e.type
      this.showBanner('DECOHERENCE!', `Qubit q${e.row} lost its state to a ${def.name}`, 999)
      this.emit({ type: 'lost', enemy: e.type, row: e.row })
    }
  }

  updateTokens(dt) {
    for (const t of this.tokens) {
      t.age += dt
      if (t.collected) {
        t.collectT += dt
        if (t.collectT > 0.5) t.dead = true
        continue
      }
      if (!t.landed) {
        if (t.source === 'sampler') {
          t.vy += 260 * dt
          t.y += t.vy * dt
        } else {
          t.y += t.vy * dt
        }
        if (t.y >= t.targetY && (t.source === 'sky' || t.vy > 0)) {
          t.y = t.targetY
          t.landed = true
        }
      } else {
        t.life -= dt
        if (this.autoCollect && t.life < TOKEN_LIFE - 0.8) this.collectToken(t)
        else if (t.life <= 0) t.dead = true
      }
    }
    this.tokens = this.tokens.filter((t) => !t.dead)
  }

  updateCosmetics(dt) {
    for (const q of this.qubits) q.hitFlash = Math.max(0, q.hitFlash - dt * 1.5)
    for (const p of this.pulses) p.life -= dt
    this.pulses = this.pulses.filter((p) => p.life > 0)
    for (const f of this.floaters) {
      f.life -= dt
      f.y -= 28 * dt
    }
    this.floaters = this.floaters.filter((f) => f.life > 0)
    for (const p of this.particles) {
      p.life -= dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 300 * dt
    }
    this.particles = this.particles.filter((p) => p.life > 0)
    if (this.banner) {
      this.banner.life -= dt
      if (this.banner.life <= 0) this.banner = null
    }
  }

  checkEnd() {
    if (this.state !== 'playing' || this.level.endless) return
    if (this.waveIndex >= this.level.waves.length && this.spawnQueue.length === 0 && this.enemies.length === 0) {
      this.state = 'won'
      this.showBanner('CIRCUIT COMPLETE!', 'Your qubits survived the noise', 999)
      this.emit({ type: 'won' })
    }
  }

  floater(x, y, text, color, life = 1.1, etype = null) {
    this.floaters.push({ x, y, text, color, life, maxLife: life, etype })
  }

  // Share of damage dealt by the technique built for the error's type (0-1), or null before any hits.
  matchupAccuracy() {
    const { effective, resisted } = this.stats.dealt
    const total = effective + resisted
    return total > 0 ? effective / total : null
  }

  puff(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = this.rand(0, Math.PI * 2)
      const s = this.rand(30, 140)
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.6, maxLife: 0.6, color, size: this.rand(2, 5) })
    }
  }

  sparks(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x,
        y,
        vx: this.rand(-90, 40),
        vy: this.rand(-90, 30),
        life: 0.3,
        maxLife: 0.3,
        color,
        size: this.rand(1.5, 3),
      })
    }
  }
}
