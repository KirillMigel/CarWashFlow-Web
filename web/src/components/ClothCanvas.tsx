import { useEffect, useRef, useState } from 'react'

type Props = {
  velocity: { x: number; y: number }
  dragging: boolean
}

// Physics and fold-lighting adapted from Canvas UI Cloth by David Haz.
// The html-in-canvas capture was intentionally replaced with a regular PNG texture,
// so this version works on GitHub Pages and inside an iOS WKWebView without an origin trial.
const SEGMENTS = 48
const NODES = SEGMENTS + 1
const STEP = 1 / 120
const WAVE_SPEED = 30
const STIFFNESS = 0.55
const FORCE_GAIN = 5
const BLEED = 28

const vertexShaderSource = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aGrid;
layout(location = 1) in vec4 aData;
layout(location = 2) in vec2 aOffset;

uniform vec2 uResolution;
uniform vec2 uOutput;
uniform float uBleed;
uniform float uFocal;

out vec2 vUV;
out vec3 vNormal;
out float vFold;

void main() {
  vUV = aGrid;
  float z = aData.x;
  vec2 normalXY = aData.yz;
  vNormal = vec3(normalXY, sqrt(max(1.0 - dot(normalXY, normalXY), 0.04)));
  vFold = aData.w;

  vec2 pixel = aGrid * uResolution + aOffset + vec2(uBleed);
  vec2 ndc = (pixel / uOutput) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  float perspective = (uFocal - z) / uFocal;
  gl_Position = vec4(ndc, -z / uFocal, perspective);
}
`

const fragmentShaderSource = `#version 300 es
precision highp float;

in vec2 vUV;
in vec3 vNormal;
in float vFold;

uniform sampler2D uTexture;
uniform float uLight;
uniform float uSheen;

out vec4 outColor;

