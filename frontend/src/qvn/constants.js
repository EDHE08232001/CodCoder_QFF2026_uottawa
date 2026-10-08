// Battlefield geometry. Everything in the engine is measured in these
// logical pixels; the canvas is scaled to fit the screen afterwards.
export const ROWS = 5
export const COLS = 9
export const CELL_W = 90
export const CELL_H = 100
export const GRID_X = 130 // left strip holds the qubits (the "house")
export const GRID_Y = 0
export const FIELD_W = GRID_X + COLS * CELL_W + 80
export const FIELD_H = GRID_Y + ROWS * CELL_H

export const QUBIT_X = 58
export const QUBIT_LINE = GRID_X - 14 // an error crossing this x hits the qubit
export const SPAWN_X = GRID_X + COLS * CELL_W + 40
export const FIELD_RIGHT = GRID_X + COLS * CELL_W // errors are "on the board" left of this

export const TICK = 1 / 60
export const MAX_FIDELITY = 100

export function cellCenter(row, col) {
  return {
    x: GRID_X + col * CELL_W + CELL_W / 2,
    y: GRID_Y + row * CELL_H + CELL_H / 2,
  }
}

export function rowCenterY(row) {
  return GRID_Y + row * CELL_H + CELL_H / 2
}

export function cellAt(x, y) {
  const col = Math.floor((x - GRID_X) / CELL_W)
  const row = Math.floor((y - GRID_Y) / CELL_H)
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null
  return { row, col }
}
