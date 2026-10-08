// Defenders ("plants") and errors ("zombies"), with both their game stats
// and the physics they stand for. The text here feeds the lesson cards,
// tooltips and the Almanac, so keep it accurate.

export const CATEGORY_INFO = {
  economy: {
    label: 'Budget',
    color: '#ffd84a',
    text: 'Not a technique: it pays for them. Every mitigation method costs extra circuit executions (shots).',
  },
  suppression: {
    label: 'Suppression',
    color: '#b58cff',
    text: 'Error suppression changes how the circuit runs on the hardware, so errors are prevented or reshaped before they happen.',
  },
  mitigation: {
    label: 'Mitigation',
    color: '#3fe0d0',
    text: 'Error mitigation runs extra circuits and uses classical post-processing to estimate what the noise-free result would have been.',
  },
}

// ------------------------------------------------------------------ error types
//
// Every error belongs to one type, and every technique is built for exactly
// one type. Hitting an error with the technique built for its type deals
// EFFECTIVE_MULT damage; any other technique deals only RESISTED_MULT.
// Each type's color matches its counter's card, so players can match badges.

export const EFFECTIVE_MULT = 2
export const RESISTED_MULT = 0.5

export const ERROR_TYPES = {
  gate: {
    id: 'gate',
    label: 'Gate noise',
    glyph: 'G',
    color: '#3fe0d0',
    text: 'Random (stochastic) errors from imperfect gates. They build up smoothly as the circuit gets deeper.',
  },
  idle: {
    id: 'idle',
    label: 'Idle noise',
    glyph: 'φ',
    color: '#b58cff',
    text: 'Phase drift and crosstalk that a qubit picks up while it waits for other qubits to finish.',
  },
  readout: {
    id: 'readout',
    label: 'Readout',
    glyph: 'M',
    color: '#6dff9e',
    text: 'Bit-flips during the final measurement: a 1 recorded as 0, or a 0 as 1.',
  },
  coherent: {
    id: 'coherent',
    label: 'Coherent',
    glyph: 'θ',
    color: '#ffc04a',
    text: 'Systematic mis-rotations that are identical every time, so they add up quadratically.',
  },
}

export const TYPE_ORDER = ['gate', 'idle', 'readout', 'coherent']

