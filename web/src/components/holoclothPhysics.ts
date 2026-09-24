// Adapted from Holocloth's Verlet cloth simulation by Dmitry Kurash.
// The renderer and material are intentionally different: this project uses the
// original towel PNG with a matte textile material and no holographic effects.

export type ClothPoint = { x: number; y: number; z: number }

export type ClothPhysicsParams = {
  viscosity: number
  stiffness: number
  iterations: number
  smoothing: number
}

type GrabState = {
  indices: number[]
  weights: number[]
  offsets: Float32Array
  target: ClothPoint
}

const SUBSTEP = 1 / 120
const MAX_SUBSTEPS = 4

/**
 * A compact adaptation of Holocloth's zero-gravity Verlet sheet.
 * Structural, shear and bend constraints make the image flex as one piece,
 * while a weak frame spring keeps the draggable UI control centred.
 */
export class HoloclothSim {
  readonly cols: number
  readonly rows: number
  readonly count: number
  readonly positions: Float32Array

  private readonly previous: Float32Array
  private readonly rest: Float32Array
  private readonly constraintA: Int32Array
  private readonly constraintB: Int32Array
  private readonly constraintRest: Float32Array
  private readonly constraintMultiplier: Float32Array
  private readonly neighbors: Int32Array
  private grab: GrabState | null = null
  private accumulator = 0

