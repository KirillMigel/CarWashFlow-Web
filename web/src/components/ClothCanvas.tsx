import { useEffect, useRef, useState } from 'react'
import { ClothPoint, HoloclothSim } from './holoclothPhysics'

type Props = {
  velocity: { x: number; y: number }
  dragging: boolean
}

const SHEET_WIDTH = 1.2
const SHEET_HEIGHT = 1
const SEGMENTS_X = 30
const SEGMENTS_Y = 25
const COLUMNS = SEGMENTS_X + 1
const ROWS = SEGMENTS_Y + 1
const BLEED = 24

const vertexShaderSource = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aUV;
layout(location = 1) in vec3 aPosition;
layout(location = 2) in vec3 aNormal;
layout(location = 3) in float aCavity;

uniform vec2 uSheet;
uniform vec2 uSize;
uniform vec2 uOutput;
uniform float uBleed;
uniform float uFocal;

out vec2 vUV;
out vec3 vNormal;
out float vCavity;

void main() {
  vUV = aUV;
  vNormal = aNormal;
  vCavity = aCavity;

  vec2 normalized = vec2(
    aPosition.x / uSheet.x + 0.5,
    aPosition.y / uSheet.y + 0.5
  );
  float depth = (aPosition.z / uSheet.y) * uSize.y;
  vec2 center = uSize * 0.5 + vec2(uBleed);
  vec2 pixel = normalized * uSize + vec2(uBleed);
  float perspective = uFocal / max(uFocal - depth, 1.0);
  pixel = center + (pixel - center) * perspective;

  vec2 clip = pixel / uOutput * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, -depth / uFocal, 1.0);
}
`

const fragmentShaderSource = `#version 300 es
precision highp float;

in vec2 vUV;
in vec3 vNormal;
in float vCavity;

uniform sampler2D uTexture;
uniform float uMotion;

out vec4 outColor;

void main() {
  vec4 textile = texture(uTexture, vUV);
  if (textile.a < 0.015) discard;

  vec3 normal = normalize(vNormal);
  if (!gl_FrontFacing) normal = -normal;
  vec3 lightDirection = normalize(vec3(-0.36, -0.42, 0.83));
  float diffuse = 0.7 + 0.3 * max(dot(normal, lightDirection), 0.0);
  float cavityShadow = 1.0 - vCavity * 0.22;

  vec3 viewDirection = vec3(0.0, 0.0, 1.0);
  vec3 halfway = normalize(lightDirection + viewDirection);
  float fiberSheen = pow(max(dot(normal, halfway), 0.0), 18.0);
  float sheenAmount = 0.035 + 0.035 * uMotion;

  vec3 color = textile.rgb * diffuse * cavityShadow;
  color += fiberSheen * sheenAmount * mix(vec3(1.0), textile.rgb, 0.55);
  outColor = vec4(clamp(color, 0.0, 1.0), textile.a);
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
  const uv = new Float32Array(COLUMNS * ROWS * 2)
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const offset = (row * COLUMNS + column) * 2
      uv[offset] = column / SEGMENTS_X
      uv[offset + 1] = row / SEGMENTS_Y
    }
  }

  const indices = new Uint16Array(SEGMENTS_X * SEGMENTS_Y * 6)
  let cursor = 0
  for (let row = 0; row < SEGMENTS_Y; row += 1) {
    for (let column = 0; column < SEGMENTS_X; column += 1) {
      const topLeft = row * COLUMNS + column
      const topRight = topLeft + 1
      const bottomLeft = topLeft + COLUMNS
      const bottomRight = bottomLeft + 1
      indices[cursor++] = topLeft
      indices[cursor++] = topRight
      indices[cursor++] = bottomLeft
      indices[cursor++] = topRight
      indices[cursor++] = bottomRight
      indices[cursor++] = bottomLeft
    }
  }
  return { uv, indices }
}

