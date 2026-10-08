import { TICK } from '../src/qvn/constants.js'
import { COUNTER_FOR } from '../src/qvn/data.js'
import { GameEngine } from '../src/qvn/engine.js'

// Where the bot puts each technique in a lane (column index).
const SPOT = { zne: 1, twirl: 2, trex: 4, dd: 5 }

// A reasonable but unspectacular player: economy first, then the technique
// built for each error type it sees coming down a lane.
export function botAct(g, { counterFor = COUNTER_FOR } = {}) {
  const rows = g.level.rows
  const has = (t) => g.cards.some((c) => c.type === t)
  const tryPlace = (type, row, col) => g.canPlace(type, row, col).ok && g.place(type, row, col).ok

  // React to threats first: make sure each lane has the counter for every error type in it.
  for (const row of rows) {
    const types = new Set(g.enemies.filter((e) => e.row === row).map((e) => e.etype))
    for (const etype of ['readout', 'coherent', 'idle', 'gate']) {
      if (!types.has(etype)) continue
      const unit = counterFor[etype]
      if (!has(unit) || g.units.some((u) => u.row === row && u.type === unit)) continue
      if (tryPlace(unit, row, SPOT[unit])) return
    }
    if (types.size > 0 && has('zne') && !g.unitAt(row, 1)) {
      if (tryPlace('zne', row, 1)) return
    }
  }

  const plan = []
  for (const row of rows) plan.push(['sampler', row, 0])
  for (const row of rows) plan.push(['zne', row, 1])
  if (has('dd')) for (const row of rows) plan.push(['dd', row, 5])
  if (has('twirl')) for (const row of rows) plan.push(['twirl', row, 2])
  for (const row of rows) plan.push(['zne', row, 3])
  if (has('trex')) for (const row of rows) plan.push(['trex', row, 4])
  for (const row of rows) plan.push(['zne', row, 6])

  for (const [type, row, col] of plan) {
    if (g.unitAt(row, col)) continue
    if (!has(type)) continue
    tryPlace(type, row, col)
    return // wait for this item before moving down the list
  }
}

// The same build order, but answering each error type with the wrong technique.
export const WRONG_COUNTER = { gate: 'twirl', idle: 'zne', readout: 'dd', coherent: 'trex' }
export function wrongBotAct(g) {
  return botAct(g, { counterFor: WRONG_COUNTER })
}

// Ignores error types entirely: Samplers, then ZNE on every free tile.
export function zneOnlyBotAct(g) {
  const tryPlace = (type, row, col) => g.canPlace(type, row, col).ok && g.place(type, row, col).ok
  for (const row of g.level.rows) if (!g.unitAt(row, 0)) return void tryPlace('sampler', row, 0)
  for (const col of [1, 3, 2, 4, 5, 6])
    for (const row of g.level.rows) if (!g.unitAt(row, col)) return void tryPlace('zne', row, col)
}

export function playLevel(level, seed, { bot = true, act = botAct } = {}) {
  const g = new GameEngine(level, { seed, autoCollect: true })
  let ticks = 0
  while (g.state === 'playing' && g.time < 900) {
    g.update(TICK)
    if (bot && ++ticks % 15 === 0) act(g)
  }
  return g
}
