import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TICK, cellCenter } from '../src/qvn/constants.js'
import { COUNTER_FOR, EFFECTIVE_MULT, ENEMIES, RESISTED_MULT, TECHNIQUES, TYPE_ORDER, UNITS, typeMultiplier } from '../src/qvn/data.js'
import { GameEngine } from '../src/qvn/engine.js'
import { ENDLESS, LEVELS, getLevel } from '../src/qvn/levels.js'
import { playLevel, wrongBotAct, zneOnlyBotAct } from './bot.js'

function step(g, seconds) {
  const n = Math.round(seconds / TICK)
  for (let i = 0; i < n && g.state === 'playing'; i++) g.update(TICK)
}

// A sandbox level with no waves, so mechanics can be tested in isolation.
function sandbox(cards = ['sampler', 'zne', 'dd', 'trex', 'twirl']) {
  return { id: 'test', rows: [0, 1, 2, 3, 4], cards, startShots: 10000, prepTime: 9999, waves: [{ spawn: {}, gap: 9999, spread: 0 }] }
}

describe('placement', () => {
  it('charges cost, starts recharge and rejects occupied tiles', () => {
    const g = new GameEngine(sandbox(), { seed: 1 })
    const before = g.shots
    assert.equal(g.place('zne', 2, 3).ok, true)
    assert.equal(g.shots, before - UNITS.zne.cost)
    assert.equal(g.canPlace('zne', 2, 4).reason, 'Recharging…')
    step(g, UNITS.zne.recharge + 0.1)
    assert.equal(g.canPlace('zne', 2, 3).reason, 'Tile occupied')
    assert.equal(g.canPlace('zne', 2, 4).ok, true)
  })

  it('refuses offline rows, unaffordable units and cards not in the level', () => {
    const level = { ...sandbox(['sampler', 'zne']), rows: [1, 2, 3], startShots: 60 }
    const g = new GameEngine(level, { seed: 1 })
    assert.equal(g.canPlace('sampler', 0, 0).reason, 'That qubit is offline')
    assert.equal(g.canPlace('zne', 1, 0).reason, 'Not enough Shots')
    assert.equal(g.canPlace('dd', 1, 0).reason, 'Not available in this level')
    assert.equal(g.canPlace('sampler', 1, 0).ok, true)
  })

  it('shovel removes a unit', () => {
    const g = new GameEngine(sandbox(), { seed: 1 })
    g.place('dd', 0, 0)
    assert.equal(g.remove(0, 0), true)
    assert.equal(g.unitAt(0, 0), null)
  })
})

describe('economy', () => {
  it('samplers drop tokens that can be clicked for shots', () => {
    const g = new GameEngine(sandbox(), { seed: 2 })
    g.place('sampler', 1, 1)
    const shots = g.shots
    step(g, UNITS.sampler.firstProduce + 1.5)
    const token = g.tokens.find((t) => t.source === 'sampler')
    assert.ok(token, 'sampler produced a token')
    assert.equal(g.collectAt(token.x + 5, token.y - 5), true)
    assert.equal(g.shots, shots + UNITS.sampler.value)
    assert.equal(g.collectAt(token.x, token.y), false, 'cannot collect twice')
  })

  it('sky tokens fall even without samplers', () => {
    const g = new GameEngine(sandbox(), { seed: 3 })
    step(g, 4)
    assert.ok(g.tokens.some((t) => t.source === 'sky'))
  })
})