function computeNormals(
  positions: Float32Array,
  indices: Uint16Array,
  output: Float32Array,
) {
  output.fill(0)
  for (let cursor = 0; cursor < indices.length; cursor += 3) {
    const a = indices[cursor] * 3
    const b = indices[cursor + 1] * 3
    const c = indices[cursor + 2] * 3
    const abX = positions[b] - positions[a]
    const abY = positions[b + 1] - positions[a + 1]
    const abZ = positions[b + 2] - positions[a + 2]
    const acX = positions[c] - positions[a]
    const acY = positions[c + 1] - positions[a + 1]
    const acZ = positions[c + 2] - positions[a + 2]
    const normalX = abY * acZ - abZ * acY
    const normalY = abZ * acX - abX * acZ
    const normalZ = abX * acY - abY * acX
    for (const offset of [a, b, c]) {
      output[offset] += normalX
      output[offset + 1] += normalY
      output[offset + 2] += normalZ
    }
  }

  for (let offset = 0; offset < output.length; offset += 3) {
    const inverseLength = 1 / Math.max(Math.hypot(
      output[offset],
      output[offset + 1],
      output[offset + 2],
    ), 1e-6)
    output[offset] *= inverseLength
    output[offset + 1] *= inverseLength
    output[offset + 2] *= inverseLength
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

export function ClothCanvas({ velocity, dragging }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const motionRef = useRef({ velocity, dragging, updatedAt: performance.now() })
  const previousMotionRef = useRef({ velocity, dragging })
  const [ready, setReady] = useState(false)

  const previousMotion = previousMotionRef.current
  if (previousMotion.velocity !== velocity || previousMotion.dragging !== dragging) {
    motionRef.current = { velocity, dragging, updatedAt: performance.now() }
    previousMotionRef.current = { velocity, dragging }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      depth: true,
      stencil: false,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    })
    if (!gl || gl.isContextLost()) return

    const program = createProgram(gl)
    if (!program) return

    const grid = createGrid()
    const simulation = new HoloclothSim(
      SHEET_WIDTH,
      SHEET_HEIGHT,
      SEGMENTS_X,
      SEGMENTS_Y,
    )
    const vertexArray = gl.createVertexArray()
    const uvBuffer = gl.createBuffer()
    const vertexBuffer = gl.createBuffer()
    const indexBuffer = gl.createBuffer()
    const texture = gl.createTexture()
    if (!vertexArray || !uvBuffer || !vertexBuffer || !indexBuffer || !texture) {
      gl.deleteProgram(program)
      return
    }

    const vertexStride = 7
    const vertexData = new Float32Array(simulation.count * vertexStride)
    const normals = new Float32Array(simulation.count * 3)
    const cavity = new Float32Array(simulation.count)

    gl.bindVertexArray(vertexArray)
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, grid.uv, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertexData.byteLength, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, vertexStride * 4, 0)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, vertexStride * 4, 3 * 4)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, vertexStride * 4, 6 * 4)

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, grid.indices, gl.STATIC_DRAW)
    gl.bindVertexArray(null)

    const sheetLocation = gl.getUniformLocation(program, 'uSheet')
    const sizeLocation = gl.getUniformLocation(program, 'uSize')
    const outputLocation = gl.getUniformLocation(program, 'uOutput')
    const bleedLocation = gl.getUniformLocation(program, 'uBleed')
    const focalLocation = gl.getUniformLocation(program, 'uFocal')
    const textureLocation = gl.getUniformLocation(program, 'uTexture')
    const motionLocation = gl.getUniformLocation(program, 'uMotion')

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = motionQuery.matches
    const handleMotionPreference = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
    }
    motionQuery.addEventListener?.('change', handleMotionPreference)

    let textureReady = false
    let didAnnounceReady = false
    let disposed = false
    let animationFrame = 0
    let previousTime = performance.now()
    let wasDragging = false
    let grabOrigin: ClothPoint | null = null
    let grabTarget: ClothPoint | null = null
    let motionAmount = 0

    const syncCanvasSize = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio))
      const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
    }

    const updateInteraction = (now: number, delta: number) => {
      const motion = motionRef.current
      if (motion.dragging && !wasDragging) {
        const centerIndex = Math.floor(ROWS / 2) * COLUMNS + Math.floor(COLUMNS / 2)
        grabOrigin = simulation.getPoint(centerIndex)
        grabTarget = { ...grabOrigin }
        simulation.startGrab(grabOrigin, 0.34)
      } else if (!motion.dragging && wasDragging) {
        simulation.endGrab()
        grabOrigin = null
        grabTarget = null
      }
      wasDragging = motion.dragging

      const motionAge = Math.max(0, now - motion.updatedAt)
      const decay = Math.exp(-Math.max(0, motionAge - 55) / 90)
      const velocityX = motion.velocity.x * decay
      const velocityY = motion.velocity.y * decay
      const speed = Math.hypot(velocityX, velocityY)
      const targetMotion = motion.dragging ? Math.min(speed / 20, 1) : 0
      motionAmount += (targetMotion - motionAmount) * Math.min(delta * 10, 1)

      if (motion.dragging && grabOrigin && grabTarget) {
        const target: ClothPoint = {
          x: grabOrigin.x - clamp(velocityX / 80, -0.13, 0.13),
          y: grabOrigin.y - clamp(velocityY / 90, -0.11, 0.11),
          z: grabOrigin.z + 0.035 + Math.min(speed / 180, 0.09),
        }
        const response = Math.min(delta * 13, 1)
        grabTarget.x += (target.x - grabTarget.x) * response
        grabTarget.y += (target.y - grabTarget.y) * response
        grabTarget.z += (target.z - grabTarget.z) * response
        simulation.moveGrab(grabTarget)
      }
    }

    const composeVertices = () => {
      computeNormals(simulation.positions, grid.indices, normals)
      simulation.computeCavity(normals, cavity)
      for (let index = 0; index < simulation.count; index += 1) {
        const input = index * 3
        const output = index * vertexStride
        vertexData[output] = simulation.positions[input]
        vertexData[output + 1] = simulation.positions[input + 1]
        vertexData[output + 2] = simulation.positions[input + 2]
        vertexData[output + 3] = normals[input]
        vertexData[output + 4] = normals[input + 1]
        vertexData[output + 5] = normals[input + 2]
        vertexData[output + 6] = cavity[index]
      }
    }

    const render = (width: number, height: number) => {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)

      gl.bindVertexArray(vertexArray)
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertexData)
      gl.useProgram(program)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.uniform1i(textureLocation, 0)
      gl.uniform2f(sheetLocation, SHEET_WIDTH, SHEET_HEIGHT)
      gl.uniform2f(sizeLocation, width, height)
      gl.uniform2f(outputLocation, canvas.clientWidth, canvas.clientHeight)
      gl.uniform1f(bleedLocation, BLEED)
      gl.uniform1f(focalLocation, 900)
      gl.uniform1f(motionLocation, motionAmount)
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
        updateInteraction(now, delta)
        simulation.step(delta, {
          viscosity: 0.58,
          stiffness: 0.96,
          iterations: 8,
          smoothing: 0.035,
        })
      }
      composeVertices()
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
      // The simulation grid starts at the visual top-left, so keep the HTML
      // image row order instead of applying WebGL's conventional Y flip.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
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
      gl.deleteBuffer(uvBuffer)
      gl.deleteBuffer(vertexBuffer)
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
