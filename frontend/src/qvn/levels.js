// Campaign levels. Levels 1-4 each introduce an error type and the technique
// built for it, PvZ-style: you unlock a new "plant" every level. Levels 5-6
// bring a second, trickier error of each type, and level 7 is the boss.
//
// A wave is { spawn: { enemyId: count }, spread, gap, flag }:
//   spread - seconds over which the wave's errors trickle in
//   gap    - seconds until the next wave starts (it starts sooner if the board is cleared)
//   flag   - a "huge wave" with a warning banner

const w = (spawn, gap, opts = {}) => ({ spawn, gap, spread: 6, ...opts })

export const LEVELS = [
  {
    id: 1,
    name: 'Hello, Noise',
    subtitle: 'Stochastic noise & Zero-Noise Extrapolation',
    rows: [1, 2, 3],
    cards: ['sampler', 'zne'],
    startShots: 150,
    prepTime: 20,
    intro: {
      newErrors: ['depolarizer'],
      newUnits: ['sampler', 'zne'],
      text: 'Your qubits sit on the left. Errors march in from the right along each qubit\'s wire. If one reaches a qubit, it knocks down that qubit\'s fidelity (the length of its Bloch vector). If any qubit\'s fidelity hits 0%, the computation fails. Build Samplers to earn Shots, then spend them on ZNE to extrapolate the noise away.',
      typeRule: true,
    },
    waves: [
      w({ depolarizer: 1 }, 22),
      w({ depolarizer: 1 }, 18),
      w({ depolarizer: 2 }, 20),
      w({ depolarizer: 2 }, 18),
      w({ depolarizer: 4 }, 22, { flag: true, spread: 8 }),
      w({ depolarizer: 3 }, 20),
      w({ depolarizer: 7 }, 30, { flag: true, spread: 10 }),
    ],
    quiz: {
      q: 'How does Zero-Noise Extrapolation estimate the noise-free result?',
      options: [
        'It runs the circuit at several amplified noise levels and extrapolates back to zero noise',
        'It cools the qubits down to absolute zero temperature',
        'It throws away every measurement that looks noisy',
        'It encodes each qubit into many physical qubits',
      ],
      answer: 0,
      explain: 'ZNE deliberately amplifies noise (e.g. by gate folding: G → G·G†·G) to measure how the result changes with noise, then extrapolates the curve back to λ = 0.',
    },
  },
  {
    id: 2,
    name: 'Idle Hands',
    subtitle: 'Dephasing & Dynamical Decoupling',
    rows: [0, 1, 2, 3, 4],
    cards: ['sampler', 'zne', 'dd'],
    startShots: 150,
    prepTime: 20,
    intro: {
      newErrors: ['dephaser'],
      newUnits: ['dd'],
      text: 'All five qubits are online now. Dephasers are Idle noise, so ZNE only deals ×½ to them, and while they drift out of phase its bolts pass straight through. Dynamical Decoupling is built for Idle noise: its echo pulses always connect for ×2, refocus Dephasers and slow everything nearby. DD is also cheap and tough, so it makes a good wall in front of your ZNEs.',
    },
    waves: [
      w({ depolarizer: 1 }, 20),
      w({ dephaser: 1 }, 18),
      w({ depolarizer: 1, dephaser: 1 }, 18),
      w({ depolarizer: 1, dephaser: 3 }, 20),
      w({ depolarizer: 2, dephaser: 4 }, 24, { flag: true, spread: 8 }),
      w({ depolarizer: 2, dephaser: 4 }, 20),
      w({ depolarizer: 4, dephaser: 7 }, 30, { flag: true, spread: 10 }),
    ],
    quiz: {
      q: 'Dynamical decoupling protects a qubit mainly during…',
      options: [
        'Classical post-processing of the results',
        'Idle periods, using pulse sequences that multiply to the identity',
        'The final measurement',
        'Fabrication of the chip',
      ],
      answer: 1,
      explain: 'DD inserts sequences like X–X or XY4 into idle windows. They do nothing to the ideal state but echo away slowly varying phase noise and crosstalk.',
    },
  },
  {
    id: 3,
    name: 'Measurement Mayhem',
    subtitle: 'Readout errors & TREX',
    rows: [0, 1, 2, 3, 4],
    cards: ['sampler', 'zne', 'dd', 'trex'],
    startShots: 175,
    prepTime: 20,
    intro: {
      newErrors: ['gremlin'],
      newUnits: ['trex'],
      text: 'Readout Gremlins only strike at measurement, so they slip straight past ZNE and DD without stopping, and gate-level techniques only deal ×½ to them. TREX is built for Readout errors: it blocks them and bites for ×2. Watch which lanes they come down and get a TREX in front of them.',
    },
    waves: [
      w({ depolarizer: 1 }, 20),
      w({ gremlin: 1 }, 16),
      w({ depolarizer: 2, dephaser: 1 }, 18),
      w({ gremlin: 2, depolarizer: 1 }, 18),
      w({ depolarizer: 3, dephaser: 2, gremlin: 2 }, 24, { flag: true, spread: 8 }),
      w({ depolarizer: 2, dephaser: 2, gremlin: 2 }, 20),
      w({ depolarizer: 4, dephaser: 3, gremlin: 4 }, 30, { flag: true, spread: 10 }),
    ],
    quiz: {
      q: 'What does TREX do right before a measurement?',
      options: [
        'Measures every qubit twice and keeps the majority',
        'Applies a Hadamard gate to every qubit',
        'Randomly applies X gates, then flips those classical bits back afterwards',
        'Turns up the readout pulse power',
      ],
      answer: 2,
      explain: 'Random X flips (undone classically) twirl the readout noise into a single rescaling factor per observable, which a calibration run measures and divides out.',
    },
  },
  {
    id: 4,
    name: 'Coherent Chaos',
    subtitle: 'Coherent errors & Pauli Twirling',
    rows: [0, 1, 2, 3, 4],
    cards: ['sampler', 'zne', 'dd', 'trex', 'twirl'],
    startShots: 200,
    prepTime: 20,
    intro: {
      newErrors: ['overRotator'],
      newUnits: ['twirl'],
      text: 'Over-Rotators wear Coherent Armor. Pauli Twirling is built for Coherent errors and shreds the armor for ×2. Once it breaks, the Over-Rotator becomes ordinary Gate noise, so ZNE takes over at ×2, plus 50% against Twirled errors. This is the real-world combo: twirl the noise into Pauli form, then extrapolate it away.',
    },
    waves: [
      w({ depolarizer: 1 }, 20),
      w({ overRotator: 1 }, 20),
      w({ depolarizer: 2, dephaser: 1 }, 18),
      w({ overRotator: 1, gremlin: 1, depolarizer: 1 }, 20),
      w({ overRotator: 2, depolarizer: 3, dephaser: 1 }, 24, { flag: true, spread: 8 }),
      w({ overRotator: 2, gremlin: 2, dephaser: 2 }, 22),
      w({ overRotator: 4, depolarizer: 4, dephaser: 2, gremlin: 3 }, 30, { flag: true, spread: 12 }),
    ],
    quiz: {
      q: 'What is the main effect of Pauli twirling?',
      options: [
        'It removes all noise from the circuit',
        'It converts coherent errors into stochastic Pauli noise',
        'It makes gates run faster',
        'It corrects errors using ancilla qubits',
      ],
      answer: 1,
      explain: 'Twirling does not remove noise. It reshapes (tailors) it into a stochastic Pauli channel that accumulates gently and predictably, which ZNE and other mitigation methods need.',
    },
  },
  {
    id: 5,
    name: 'Heavy Gates',
    subtitle: 'Two-qubit gate errors & coherent detuning',
    rows: [0, 1, 2, 3, 4],
    cards: ['sampler', 'zne', 'dd', 'trex', 'twirl'],
    startShots: 250,
    prepTime: 20,
    intro: {
      newErrors: ['cnotCrusher', 'detuner'],
      newUnits: [],
      text: 'New errors, familiar types. Read each error\'s type badge, not its shape: the CNOT Crusher is Gate noise (just a lot of it), and the Detuner is a Coherent error that hits harder the longer it lives. The right technique deals ×2, any other only ×½.',
    },
    waves: [
      w({ depolarizer: 2 }, 18),
      w({ cnotCrusher: 1, depolarizer: 1 }, 20),
      w({ detuner: 2, depolarizer: 1 }, 20),
      w({ cnotCrusher: 1, overRotator: 1, detuner: 1, dephaser: 1 }, 22),
      w({ cnotCrusher: 2, detuner: 2, depolarizer: 3 }, 26, { flag: true, spread: 10 }),
      w({ detuner: 2, gremlin: 2, dephaser: 1, cnotCrusher: 1 }, 22),
      w({ cnotCrusher: 3, detuner: 4, overRotator: 1, depolarizer: 3, gremlin: 2 }, 32, { flag: true, spread: 14 }),
    ],
    quiz: {
      q: 'Which operations are usually the noisiest on today\'s quantum chips?',
      options: [
        'Single-qubit X gates',
        'Two-qubit entangling gates such as CNOT, CZ or ECR',
        'Virtual Z rotations',
        'Barriers in the circuit diagram',
      ],
      answer: 1,
      explain: 'Entangling gates make two qubits interact, take longer and are harder to calibrate, so their error rates are typically about ten times those of single-qubit gates. Virtual Z rotations are done in software by shifting the phase of later pulses, so they are essentially error-free.',
    },
  },
  {
    id: 6,
    name: 'Crosstalk Alley',
    subtitle: 'ZZ crosstalk & correlated readout errors',
    rows: [0, 1, 2, 3, 4],
    cards: ['sampler', 'zne', 'dd', 'trex', 'twirl'],
    startShots: 250,
    prepTime: 20,
    intro: {
      newErrors: ['zzHopper', 'flipFlock'],
      newUnits: [],
      text: 'These errors spread between neighbouring qubits. ZZ Hoppers (Idle noise) jump lanes unless DD refocuses them, and Flip Flocks (Readout) swoop down three lanes at once. Cover neighbouring lanes, not just the one where an error starts.',
    },
    waves: [
      w({ depolarizer: 2, zzHopper: 1 }, 18),
      w({ zzHopper: 2 }, 18),
      w({ flipFlock: 1, depolarizer: 2 }, 20),
      w({ zzHopper: 3, dephaser: 1, gremlin: 1 }, 22),
      w({ zzHopper: 3, flipFlock: 2, depolarizer: 2 }, 26, { flag: true, spread: 10 }),
      w({ flipFlock: 2, detuner: 1, dephaser: 2, zzHopper: 2 }, 22),
      w({ zzHopper: 4, flipFlock: 3, cnotCrusher: 1, overRotator: 1, depolarizer: 2, gremlin: 1 }, 32, { flag: true, spread: 14 }),
    ],
    quiz: {
      q: 'What is ZZ crosstalk?',
      options: [
        'An always-on coupling: the phase an idle qubit picks up depends on its neighbour\'s state',
        'Two measurement signals sharing one cable',
        'A gate that swaps two neighbouring qubits',
        'A compiler bug that duplicates Z gates',
      ],
      answer: 0,
      explain: 'Coupled qubits feel each other even when idle, so phase errors leak between neighbours. Dynamical decoupling sequences echo much of this ZZ phase away, which is why DD helps idle qubits that sit next to busy ones.',
    },
  },
  {
    id: 7,
    name: 'Full-Stack Mitigation',
    subtitle: 'Everything at once, plus a correlated boss',
    rows: [0, 1, 2, 3, 4],
    cards: ['sampler', 'zne', 'dd', 'trex', 'twirl'],
    startShots: 325,
    prepTime: 20,
    intro: {
      newErrors: ['colossus'],
      newUnits: [],
      text: 'Real experiments stack these techniques: DD and Pauli Twirling while the circuit runs (suppression), then TREX and ZNE in post-processing (mitigation). The Crosstalk Colossus arrives in the final wave. Twirl away its Coherent Armor, then hit it with ZNE, and keep DD ready for the Dephasers it spills into neighbouring lanes.',
    },
    waves: [
      w({ depolarizer: 2 }, 18),
      w({ dephaser: 1, gremlin: 1, zzHopper: 1 }, 18),
      w({ overRotator: 1, detuner: 1, depolarizer: 1 }, 20),
      w({ depolarizer: 2, dephaser: 2, flipFlock: 1, cnotCrusher: 1 }, 24, { flag: true, spread: 8 }),
      w({ overRotator: 2, gremlin: 2, dephaser: 1, detuner: 1 }, 22),
      w({ cnotCrusher: 1, depolarizer: 2, zzHopper: 2, flipFlock: 1, detuner: 1 }, 26),
      w({ colossus: 1, overRotator: 2, cnotCrusher: 1, depolarizer: 3, dephaser: 2, gremlin: 2, detuner: 1 }, 40, { flag: true, spread: 14 }),
    ],
    quiz: {
      q: 'Which pair are error SUPPRESSION techniques (they act while the circuit runs, rather than in post-processing)?',
      options: [
        'ZNE and TREX',
        'TREX and Dynamical Decoupling',
        'Dynamical Decoupling and Pauli Twirling',
        'ZNE and Pauli Twirling',
      ],
      answer: 2,
      explain: 'DD and twirling change the circuit that runs on the hardware (suppression). ZNE and TREX run extra circuits and post-process the results (mitigation).',
    },
  },
]