describe('error types', () => {
  it('every error has a type and every type has exactly one counter', () => {
    for (const [id, def] of Object.entries(ENEMIES)) assert.ok(TYPE_ORDER.includes(def.errorType), id)
    for (const type of TYPE_ORDER) {
      const counters = TECHNIQUES.filter((t) => UNITS[t].strongVs === type)
      assert.deepEqual(counters, [COUNTER_FOR[type]], type)
    }
  })

  it('the right technique deals ×2 and the wrong one ×½', () => {
    for (const t of TECHNIQUES) {
      for (const type of TYPE_ORDER) {
        const expected = UNITS[t].strongVs === type ? EFFECTIVE_MULT : RESISTED_MULT
        assert.equal(typeMultiplier(t, type), expected, `${t} vs ${type}`)
      }
    }
  })

  it('damage() applies the type multiplier and records the matchup', () => {
    const g = new GameEngine(sandbox(), { seed: 1 })
    const e = g.spawnEnemy('depolarizer', 0, 1, 600)
    assert.equal(g.damage(e, 10, 'zne'), 'effective')
    assert.equal(e.maxHp - e.hp, 10 * EFFECTIVE_MULT)
    const hp = e.hp
    assert.equal(g.damage(e, 10, 'twirl'), 'resisted')
    assert.equal(hp - e.hp, 10 * RESISTED_MULT)
    assert.deepEqual(g.stats.hits, { effective: 1, resisted: 1 })
    assert.equal(g.matchupAccuracy(), 20 / 25)
  })
})

