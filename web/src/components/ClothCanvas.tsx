import { useEffect, useRef, useState } from 'react'

type Props = {
  velocity: { x: number; y: number }
  dragging: boolean
}

const vertexShaderSource = `
  attribute vec2 aPosition;
  attribute vec2 aUV;

  uniform float uTime;
  uniform vec2 uVelocity;
  uniform float uDragging;
  uniform float uReducedMotion;

  varying vec2 vUV;
  varying float vLight;

  const float PI = 3.14159265359;

  void main() {
    vec2 position = aPosition;
    float edge = 0.22 + 0.78 * sin(aUV.x * PI) * sin(aUV.y * PI);
    float ambient = 1.0 - uReducedMotion;

    float broadFold = sin(aUV.x * 8.0 + aUV.y * 5.0 + uTime * 2.25);
    float crossFold = cos(aUV.x * 13.0 - aUV.y * 7.0 - uTime * 1.75);
    float breathing = sin(uTime * 1.4 + aUV.y * 4.0) * 0.010 * ambient;

    position.x += (broadFold * 0.022 + crossFold * 0.008) * edge * ambient;
    position.y += (crossFold * 0.018 + breathing) * edge * ambient;

    // Paper-like inertia: the far side of the cloth trails behind the grabbed point.
    position.x += uVelocity.x * (0.5 - aUV.y) * (0.12 + edge * 0.10) * uDragging;
    position.y -= uVelocity.y * (aUV.x - 0.5) * (0.09 + edge * 0.08) * uDragging;
    position.x += uVelocity.y * broadFold * edge * 0.025 * uDragging;
    position.y += uVelocity.x * crossFold * edge * 0.020 * uDragging;

    vUV = aUV;
    vLight = (broadFold * 0.55 + crossFold * 0.25) * edge;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

const fragmentShaderSource = `
  precision mediump float;

  uniform sampler2D uTexture;
  uniform float uDragging;

  varying vec2 vUV;
  varying float vLight;

  void main() {
    vec4 color = texture2D(uTexture, vUV);
    if (color.a < 0.01) discard;

    float foldLight = 1.0 + vLight * (0.055 + uDragging * 0.045);
    color.rgb *= foldLight;
    gl_FragColor = color;
  }
`

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createProgram(gl: WebGLRenderingContext) {
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
    gl.deleteProgram(program)
    return null
  }
  return program
}

function createMesh(columns: number, rows: number) {
  const vertices: number[] = []
  const indices: number[] = []

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns
      const v = row / rows
      vertices.push(-0.96 + u * 1.92, 0.96 - v * 1.92, u, v)
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * (columns + 1) + column
      const topRight = topLeft + 1
      const bottomLeft = topLeft + columns + 1
      const bottomRight = bottomLeft + 1
      indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight)
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  }
}

export function ClothCanvas({ velocity, dragging }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const motionRef = useRef({ velocity, dragging })
  const [ready, setReady] = useState(false)
  motionRef.current = { velocity, dragging }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    })
    if (!gl) return

    const program = createProgram(gl)
    if (!program) return

    const mesh = createMesh(22, 18)
    const vertexBuffer = gl.createBuffer()
    const indexBuffer = gl.createBuffer()
    const texture = gl.createTexture()
    if (!vertexBuffer || !indexBuffer || !texture) return

    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW)

    const positionLocation = gl.getAttribLocation(program, 'aPosition')
    const uvLocation = gl.getAttribLocation(program, 'aUV')
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(uvLocation)
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 16, 8)

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW)

    const timeLocation = gl.getUniformLocation(program, 'uTime')
    const velocityLocation = gl.getUniformLocation(program, 'uVelocity')
    const draggingLocation = gl.getUniformLocation(program, 'uDragging')
    const reducedMotionLocation = gl.getUniformLocation(program, 'uReducedMotion')
    const textureLocation = gl.getUniformLocation(program, 'uTexture')

    gl.uniform1i(textureLocation, 0)
    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reduceMotion = mediaQuery.matches
    const handleMotionPreference = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches
    }
    mediaQuery.addEventListener?.('change', handleMotionPreference)

    let animationFrame = 0
    let disposed = false
    let textureReady = false
    let didAnnounceReady = false
    const startedAt = performance.now()
    const smoothedVelocity = { x: 0, y: 0 }

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

    const render = (now: number) => {
      if (disposed) return

      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(rect.width * dpr))
      const height = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        gl.viewport(0, 0, width, height)
      }

      const current = motionRef.current
      const targetX = Math.max(-1, Math.min(1, current.velocity.x / 34))
      const targetY = Math.max(-1, Math.min(1, current.velocity.y / 34))
      const response = current.dragging ? 0.28 : 0.09
      smoothedVelocity.x += (targetX - smoothedVelocity.x) * response
      smoothedVelocity.y += (targetY - smoothedVelocity.y) * response

      gl.clear(gl.COLOR_BUFFER_BIT)
      if (textureReady) {
        gl.useProgram(program)
        gl.uniform1f(timeLocation, (now - startedAt) / 1000)
        gl.uniform2f(velocityLocation, smoothedVelocity.x, smoothedVelocity.y)
        gl.uniform1f(draggingLocation, current.dragging ? 1 : 0)
        gl.uniform1f(reducedMotionLocation, reduceMotion ? 1 : 0)
        gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0)

        if (!didAnnounceReady) {
          didAnnounceReady = true
          setReady(true)
        }
      }

      animationFrame = requestAnimationFrame(render)
    }

    animationFrame = requestAnimationFrame(render)

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrame)
      mediaQuery.removeEventListener?.('change', handleMotionPreference)
      gl.deleteTexture(texture)
      gl.deleteBuffer(vertexBuffer)
      gl.deleteBuffer(indexBuffer)
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
