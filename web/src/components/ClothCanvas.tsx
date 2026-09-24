import { useEffect, useRef } from 'react'

type Props = {
  velocity: { x: number; y: number }
  dragging: boolean
}

type Point = { x: number; y: number }

function mapTriangle(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: [Point, Point, Point],
  destination: [Point, Point, Point],
) {
  const [s0, s1, s2] = source
  const [d0, d1, d2] = destination
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y)
  if (Math.abs(denominator) < 0.001) return

  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator
  const e = (
    d0.x * (s1.x * s2.y - s2.x * s1.y)
    + d1.x * (s2.x * s0.y - s0.x * s2.y)
    + d2.x * (s0.x * s1.y - s1.x * s0.y)
  ) / denominator
  const f = (
    d0.y * (s1.x * s2.y - s2.x * s1.y)
    + d1.y * (s2.x * s0.y - s0.x * s2.y)
    + d2.y * (s0.x * s1.y - s1.x * s0.y)
  ) / denominator

  context.save()
  context.beginPath()
  context.moveTo(d0.x, d0.y)
  context.lineTo(d1.x, d1.y)
  context.lineTo(d2.x, d2.y)
  context.closePath()
  context.clip()
  context.transform(a, b, c, d, e, f)
  context.drawImage(image, 0, 0)
  context.restore()
}

export function ClothCanvas({ velocity, dragging }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const motionRef = useRef({ velocity, dragging })
  motionRef.current = { velocity, dragging }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const image = new Image()
    image.src = './cloth.png'
    let animationFrame = 0
    let start = performance.now()
    let previousFrame = 0

    const render = (now: number) => {
      if (now - previousFrame < 33) {
        animationFrame = requestAnimationFrame(render)
        return
      }
      previousFrame = now
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const targetWidth = Math.round(rect.width * dpr)
      const targetHeight = Math.round(rect.height * dpr)
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, rect.width, rect.height)

      if (image.complete) {
        const columns = 5
        const rows = 4
        const time = (now - start) / 1000
        const { velocity: currentVelocity, dragging: isDragging } = motionRef.current
        const velocityX = Math.max(-34, Math.min(34, currentVelocity.x))
        const velocityY = Math.max(-34, Math.min(34, currentVelocity.y))
        const inset = 6
        const drawWidth = rect.width - inset * 2
        const drawHeight = rect.height - inset * 2
        const vertices: Point[][] = []

        for (let row = 0; row <= rows; row += 1) {
          const line: Point[] = []
          for (let column = 0; column <= columns; column += 1) {
            const nx = column / columns
            const ny = row / rows
            const edgeFade = Math.sin(nx * Math.PI) * Math.sin(ny * Math.PI)
            const waveX = Math.sin(time * 2.4 + ny * 5.5 + nx * 2) * 2.6 * edgeFade
            const waveY = Math.cos(time * 2.1 + nx * 6.2) * 3.2 * edgeFade
            const dragX = (ny - 0.5) * velocityX * (isDragging ? 0.24 : 0.04)
            const dragY = (nx - 0.5) * velocityY * (isDragging ? 0.18 : 0.03)
            line.push({
              x: inset + nx * drawWidth + waveX + dragX,
              y: inset + ny * drawHeight + waveY + dragY,
            })
          }
          vertices.push(line)
        }

        for (let row = 0; row < rows; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const sx0 = column * image.width / columns
            const sx1 = (column + 1) * image.width / columns
            const sy0 = row * image.height / rows
            const sy1 = (row + 1) * image.height / rows
            const sourceA: [Point, Point, Point] = [
              { x: sx0, y: sy0 },
              { x: sx1, y: sy0 },
              { x: sx0, y: sy1 },
            ]
            const sourceB: [Point, Point, Point] = [
              { x: sx1, y: sy0 },
              { x: sx1, y: sy1 },
              { x: sx0, y: sy1 },
            ]
            const destinationA: [Point, Point, Point] = [
              vertices[row][column],
              vertices[row][column + 1],
              vertices[row + 1][column],
            ]
            const destinationB: [Point, Point, Point] = [
              vertices[row][column + 1],
              vertices[row + 1][column + 1],
              vertices[row + 1][column],
            ]
            mapTriangle(context, image, sourceA, destinationA)
            mapTriangle(context, image, sourceB, destinationB)
          }
        }
      }

      animationFrame = requestAnimationFrame(render)
    }

    image.onload = () => {
      start = performance.now()
      animationFrame = requestAnimationFrame(render)
    }
    return () => cancelAnimationFrame(animationFrame)
  }, [])

  return <canvas ref={canvasRef} className="cloth-canvas" aria-hidden="true" />
}