export const UNITS = {
  sampler: {
    id: 'sampler',
    name: 'Shot Sampler',
    short: 'Sampler',
    category: 'economy',
    cost: 50,
    recharge: 7.5,
    hp: 250,
    firstProduce: 5,
    produceEvery: 15,
    value: 25,
    role: 'Produces 25 Shots every 15 seconds. Click the glowing tokens to collect them.',
    lesson:
      'Real quantum computers answer questions statistically: you run the same circuit thousands of times ("shots") and average the measurements. Error mitigation is never free. Each technique needs extra shots or extra circuits, so your shot budget is the currency of this game.',
  },
  zne: {
    id: 'zne',
    name: 'Zero-Noise Extrapolation',
    short: 'ZNE',
    category: 'mitigation',
    strongVs: 'gate',
    cost: 125,
    recharge: 7.5,
    hp: 300,
    fireEvery: 1.6,
    dmgMin: 7,
    dmgMax: 17,
    twirledBonus: 1.5,
    projectileSpeed: 330,
    role: 'Fires extrapolation bolts down its lane. Damage varies from shot to shot. It deals +50% damage to Twirled errors.',
    lesson:
      "You can't turn the noise down, but you can turn it up. ZNE runs the same circuit at several amplified noise levels (λ = 1, 3, 5), for example by \"gate folding\" (replacing a gate G with G·G†·G, which does the same thing but picks up 3x the noise). It measures how the answer degrades as noise grows, fits a curve, and extrapolates back to λ = 0: the zero-noise answer. The catch: more circuit runs, and the extrapolated estimate has higher variance. It also works best when noise grows smoothly, which coherent errors don't do.",
  },
  dd: {
    id: 'dd',
    name: 'Dynamical Decoupling',
    short: 'DD',
    category: 'suppression',
    strongVs: 'idle',
    cost: 50,
    recharge: 12,
    hp: 650,
    pulseEvery: 2.2,
    range: 2.6, // cells ahead of the unit
    dmg: 18,
    slow: 0.5,
    slowTime: 2,
    refocusTime: 5,
    role: 'Sturdy and cheap. Emits echo pulses that hit every error within ~2.5 tiles and slow them down. Pulses refocus Idle errors: Dephasers stop dodging and ZZ Hoppers can\'t hop.',
    lesson:
      'Qubits that sit idle, waiting for other qubits to finish their gates, still pick up phase errors from their environment and from always-on ZZ crosstalk with neighbours. Dynamical decoupling fills those idle windows with pulse sequences such as X–X or XY4 (X–Y–X–Y) that multiply to the identity. Each flip makes the phase picked up in the next interval cancel the phase picked up in the previous one, like a spin echo. It needs no extra circuits, so it is nearly free.',
  },
  trex: {
    id: 'trex',
    name: 'TREX (Twirled Readout Error eXtinction)',
    short: 'TREX',
    category: 'mitigation',
    strongVs: 'readout',
    cost: 75,
    recharge: 10,
    hp: 320,
    biteEvery: 1.0,
    range: 1.6, // cells ahead of the unit
    dmg: 45,
    role: 'Blocks errors and bites them at short range, going for Readout errors first. It is the only defender Readout errors can\'t slip past.',
    lesson:
      'Measurement is noisy too: a qubit in |1⟩ is sometimes read as 0 (more often than 0 is read as 1, because the qubit can decay during the readout). TREX randomly applies an X gate right before some measurements and flips those classical bits back afterwards. Averaged over many random flips, this "twirls" the readout noise into a simple form: each expectation value gets shrunk by a single factor. That factor is learned from cheap calibration circuits and divided out. It needs no detailed noise model, and the overhead is modest.',
  },
  twirl: {
    id: 'twirl',
    name: 'Pauli Twirling',
    short: 'Twirl',
    category: 'suppression',
    strongVs: 'coherent',
    cost: 100,
    recharge: 10,
    hp: 300,
    fireEvery: 1.4,
    dmg: 10,
    twirlTime: 6,
    projectileSpeed: 290,
    role: 'Throws random Pauli darts (X, Y, Z) that mark errors as Twirled, so ZNE deals +50% to them. Twirl hits also scramble a Detuner\'s coherent build-up.',
    lesson:
      'Sandwich each noisy two-qubit gate between randomly chosen Pauli gates (I, X, Y, Z): one set before, and a matching set after that undoes them, so the ideal gate is unchanged. Averaged over many random choices, any noise, including coherent over-rotations that interfere and pile up quadratically, turns into stochastic Pauli noise: X, Y or Z errors that strike with fixed probabilities. Pauli noise builds up slowly and predictably, which is exactly what ZNE needs to extrapolate reliably.',
  },
}

export const UNIT_ORDER = ['sampler', 'zne', 'dd', 'trex', 'twirl']
export const TECHNIQUES = ['zne', 'dd', 'trex', 'twirl']

// The technique built for each error type, e.g. COUNTER_FOR.gate === 'zne'.
export const COUNTER_FOR = Object.fromEntries(TECHNIQUES.map((id) => [UNITS[id].strongVs, id]))

// 'effective' if `unitType` is built for `errorType`, otherwise 'resisted'.
export function matchup(unitType, errorType) {
  return UNITS[unitType]?.strongVs === errorType ? 'effective' : 'resisted'
}

export function typeMultiplier(unitType, errorType) {
  return matchup(unitType, errorType) === 'effective' ? EFFECTIVE_MULT : RESISTED_MULT
}

// 2 -> '×2', 0.5 -> '×½'
export function formatMult(m) {
  return m === 0.5 ? '×½' : `×${m}`
}