  constructor(
    readonly width: number,
    readonly height: number,
    readonly segX: number,
    readonly segY: number,
  ) {
    this.cols = segX + 1
    this.rows = segY + 1
    this.count = this.cols * this.rows
    this.positions = new Float32Array(this.count * 3)
    this.previous = new Float32Array(this.count * 3)
    this.rest = new Float32Array(this.count * 3)
    this.initializePose()

    const a: number[] = []
    const b: number[] = []
    const multiplier: number[] = []
    const index = (x: number, y: number) => y * this.cols + x

    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        if (x + 1 < this.cols) {
          a.push(index(x, y)); b.push(index(x + 1, y)); multiplier.push(1)
        }
        if (y + 1 < this.rows) {
          a.push(index(x, y)); b.push(index(x, y + 1)); multiplier.push(1)
        }
        if (x + 1 < this.cols && y + 1 < this.rows) {
          a.push(index(x, y)); b.push(index(x + 1, y + 1)); multiplier.push(0.85)
          a.push(index(x + 1, y)); b.push(index(x, y + 1)); multiplier.push(0.85)
        }
        if (x + 2 < this.cols) {
          a.push(index(x, y)); b.push(index(x + 2, y)); multiplier.push(0.35)
        }
        if (y + 2 < this.rows) {
          a.push(index(x, y)); b.push(index(x, y + 2)); multiplier.push(0.35)
        }
      }
    }

    this.constraintA = new Int32Array(a)
    this.constraintB = new Int32Array(b)
    this.constraintMultiplier = new Float32Array(multiplier)
    this.constraintRest = new Float32Array(a.length)
    this.computeConstraintLengths()

    this.neighbors = new Int32Array(this.count * 4).fill(-1)
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        const offset = index(x, y) * 4
        this.neighbors[offset] = x > 0 ? index(x - 1, y) : -1
        this.neighbors[offset + 1] = x + 1 < this.cols ? index(x + 1, y) : -1
        this.neighbors[offset + 2] = y > 0 ? index(x, y - 1) : -1
        this.neighbors[offset + 3] = y + 1 < this.rows ? index(x, y + 1) : -1
      }
    }
  }

  private initializePose() {
    let cursor = 0
    for (let y = 0; y < this.rows; y += 1) {
      const v = y / this.segY
      for (let x = 0; x < this.cols; x += 1) {
        const u = x / this.segX
        const edgeFade = Math.sin(Math.PI * u) * Math.sin(Math.PI * v)
        const baseX = (u - 0.5) * this.width
        const baseY = (v - 0.5) * this.height
        const billow = 0.035 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)
        const softFold = 0.018 * Math.sin(u * Math.PI * 3.4 + v * 2.1) * edgeFade
        const crossFold = 0.012 * Math.sin(v * Math.PI * 4.2 - u * 1.7) * edgeFade

        this.positions[cursor] = baseX + 0.012 * Math.sin(v * Math.PI * 2) * edgeFade
        this.positions[cursor + 1] = baseY + 0.009 * Math.sin(u * Math.PI * 3) * edgeFade
        this.positions[cursor + 2] = billow + softFold + crossFold
        cursor += 3
      }
    }
    this.previous.set(this.positions)
    this.rest.set(this.positions)
  }

  private computeConstraintLengths() {
    const stepX = this.width / this.segX
    const stepY = this.height / this.segY
    for (let c = 0; c < this.constraintA.length; c += 1) {
      const a = this.constraintA[c]
      const b = this.constraintB[c]
      const ax = a % this.cols
      const ay = Math.floor(a / this.cols)
      const bx = b % this.cols
      const by = Math.floor(b / this.cols)
      this.constraintRest[c] = Math.hypot((ax - bx) * stepX, (ay - by) * stepY)
    }
  }

  getPoint(index: number): ClothPoint {
    const offset = index * 3
    return {
      x: this.positions[offset],
      y: this.positions[offset + 1],
      z: this.positions[offset + 2],
    }
  }

  startGrab(point: ClothPoint, radius: number) {
    const indices: number[] = []
    const weights: number[] = []
    const offsets: number[] = []
    let best = Infinity

    for (let index = 0; index < this.count; index += 1) {
      const offset = index * 3
      const dx = this.positions[offset] - point.x
      const dy = this.positions[offset + 1] - point.y
      const dz = this.positions[offset + 2] - point.z
      const distance = Math.hypot(dx, dy, dz)
      best = Math.min(best, distance)
      if (distance > radius) continue
      const t = 1 - distance / radius
      const weight = t * t * (3 - 2 * t)
      indices.push(index)
      weights.push(weight)
      offsets.push(dx, dy, dz)
    }

    if (indices.length === 0 || best > radius) return false
    this.grab = {
      indices,
      weights,
      offsets: new Float32Array(offsets),
      target: { ...point },
    }
    return true
  }

  moveGrab(target: ClothPoint) {
    if (!this.grab) return
    this.grab.target.x = target.x
    this.grab.target.y = target.y
    this.grab.target.z = target.z
  }

  endGrab() {
    this.grab = null
  }

  step(delta: number, params: ClothPhysicsParams) {
    this.accumulator += Math.min(delta, 0.05)
    let steps = 0
    while (this.accumulator >= SUBSTEP && steps < MAX_SUBSTEPS) {
      this.substep(params)
      this.accumulator -= SUBSTEP
      steps += 1
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = 0
  }

  computeCavity(normals: Float32Array, output: Float32Array, gain = 4.5) {
    for (let index = 0; index < this.count; index += 1) {
      let averageX = 0
      let averageY = 0
      let averageZ = 0
      let count = 0
      for (let side = 0; side < 4; side += 1) {
        const neighbor = this.neighbors[index * 4 + side]
        if (neighbor < 0) continue
        averageX += this.positions[neighbor * 3]
        averageY += this.positions[neighbor * 3 + 1]
        averageZ += this.positions[neighbor * 3 + 2]
        count += 1
      }
      if (count === 0) {
        output[index] = 0
        continue
      }
      const positionOffset = index * 3
      const inverseCount = 1 / count
      const laplacianX = averageX * inverseCount - this.positions[positionOffset]
      const laplacianY = averageY * inverseCount - this.positions[positionOffset + 1]
      const laplacianZ = averageZ * inverseCount - this.positions[positionOffset + 2]
      const projected = laplacianX * normals[positionOffset]
        + laplacianY * normals[positionOffset + 1]
        + laplacianZ * normals[positionOffset + 2]
      output[index] = Math.min(1, Math.max(0, projected * gain / Math.min(
        this.width / this.segX,
        this.height / this.segY,
      )))
    }
  }

  private substep(params: ClothPhysicsParams) {
    const damping = Math.pow(1 - Math.min(params.viscosity, 0.99), SUBSTEP * 60)
    for (let index = 0; index < this.count * 3; index += 1) {
      const current = this.positions[index]
      const velocity = (current - this.previous[index]) * damping
      this.previous[index] = current
      this.positions[index] = current + velocity
    }

    if (params.smoothing > 0) this.smooth(params.smoothing * 0.5)

    const iterations = Math.max(1, Math.round(params.iterations))
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      this.solveConstraints(params.stiffness)
      this.applyGrab()
    }

    // Holocloth is free-floating. Here the cloth is itself a draggable UI
    // control, so remove only whole-sheet drift while preserving local folds.
    this.recenter(0.075)
    this.restorePose(this.grab ? 0.00035 : 0.0015)
  }

  private smooth(amount: number) {
    for (let index = 0; index < this.count; index += 1) {
      let averageX = 0
      let averageY = 0
      let averageZ = 0
      let count = 0
      for (let side = 0; side < 4; side += 1) {
        const neighbor = this.neighbors[index * 4 + side]
        if (neighbor < 0) continue
        averageX += this.positions[neighbor * 3]
        averageY += this.positions[neighbor * 3 + 1]
        averageZ += this.positions[neighbor * 3 + 2]
        count += 1
      }
      if (count === 0) continue
      const offset = index * 3
      const inverseCount = 1 / count
      this.positions[offset] += (averageX * inverseCount - this.positions[offset]) * amount
      this.positions[offset + 1] += (averageY * inverseCount - this.positions[offset + 1]) * amount
      this.positions[offset + 2] += (averageZ * inverseCount - this.positions[offset + 2]) * amount
    }
  }

  private solveConstraints(stiffness: number) {
    for (let index = 0; index < this.constraintA.length; index += 1) {
      const a = this.constraintA[index] * 3
      const b = this.constraintB[index] * 3
      const dx = this.positions[b] - this.positions[a]
      const dy = this.positions[b + 1] - this.positions[a + 1]
      const dz = this.positions[b + 2] - this.positions[a + 2]
      const distance = Math.hypot(dx, dy, dz)
      if (distance < 1e-9) continue
      const difference = ((distance - this.constraintRest[index]) / distance)
        * 0.5 * stiffness * this.constraintMultiplier[index]
      const offsetX = dx * difference
      const offsetY = dy * difference
      const offsetZ = dz * difference
      this.positions[a] += offsetX
      this.positions[a + 1] += offsetY
      this.positions[a + 2] += offsetZ
      this.positions[b] -= offsetX
      this.positions[b + 1] -= offsetY
      this.positions[b + 2] -= offsetZ
    }
  }

  private applyGrab() {
    if (!this.grab) return
    for (let index = 0; index < this.grab.indices.length; index += 1) {
      const positionOffset = this.grab.indices[index] * 3
      const grabOffset = index * 3
      const weight = this.grab.weights[index]
      const targetX = this.grab.target.x + this.grab.offsets[grabOffset]
      const targetY = this.grab.target.y + this.grab.offsets[grabOffset + 1]
      const targetZ = this.grab.target.z + this.grab.offsets[grabOffset + 2]
      this.positions[positionOffset] += (targetX - this.positions[positionOffset]) * weight
      this.positions[positionOffset + 1] += (targetY - this.positions[positionOffset + 1]) * weight
      this.positions[positionOffset + 2] += (targetZ - this.positions[positionOffset + 2]) * weight
    }
  }

  private recenter(amount: number) {
    let centerX = 0
    let centerY = 0
    for (let index = 0; index < this.count; index += 1) {
      centerX += this.positions[index * 3]
      centerY += this.positions[index * 3 + 1]
    }
    const correctionX = -(centerX / this.count) * amount
    const correctionY = -(centerY / this.count) * amount
    for (let index = 0; index < this.count; index += 1) {
      this.positions[index * 3] += correctionX
      this.positions[index * 3 + 1] += correctionY
    }
  }

  private restorePose(amount: number) {
    for (let index = 0; index < this.count * 3; index += 1) {
      this.positions[index] += (this.rest[index] - this.positions[index]) * amount
    }
  }
}