describe('techniques vs errors', () => {
  it('ZNE bolts destroy a depolarizer', () => {
    const g = new GameEngine(sandbox(), { seed: 4 })
    g.place('zne', 2, 0)
    const e = g.spawnEnemy('depolarizer', 2, 1, cellCenter(2, 8).x)
    step(g, 20)
    assert.equal(e.dead, true)
    assert.equal(g.qubits[2].fidelity, 100)
  })

  it('readout gremlins slip past gate-level defenders, taking only ×½ damage', () => {
    const g = new GameEngine(sandbox(), { seed: 5 })
    const dd = g.place('dd', 2, 3).unit
    const e = g.spawnEnemy('gremlin', 2, 1, cellCenter(2, 8).x)
    step(g, 40)
    assert.equal(e.dead, true)
    assert.equal(g.stats.leaks.gremlin, 1)
    assert.ok(g.qubits[2].fidelity < 100)
    assert.equal(dd.hp, dd.maxHp, 'gremlin did not stop to attack the DD')
    assert.equal(g.stats.hits.effective, 0)
    assert.ok(g.stats.hits.resisted > 0, 'but the DD hit it on the way past')
  })

  it('wrong-tool hits still add up: enough gate-level defenders can shoot a gremlin down', () => {
    const g = new GameEngine(sandbox(), { seed: 5 })
    g.place('zne', 2, 1)
    g.cards.forEach((c) => (c.cooldown = 0))
    g.place('dd', 2, 3)
    g.place('twirl', 2, 5)
    const e = g.spawnEnemy('gremlin', 2, 1, cellCenter(2, 8).x)
    step(g, 40)
    assert.equal(e.dead, true)
    assert.equal(g.stats.kills.gremlin, 1)
    assert.equal(g.stats.hits.effective, 0)
  })

  it('TREX blocks and bites readout errors for ×2, and gate errors for only ×½', () => {
    const g = new GameEngine(sandbox(), { seed: 6 })
    g.place('trex', 1, 2)
    const gremlin = g.spawnEnemy('gremlin', 1, 1, cellCenter(1, 6).x)
    step(g, 15)
    assert.equal(gremlin.dead, true)
    assert.equal(g.stats.kills.gremlin, 1)
    assert.equal(g.qubits[1].fidelity, 100)

    const trex = g.units[0]
    const dep = g.spawnEnemy('depolarizer', 1, 1, trex.x + 40)
    trex.timer = 0
    g.update(TICK)
    assert.ok(dep.attacking, 'it blocks gate errors')
    assert.equal(dep.maxHp - dep.hp, UNITS.trex.dmg * RESISTED_MULT, 'one weak bite')
  })

  it('TREX bites readout errors before closer gate errors', () => {
    const g = new GameEngine(sandbox(), { seed: 6 })
    g.place('trex', 1, 2)
    const x = cellCenter(1, 3).x
    const dep = g.spawnEnemy('depolarizer', 1, 1, x)
    const gremlin = g.spawnEnemy('gremlin', 1, 1, x + 40)
    g.units[0].timer = 0
    g.updateUnits(TICK)
    assert.equal(dep.hp, dep.maxHp)
    assert.equal(gremlin.maxHp - gremlin.hp, UNITS.trex.dmg * EFFECTIVE_MULT)
  })

  it('Pauli twirling strips coherent armor far faster than ZNE', () => {
    const timeToStrip = (type) => {
      const g = new GameEngine(sandbox(), { seed: 7 })
      g.place(type, 3, 0)
      const e = g.spawnEnemy('overRotator', 3, 1, cellCenter(3, 8).x)
      let t = 0
      while (e.armor > 0 && t < 120 && !e.dead) {
        e.x = cellCenter(3, 7).x // pin it in place
        g.update(TICK)
        t += TICK
      }
      return t
    }
    const twirl = timeToStrip('twirl')
    const zne = timeToStrip('zne')
    assert.ok(twirl * 2 < zne, `twirl ${twirl.toFixed(1)}s vs zne ${zne.toFixed(1)}s`)
  })

  it('breaking coherent armor turns the error into gate noise, and ZNE gets ×2 plus the twirled bonus', () => {
    const g = new GameEngine(sandbox(), { seed: 8 })
    const e = g.spawnEnemy('overRotator', 0, 1, 600)
    assert.equal(e.etype, 'coherent')
    assert.equal(g.damage(e, 20, 'zne'), 'resisted', 'ZNE is the wrong tool against coherent armor')
    g.damage(e, 1000, 'twirl')
    assert.equal(e.armor, 0)
    assert.equal(e.etype, 'gate')
    assert.ok(e.twirledT > 0)
    const hp = e.hp
    assert.equal(g.damage(e, 20, 'zne'), 'effective')
    assert.equal(hp - e.hp, 20 * EFFECTIVE_MULT * UNITS.zne.twirledBonus)
  })

  it('DD echo pulses refocus dephasers so bolts stop slipping through', () => {
    const g = new GameEngine(sandbox(), { seed: 9 })
    g.place('dd', 4, 4)
    const e = g.spawnEnemy('dephaser', 4, 1, cellCenter(4, 6).x)
    step(g, 0.5)
    assert.ok(e.refocusT > 0, 'dephaser refocused')
    assert.equal(e.outOfPhase, false)
    assert.ok(e.slowT > 0, 'and slowed')
    assert.equal(e.maxHp - e.hp, UNITS.dd.dmg * EFFECTIVE_MULT)
  })

  it('out-of-phase dephasers dodge projectiles', () => {
    const g = new GameEngine(sandbox(), { seed: 10 })
    const e = g.spawnEnemy('dephaser', 0, 1, 500)
    e.outOfPhase = true
    g.projectiles.push({ id: 999, kind: 'zne', row: 0, x: 495, y: 50, speed: 0, dmg: 50, passed: new Set(), spin: 0 })
    g.updateProjectiles(TICK)
    assert.equal(e.hp, e.maxHp)
    assert.equal(g.projectiles.length, 1, 'bolt kept flying')
  })

  it('ZZ hoppers jump to a neighbouring lane, unless DD has refocused them', () => {
    const g = new GameEngine(sandbox(), { seed: 12 })
    const e = g.spawnEnemy('zzHopper', 2, 1, cellCenter(2, 7).x)
    e.hopT = 0.01
    step(g, 0.1)
    assert.ok(e.row === 1 || e.row === 3, `hopped to row ${e.row}`)

    const f = g.spawnEnemy('zzHopper', 2, 1, cellCenter(2, 7).x)
    f.refocusT = 5
    f.hopT = 0.01
    step(g, 0.1)
    assert.equal(f.row, 2, 'refocused hopper stays put')
  })

  it('hoppers only hop onto active qubits', () => {
    const level = { ...sandbox(), rows: [1, 2, 3] }
    const g = new GameEngine(level, { seed: 13 })
    for (let i = 0; i < 20; i++) {
      const e = g.spawnEnemy('zzHopper', 1, 1, cellCenter(1, 7).x)
      g.hop(e)
      assert.equal(e.row, 2)
    }
  })

  it('a flip flock spawns one bird per neighbouring active lane', () => {
    const g = new GameEngine(sandbox(), { seed: 14 })
    assert.deepEqual(
      g.spawnGroup('flipFlock', 2).map((e) => e.row),
      [1, 2, 3],
    )
    assert.deepEqual(
      g.spawnGroup('flipFlock', 0).map((e) => e.row),
      [0, 1],
    )
    assert.equal(g.spawnGroup('depolarizer', 0).length, 1)
  })

  it('detuners build up coherent damage over time, and a twirl hit resets it', () => {
    const g = new GameEngine(sandbox(), { seed: 15 })
    const e = g.spawnEnemy('detuner', 3, 1, cellCenter(3, 8).x)
    const base = g.fidelityDamage(e)
    assert.equal(base, ENEMIES.detuner.fidelityDmg)
    step(g, ENEMIES.detuner.buildupTime + 1)
    assert.equal(e.buildup, 1)
    assert.equal(g.fidelityDamage(e), base * (1 + ENEMIES.detuner.buildupDmg))
    g.projectiles.push({ id: 999, kind: 'twirl', row: 3, x: e.x, y: e.y, speed: 0, dmg: 1, letter: 'X', passed: new Set(), spin: 0 })
    g.updateProjectiles(TICK)
    assert.equal(e.buildup, 0)
    assert.equal(g.fidelityDamage(e), base)
  })

  it('the colossus spills dephasers into neighbouring lanes', () => {
    const g = new GameEngine(sandbox(), { seed: 11 })
    g.spawnEnemy('colossus', 2, 1, cellCenter(2, 7).x)
    step(g, 8)
    const rows = new Set(g.enemies.filter((e) => e.type === 'dephaser').map((e) => e.row))
    assert.deepEqual([...rows].sort(), [1, 3])
  })
})