// Endless mode: waves are generated on the fly and get steadily nastier.
export const ENDLESS = {
  id: 'endless',
  name: 'Noise Storm',
  subtitle: 'Endless: how many waves can your qubits survive?',
  rows: [0, 1, 2, 3, 4],
  cards: ['sampler', 'zne', 'dd', 'trex', 'twirl'],
  startShots: 275,
  prepTime: 20,
  endless: true,
  intro: {
    newErrors: [],
    newUnits: [],
    text: 'Endless waves of every error type, growing stronger over time. Every 5th wave is a huge wave, and every 10th brings a Crosstalk Colossus. Your score is the number of waves survived.',
  },
  waves: [],
}

export function endlessWave(i) {
  const n = i + 1
  const spawn = { depolarizer: 1 + Math.floor(n / 2) }
  if (n >= 2) spawn.dephaser = Math.floor((n + 1) / 3)
  if (n >= 3) spawn.gremlin = Math.floor(n / 3)
  if (n >= 4) spawn.overRotator = Math.floor((n - 1) / 3)
  if (n >= 5) spawn.detuner = Math.floor((n - 2) / 4)
  if (n >= 6) spawn.zzHopper = Math.floor((n - 3) / 4)
  if (n >= 7) spawn.cnotCrusher = Math.floor((n - 3) / 5)
  if (n >= 8) spawn.flipFlock = Math.floor((n - 4) / 5)
  for (const k of Object.keys(spawn)) if (spawn[k] <= 0) delete spawn[k]
  const flag = n % 5 === 0
  if (n % 10 === 0) spawn.colossus = n / 10
  if (flag) for (const k of Object.keys(spawn)) if (k !== 'colossus') spawn[k] = Math.ceil(spawn[k] * 1.5)
  return { spawn, gap: flag ? 30 : 22, spread: flag ? 12 : 8, flag, hpScale: 1 + i * 0.04 }
}