void main() {
  vec4 textureColor = texture(uTexture, vUV);
  if (textureColor.a < 0.01) discard;

  vec3 normal = normalize(vNormal);
  vec3 lightDirection = normalize(vec3(-0.3, 0.42, 0.86));
  float flatDiffuse = 0.58 + 0.42 * lightDirection.z;
  float diffuse = 0.58 + 0.42 * dot(normal, lightDirection);
  float shade = mix(1.0, (diffuse / flatDiffuse) * vFold, uLight);
  vec3 lit = textureColor.rgb * shade;

  vec3 halfway = normalize(lightDirection + vec3(0.0, 0.0, 1.0));
  float flatSpecular = pow(halfway.z, 34.0);
  float specular = max(
    pow(max(dot(normal, halfway), 0.0), 34.0) - flatSpecular,
    0.0
  ) / (1.0 - flatSpecular);
  lit += uSheen * specular * mix(vec3(1.0), textureColor.rgb, 0.35);

  outColor = vec4(clamp(lit, 0.0, 1.0), textureColor.a);
}
`

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Cloth shader error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createProgram(gl: WebGL2RenderingContext) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
  if (!vertexShader || !fragmentShader) return null

  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Cloth program error:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }
  return program
}

function createGrid() {
  const vertices = new Float32Array(NODES * NODES * 2)
  for (let row = 0; row < NODES; row += 1) {
    for (let column = 0; column < NODES; column += 1) {
      const index = (row * NODES + column) * 2
      vertices[index] = column / SEGMENTS
      vertices[index + 1] = row / SEGMENTS
    }
  }

  const indices = new Uint16Array(SEGMENTS * SEGMENTS * 6)
  let offset = 0
  for (let row = 0; row < SEGMENTS; row += 1) {
    for (let column = 0; column < SEGMENTS; column += 1) {
      const topLeft = row * NODES + column
      const topRight = topLeft + 1
      const bottomLeft = topLeft + NODES
      const bottomRight = bottomLeft + 1
      indices[offset++] = topLeft
      indices[offset++] = bottomLeft
      indices[offset++] = topRight
      indices[offset++] = topRight
      indices[offset++] = bottomLeft
      indices[offset++] = bottomRight
    }
  }

  return { vertices, indices }
}

export function ClothCanvas({ velocity, dragging }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const motionRef = useRef({ velocity, dragging })
  const [ready, setReady] = useState(false)
  motionRef.current = { velocity, dragging }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    })
    if (!gl || gl.isContextLost()) return

    const program = createProgram(gl)
    if (!program) return

    const grid = createGrid()
    const vertexArray = gl.createVertexArray()
    const gridBuffer = gl.createBuffer()
    const dataBuffer = gl.createBuffer()
    const offsetBuffer = gl.createBuffer()
    const indexBuffer = gl.createBuffer()
    const texture = gl.createTexture()
    if (!vertexArray || !gridBuffer || !dataBuffer || !offsetBuffer || !indexBuffer || !texture) {
      gl.deleteProgram(program)
      return
    }

    gl.bindVertexArray(vertexArray)

    gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, grid.vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, dataBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, NODES * NODES * 4 * 4, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, NODES * NODES * 2 * 4, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, grid.indices, gl.STATIC_DRAW)
    gl.bindVertexArray(null)

    const resolutionLocation = gl.getUniformLocation(program, 'uResolution')
    const outputLocation = gl.getUniformLocation(program, 'uOutput')
    const bleedLocation = gl.getUniformLocation(program, 'uBleed')
    const focalLocation = gl.getUniformLocation(program, 'uFocal')
    const textureLocation = gl.getUniformLocation(program, 'uTexture')
    const lightLocation = gl.getUniformLocation(program, 'uLight')
    const sheenLocation = gl.getUniformLocation(program, 'uSheen')

    const heightCurrent = new Float32Array(NODES * NODES)
    let heightPrevious = new Float32Array(NODES * NODES)
    let heightNext = new Float32Array(NODES * NODES)
    const vertexData = new Float32Array(NODES * NODES * 4)
    const offsetData = new Float32Array(NODES * NODES * 2)
    const depthField = new Float32Array(NODES * NODES)
    const rowForce = new Float32Array(NODES)
    const columnForce = new Float32Array(NODES)
    const hangCurve = new Float32Array(NODES)
    for (let index = 0; index < NODES; index += 1) {
      hangCurve[index] = Math.pow(index / SEGMENTS, 1.3)
    }

    let current = heightCurrent
    let simulationTime = Math.random() * 60
    let gust = 0.55
    let dragStrength = 0
    let textureReady = false
    let didAnnounceReady = false
    let disposed = false
    let animationFrame = 0
    let previousTime = performance.now()
    let simulationDebt = 0

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = motionQuery.matches
    const handleMotionPreference = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
    }
    motionQuery.addEventListener?.('change', handleMotionPreference)

    const syncCanvasSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
    }

    const stepSimulation = (delta: number) => {
      simulationTime += delta * 0.82
      const wind = FORCE_GAIN * 2.8 * gust
      const firstWave = (Math.PI * 2) / (SEGMENTS / 1.5)
      const secondWave = (Math.PI * 2) / (SEGMENTS / 3.8)
      const crossWave = (Math.PI * 2) / (SEGMENTS / 2.2)
      const drift = 1.8 * Math.sin(0.23 * simulationTime)

      for (let index = 0; index < NODES; index += 1) {
        rowForce[index] = Math.sin(
          firstWave * index - WAVE_SPEED * firstWave * simulationTime + drift,
        ) + 0.45 * Math.sin(
          secondWave * index + WAVE_SPEED * secondWave * simulationTime * 0.8 + 3,
        )
        columnForce[index] = (
          0.7 + 0.3 * Math.sin(crossWave * index - 1.7 * simulationTime)
        ) * hangCurve[index]
      }

      const speedSquared = WAVE_SPEED * WAVE_SPEED
      const deltaSquared = delta * delta
      const decay = Math.exp(-1.18 * delta)

      for (let row = 0; row < NODES; row += 1) {
        const up = Math.max(row - 1, 0) * NODES
        const down = Math.min(row + 1, SEGMENTS) * NODES
        const rowStart = row * NODES
        for (let column = 0; column < NODES; column += 1) {
          const index = rowStart + column
          const left = rowStart + Math.max(column - 1, 0)
          const right = rowStart + Math.min(column + 1, SEGMENTS)
          const height = current[index]
          const laplacian = current[left] + current[right]
            + current[up + column] + current[down + column] - 4 * height
          const force = wind * rowForce[column] * columnForce[row]
          const acceleration = speedSquared * laplacian - STIFFNESS * height + force
          const next = 2 * height - heightPrevious[index] + deltaSquared * acceleration
          heightNext[index] = Math.max(-3.5, Math.min(3.5, height + (next - height) * decay))
        }
      }

      // The cloth is held along its top edge, matching Canvas UI's pin="top" preset.
      for (let column = 0; column < NODES; column += 1) {
        heightNext[column] = 0
      }

      const spent = heightPrevious
      heightPrevious = current
      current = heightNext
      heightNext = spent
    }

    const applyDragImpulse = (delta: number, width: number, height: number) => {
      const motion = motionRef.current
      const velocityLength = Math.hypot(motion.velocity.x, motion.velocity.y)
      const velocityEnergy = Math.min(velocityLength / 20, 1.6)
      const targetStrength = motion.dragging ? Math.max(0.42, velocityEnergy) : 0
      const response = motion.dragging ? 8 : 2.5
      dragStrength += (targetStrength - dragStrength) * Math.min(delta * response, 1)
      if (dragStrength < 0.01) return

      const cellWidth = width / SEGMENTS
      const cellHeight = height / SEGMENTS
      const radius = Math.max(Math.min(width, height) * 0.36, 44)
      const radiusX = radius / cellWidth
      const radiusY = radius / cellHeight
      const centerX = SEGMENTS * 0.5 - Math.max(-1, Math.min(1, motion.velocity.x / 34)) * 4
      const centerY = SEGMENTS * 0.5 - Math.max(-1, Math.min(1, motion.velocity.y / 34)) * 3
      const minX = Math.max(Math.ceil(centerX - 2.5 * radiusX), 0)
      const maxX = Math.min(Math.floor(centerX + 2.5 * radiusX), SEGMENTS)
      const minY = Math.max(Math.ceil(centerY - 2.5 * radiusY), 1)
      const maxY = Math.min(Math.floor(centerY + 2.5 * radiusY), SEGMENTS)
      const lift = (0.75 + velocityEnergy * 1.05) * dragStrength
      const rate = Math.min(delta * 6, 1)

      for (let row = minY; row <= maxY; row += 1) {
        const offsetY = (row - centerY) / radiusY
        const rowStart = row * NODES
        for (let column = minX; column <= maxX; column += 1) {
          const offsetX = (column - centerX) / radiusX
          const gaussian = Math.exp(-(offsetX * offsetX + offsetY * offsetY))
          if (gaussian < 0.02) continue
          const index = rowStart + column
          const goal = lift * gaussian
          const pull = rate * gaussian
          current[index] += (goal - current[index]) * pull
          heightPrevious[index] += (goal - heightPrevious[index]) * pull * 0.72
        }
      }
    }

    const foreshorten = (
      axisStride: number,
      lineStride: number,
      spacing: number,
      anchor: number,
      component: number,
    ) => {
      const spacingSquared = spacing * spacing
      for (let line = 0; line < NODES; line += 1) {
        const base = line * lineStride
        offsetData[(base + anchor * axisStride) * 2 + component] = 0
        let accumulated = 0
        for (let step = anchor + 1; step < NODES; step += 1) {
          const index = base + step * axisStride
          const depth = depthField[index] - depthField[index - axisStride]
          accumulated += spacing - Math.sqrt(Math.max(spacingSquared - depth * depth, 0))
          offsetData[index * 2 + component] = -accumulated
        }
        accumulated = 0
        for (let step = anchor - 1; step >= 0; step -= 1) {
          const index = base + step * axisStride
          const depth = depthField[index] - depthField[index + axisStride]
          accumulated += spacing - Math.sqrt(Math.max(spacingSquared - depth * depth, 0))
          offsetData[index * 2 + component] = accumulated
        }
      }
    }

    const composeVertices = (width: number, height: number) => {
      const amplitude = 24
      const drape = 22 * (0.3 + 0.7 * gust)
      const cellWidth = width / SEGMENTS
      const cellHeight = height / SEGMENTS

      for (let row = 0; row < NODES; row += 1) {
        const rowStart = row * NODES
        for (let column = 0; column < NODES; column += 1) {
          const index = rowStart + column
          depthField[index] = amplitude * Math.tanh(current[index]) + drape * hangCurve[row]
        }
      }

      for (let row = 0; row < NODES; row += 1) {
        const up = Math.max(row - 1, 0) * NODES
        const down = Math.min(row + 1, SEGMENTS) * NODES
        const rowStart = row * NODES
        for (let column = 0; column < NODES; column += 1) {
          const index = rowStart + column
          const left = rowStart + Math.max(column - 1, 0)
          const right = rowStart + Math.min(column + 1, SEGMENTS)
          const depthX = (depthField[right] - depthField[left]) / (2 * cellWidth)
          const depthY = (depthField[down + column] - depthField[up + column]) / (2 * cellHeight)
          const inverseLength = 1 / Math.hypot(depthX, depthY, 1)
          const curve = depthField[left] + depthField[right]
            + depthField[up + column] + depthField[down + column] - 4 * depthField[index]
          const fold = Math.max(0.86, Math.min(1.06, 1 - curve * 0.01))
          const dataOffset = index * 4
          vertexData[dataOffset] = depthField[index]
          vertexData[dataOffset + 1] = -depthX * inverseLength
          vertexData[dataOffset + 2] = -depthY * inverseLength
          vertexData[dataOffset + 3] = fold
        }
      }

      foreshorten(NODES, 1, cellHeight, 0, 1)
      foreshorten(1, NODES, cellWidth, SEGMENTS >> 1, 0)
    }

    const render = (width: number, height: number) => {
      const outputWidth = Math.max(canvas.clientWidth, 1)
      const outputHeight = Math.max(canvas.clientHeight, 1)

      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

      gl.bindVertexArray(vertexArray)
      gl.bindBuffer(gl.ARRAY_BUFFER, dataBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertexData)
      gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, offsetData)

      gl.useProgram(program)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.uniform1i(textureLocation, 0)
      gl.uniform2f(resolutionLocation, width, height)
      gl.uniform2f(outputLocation, outputWidth, outputHeight)
      gl.uniform1f(bleedLocation, BLEED)
      gl.uniform1f(focalLocation, 900)
      gl.uniform1f(lightLocation, 0.62)
      gl.uniform1f(sheenLocation, 0.18)
      gl.drawElements(gl.TRIANGLES, grid.indices.length, gl.UNSIGNED_SHORT, 0)
      gl.bindVertexArray(null)
    }

    const frame = (now: number) => {
      if (disposed) return
      syncCanvasSize()
      const delta = Math.min((now - previousTime) / 1000, 1 / 20)
      previousTime = now
      const width = Math.max(canvas.parentElement?.clientWidth ?? 1, 1)
      const height = Math.max(canvas.parentElement?.clientHeight ?? 1, 1)

      if (!reducedMotion) {
        const targetGust = Math.max(
          0.55
          + 0.35 * Math.sin(simulationTime * 0.31 + 1.3)
          + 0.25 * Math.sin(simulationTime * 0.83)
            * (0.5 + 0.5 * Math.sin(simulationTime * 0.17)),
          0.15,
        )
        gust += (targetGust - gust) * Math.min(delta * 2, 1)
        applyDragImpulse(delta, width, height)
        simulationDebt = Math.min(simulationDebt + delta, STEP * 5)
        while (simulationDebt >= STEP) {
          stepSimulation(STEP)
          simulationDebt -= STEP
        }
      }

      composeVertices(width, height)
      if (textureReady) {
        render(width, height)
        if (!didAnnounceReady) {
          didAnnounceReady = true
          setReady(true)
        }
      }

      animationFrame = requestAnimationFrame(frame)
    }

    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (disposed) return
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      textureReady = true
    }
    image.src = new URL('cloth.png', document.baseURI).href

    const resizeObserver = new ResizeObserver(syncCanvasSize)
    resizeObserver.observe(canvas)
    const handleContextLost = (event: Event) => {
      event.preventDefault()
      setReady(false)
    }
    canvas.addEventListener('webglcontextlost', handleContextLost)
    animationFrame = requestAnimationFrame(frame)

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      motionQuery.removeEventListener?.('change', handleMotionPreference)
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      gl.deleteTexture(texture)
      gl.deleteBuffer(gridBuffer)
      gl.deleteBuffer(dataBuffer)
      gl.deleteBuffer(offsetBuffer)
      gl.deleteBuffer(indexBuffer)
      gl.deleteVertexArray(vertexArray)
      gl.deleteProgram(program)
    }
  }, [])

  return (
    <div className={`cloth-surface${ready ? ' is-ready' : ''}`} aria-hidden="true">
      <img className="cloth-fallback" src="./cloth.png" alt="" />
      <canvas ref={canvasRef} className="cloth-canvas" />
    </div>
  )
}