describe('levels', () => {
  it('every campaign level is lost with no defense', () => {
    for (const level of LEVELS) {
      const g = playLevel(level, 123, { bot: false })
      assert.equal(g.state, 'lost', `level ${level.id}`)
    }
  })

  for (const level of LEVELS) {
    it(`level ${level.id} (${level.name}) is winnable by a bot that matches error types`, () => {
      let wins = 0
      const seeds = [1, 2, 3, 4, 5]
      for (const seed of seeds) {
        const g = playLevel(level, seed)
        if (g.state === 'won') wins++
      }
      assert.ok(wins >= 4, `won ${wins}/${seeds.length}`)
    })
  }

  // The challenge: ignoring error types should not be enough.
  it('a type-blind ZNE-only bot loses every level after the first', () => {
    for (const level of LEVELS.slice(1)) {
      let wins = 0
      for (const seed of [1, 2, 3]) if (playLevel(level, seed, { act: zneOnlyBotAct }).state === 'won') wins++
      assert.equal(wins, 0, `level ${level.id}: won ${wins}/3`)
    }
  })

  it('answering errors with the wrong technique costs fidelity', () => {
    for (const level of LEVELS.slice(1)) {
      const avg = (act) => {
        let f = 0
        for (const seed of [1, 2, 3]) f += playLevel(level, seed, act ? { act } : {}).averageFidelity()
        return f / 3
      }
      const right = avg(null)
      const wrong = avg(wrongBotAct)
      assert.ok(wrong < right, `level ${level.id}: wrong ${wrong.toFixed(0)}% vs right ${right.toFixed(0)}%`)
    }
  })

  it('endless mode keeps generating waves', () => {
    const g = playLevel(ENDLESS, 42)
    assert.equal(g.state, 'lost')
    assert.ok(g.waveIndex >= 8, `survived ${g.waveIndex} waves`)
  })

  it('getLevel resolves ids', () => {
    assert.equal(getLevel(3).name, 'Measurement Mayhem')
    assert.equal(getLevel('endless'), ENDLESS)
  })
})