export function getLevel(id) {
  if (id === 'endless') return ENDLESS
  return LEVELS.find((l) => l.id === id)
}

// Extra questions for the Almanac's practice quiz.
export const BONUS_QUIZ = [
  {
    q: 'Why does Pauli twirling pair so well with ZNE?',
    options: [
      'Twirling makes the circuit shorter, so there is less noise to extrapolate',
      'Stochastic Pauli noise grows smoothly and predictably when amplified, so the extrapolation fits well',
      'ZNE only works on a single qubit',
      'Twirling removes the need to amplify noise',
    ],
    answer: 1,
    explain: 'Coherent errors can interfere and make the noisy result oscillate as noise is amplified. After twirling, the decay is smooth, so the fit to λ = 0 is trustworthy.',
  },
  {
    q: 'What is the main cost of error mitigation methods like ZNE?',
    options: [
      'They need many extra physical qubits',
      'They need extra circuit executions (shots), and the estimate has larger variance',
      'They permanently damage the qubits',
      'They only work on classical computers',
    ],
    answer: 1,
    explain: 'Mitigation trades qubits for time: you pay in sampling overhead. Error correction, by contrast, pays in extra qubits.',
  },
  {
    q: 'Coherent over-rotation errors are especially harmful because…',
    options: [
      'They only happen during measurement',
      'Their amplitudes add up, so the error probability grows quadratically with the number of gates',
      'They cannot be described with quantum mechanics',
      'They only affect idle qubits',
    ],
    answer: 1,
    explain: 'A small angle ε repeated N times gives a rotation Nε, so the error probability goes as (Nε)². Random errors only add up as Nε².',
  },
  {
    q: 'Which error is the main target of TREX?',
    options: ['Gate over-rotations', 'Idle dephasing', 'Measurement (readout) bit-flips', 'Leakage out of the qubit subspace'],
    answer: 2,
    explain: 'TREX = Twirled Readout Error eXtinction. It mitigates errors in the measurement step only.',
  },
  {
    q: 'A dynamical decoupling sequence like XY4 (X–Y–X–Y) applied to an idle qubit…',
    options: [
      'Multiplies to (approximately) the identity, so the ideal state is unchanged',
      'Measures the qubit four times',
      'Rotates the qubit to |1⟩',
      'Entangles the qubit with its neighbours',
    ],
    answer: 0,
    explain: 'XYXY equals the identity (up to a global phase), so the ideal circuit is unchanged. Only the slow noise gets echoed away.',
  },
]