export const ENEMIES = {
  depolarizer: {
    id: 'depolarizer',
    name: 'Depolarizer',
    kind: 'Stochastic (depolarizing) gate noise',
    errorType: 'gate',
    hp: 110,
    speed: 16,
    dps: 25,
    fidelityDmg: 25,
    radius: 26,
    lesson:
      "After each gate, a random Pauli error (X, Y or Z) strikes with some small probability. On the Bloch sphere, this shrinks the qubit's state vector toward the center (the maximally mixed state). This is the everyday noise of every quantum chip, and it grows smoothly with circuit depth, which makes it the ideal target for extrapolation.",
    tip: 'Depolarizers are Gate noise. Line their lanes with ZNE; it extrapolates smooth, random noise away best.',
  },
  cnotCrusher: {
    id: 'cnotCrusher',
    name: 'CNOT Crusher',
    kind: 'Two-qubit gate error',
    errorType: 'gate',
    hp: 340,
    speed: 11,
    dps: 40,
    fidelityDmg: 40,
    radius: 32,
    lesson:
      'Entangling gates such as CNOT, CZ or ECR make two qubits interact. They take longer than single-qubit gates and are harder to calibrate, so they are typically about ten times noisier. That noise is still mostly stochastic: it grows smoothly as you add gates, so ZNE can extrapolate it away. There is just a lot more of it, so the Crusher is big, slow and very tough.',
    tip: 'CNOT Crushers are Gate noise in bulk. Stack ZNE in their lane, and put a DD wall in front to hold them while it fires.',
  },
  dephaser: {
    id: 'dephaser',
    name: 'Dephaser',
    kind: 'Idle dephasing',
    errorType: 'idle',
    hp: 150,
    speed: 17,
    dps: 20,
    fidelityDmg: 25,
    radius: 24,
    phasePeriod: 3,
    outOfPhaseFrac: 0.6,
    driftTime: 18, // seconds without refocusing until it moves at double speed
    lesson:
      "While a qubit waits for others to finish, slow environmental noise makes its phase drift. On the Bloch sphere, the state vector precesses around the equator. In the game it drifts in and out of phase: while out of phase, bolts and darts pass right through it. The longer it goes without being refocused, the more phase it accumulates and the faster it moves. DD's echo pulses always connect, and they refocus it so everything else can hit it again.",
    tip: 'Dephasers are Idle noise: they drift out of phase, dodge projectiles and speed up as their phase drift builds. Dynamical Decoupling deals ×2 to them and refocuses them.',
  },
  zzHopper: {
    id: 'zzHopper',
    name: 'ZZ Hopper',
    kind: 'Idle ZZ crosstalk',
    errorType: 'idle',
    hp: 190,
    speed: 16,
    dps: 20,
    fidelityDmg: 25,
    radius: 24,
    hopEvery: 5,
    lesson:
      "Neighbouring qubits stay coupled even when no gate asks them to interact. With an always-on ZZ interaction, the phase an idle qubit picks up depends on whether its neighbour is in |0⟩ or |1⟩, so noise leaks from one wire to the next. The Hopper jumps to a neighbouring qubit's wire every few seconds. DD echo pulses cancel that ZZ phase, so a refocused Hopper can't hop.",
    tip: 'ZZ Hoppers are Idle noise that jump between neighbouring lanes. DD deals ×2 to them and refocuses them so they stay put. Cover adjacent lanes too.',
  },
  gremlin: {
    id: 'gremlin',
    name: 'Readout Gremlin',
    kind: 'Measurement (readout) error',
    errorType: 'readout',
    hp: 180,
    speed: 30,
    dps: 30,
    fidelityDmg: 25,
    radius: 18,
    ghost: true,
    lesson:
      'It strikes at the very end of the circuit: when you measure, a 1 gets recorded as a 0 or vice versa. Gate-level techniques barely touch it, and it slips straight past ZNE, DD and Twirling without stopping. Only a readout technique stops it.',
    tip: 'Readout Gremlins slip past every gate-level defense. Only TREX blocks them, and it bites them for ×2 damage. Place it in their lane.',
  },
  flipFlock: {
    id: 'flipFlock',
    name: 'Flip Flock',
    kind: 'Correlated readout errors',
    errorType: 'readout',
    hp: 90,
    speed: 36,
    dps: 15,
    fidelityDmg: 15,
    radius: 15,
    ghost: true,
    flock: true, // one spawn = one bird in its lane and in each neighbouring lane
    lesson:
      'Qubits are usually measured at the same time, and their readout signals can bleed into each other (readout crosstalk). So bit-flips tend to arrive in bunches across neighbouring qubits. A Flock swoops down three neighbouring wires at once. Like every readout error it slips past gate-level defenders, and TREX copes with it because its calibration measures the readout scaling factor for each observable directly.',
    tip: 'Flip Flocks hit three neighbouring lanes at once and slip past everything except TREX. Cover adjacent lanes with TREX.',
  },
  overRotator: {
    id: 'overRotator',
    name: 'Over-Rotator',
    kind: 'Coherent error (systematic over-rotation)',
    errorType: 'coherent',
    decaysTo: 'gate', // when the coherent armor breaks
    hp: 110,
    armor: 260,
    speed: 13,
    dps: 40,
    fidelityDmg: 40,
    radius: 27,
    lesson:
      "A miscalibrated gate that rotates by θ + ε instead of θ, every single time. Because the error is the same each time, the small amplitudes add up coherently: after N gates the error probability grows like (Nε)², much faster than random noise (Nε²). Its Coherent Armor shrugs off ZNE, because coherent errors don't degrade smoothly when amplified, so the extrapolation fit goes wrong. Once the armor breaks, what's left is ordinary stochastic Gate noise.",
    tip: 'Over-Rotators wear Coherent Armor. Pauli Twirling deals ×2 to it; once it breaks they turn into Gate noise, and ZNE finishes them off.',
  },
  detuner: {
    id: 'detuner',
    name: 'Detuner',
    kind: 'Coherent frequency miscalibration',
    errorType: 'coherent',
    hp: 200,
    speed: 17,
    dps: 25,
    fidelityDmg: 15,
    radius: 24,
    buildupTime: 18, // seconds on the board until its build-up is maxed
    buildupDmg: 2, // extra fidelity damage at full build-up, as a multiple of fidelityDmg
    buildupSpeed: 0.6, // extra speed at full build-up
    lesson:
      "If a qubit's drive frequency is slightly off, every gate adds a tiny extra Z rotation ε. Because that error is identical every time, it adds up coherently: after N gates the angle is Nε, and the error probability grows like (Nε)². The longer a Detuner survives, the faster it moves and the harder it hits (up to 3×). Pauli Twirling scrambles the build-up: random Paulis stop the small rotations from lining up, so each Twirl hit resets it.",
    tip: 'Detuners are Coherent errors that grow stronger every second you leave them alone. Pauli Twirling deals ×2 to them and resets their build-up.',
  },
  colossus: {
    id: 'colossus',
    name: 'Crosstalk Colossus',
    kind: 'Correlated multi-qubit error (boss)',
    errorType: 'coherent',
    decaysTo: 'gate',
    hp: 1400,
    armor: 600,
    speed: 6,
    dps: 80,
    fidelityDmg: 100,
    radius: 46,
    boss: true,
    spawnEvery: 7,
    lesson:
      'Some errors are correlated: driving one qubit disturbs its neighbours. The Colossus is a heavily armored coherent error that keeps spilling Dephasers into the lanes above and below it. Strip its Coherent Armor with Twirling, refocus the spill-over with DD, then pour on ZNE once it has turned into Gate noise.',
    tip: 'The Colossus needs teamwork: Pauli Twirling for its Coherent Armor, ZNE once it turns into Gate noise, and DD in neighbouring lanes for the Dephasers it spawns.',
  },
}

export const ENEMY_ORDER = ['depolarizer', 'cnotCrusher', 'dephaser', 'zzHopper', 'gremlin', 'flipFlock', 'overRotator', 'detuner', 'colossus']

// Extra rules that sit on top of the ×2 / ×½ type chart, for the Almanac.
export const SPECIAL_RULES = [
  { unit: 'dd', text: 'Echo pulses hit everything nearby and slow it. Idle errors also get refocused: Dephasers stop dodging and ZZ Hoppers stop hopping.' },
  { unit: 'twirl', text: 'Darts mark errors as Twirled: ZNE deals +50% to them. Twirl hits also reset a Detuner\'s build-up.' },
  { unit: 'trex', text: 'The only defender that Readout errors can\'t slip past. It bites Readout errors first.' },
  { unit: 'zne', text: 'Breaking an Over-Rotator\'s or the Colossus\'s Coherent Armor turns it into Gate noise, so ZNE deals ×2 from then on.' },
]
