import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

type Point = { x: number; y: number }

export type CarWipeHandle = {
  wipe: (point: Point) => void
}

type Props = {
  onComplete: () => void
}

const GRID_COLUMNS = 24
const GRID_ROWS = 10

function belongsToCar(x: number, y: number) {
  const body = x >= 0.05 && x <= 0.96 && y >= 0.39 && y <= 0.76
  const roof = x >= 0.19 && x <= 0.73 && y >= 0.16 && y < 0.48
  const rear = x >= 0.05 && x < 0.27 && y >= 0.29 && y < 0.63
  const hood = x > 0.70 && x <= 0.96 && y >= 0.34 && y < 0.62
  const rearWheel = ((x - 0.25) / 0.13) ** 2 + ((y - 0.76) / 0.20) ** 2 <= 1
  const frontWheel = ((x - 0.78) / 0.13) ** 2 + ((y - 0.76) / 0.20) ** 2 <= 1
  return body || roof || rear || hood || rearWheel || frontWheel
}

const targetCells = new Set<number>()
for (let row = 0; row < GRID_ROWS; row += 1) {
  for (let column = 0; column < GRID_COLUMNS; column += 1) {
    const x = (column + 0.5) / GRID_COLUMNS
    const y = (row + 0.5) / GRID_ROWS
    if (belongsToCar(x, y)) targetCells.add(row * GRID_COLUMNS + column)
  }
}

export const CarWipeCanvas = forwardRef<CarWipeHandle, Props>(function CarWipeCanvas(
  { onComplete },
  forwardedRef,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dirtyImageRef = useRef<HTMLImageElement | null>(null)
  const pointsRef = useRef<Point[]>([])
  const cleanedCellsRef = useRef(new Set<number>())
  const completeRef = useRef(false)

  const redraw = () => {
    const canvas = canvasRef.current
    const image = dirtyImageRef.current
    if (!canvas || !image?.complete) return

    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)

    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.globalCompositeOperation = 'source-over'
    context.clearRect(0, 0, rect.width, rect.height)
    context.drawImage(image, 0, 0, rect.width, rect.height)

    context.globalCompositeOperation = 'destination-out'
    for (const point of pointsRef.current) {
      const radiusX = rect.width * 0.09
      const radiusY = rect.height * 0.17
      context.save()
      context.translate(point.x * rect.width, point.y * rect.height)
      context.scale(radiusX, radiusY)
      context.beginPath()
      context.arc(0, 0, 1, 0, Math.PI * 2)
      context.fill()
      context.restore()
    }
    context.globalCompositeOperation = 'source-over'
  }

  useEffect(() => {
    const image = new Image()
    image.src = './dirty-car.png'
    image.onload = redraw
    dirtyImageRef.current = image

    const observer = new ResizeObserver(redraw)
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [])

  useImperativeHandle(forwardedRef, () => ({
    wipe(point) {
      if (completeRef.current) return
      pointsRef.current.push(point)

      for (let row = 0; row < GRID_ROWS; row += 1) {
        for (let column = 0; column < GRID_COLUMNS; column += 1) {
          const index = row * GRID_COLUMNS + column
          if (!targetCells.has(index)) continue
          const centerX = (column + 0.5) / GRID_COLUMNS
          const centerY = (row + 0.5) / GRID_ROWS
          const dx = (centerX - point.x) / 0.08
          const dy = (centerY - point.y) / 0.15
          if (dx * dx + dy * dy <= 1) cleanedCellsRef.current.add(index)
        }
      }

      redraw()

      const cleaned = cleanedCellsRef.current
      const totalCoverage = cleaned.size / targetCells.size
      const sectionCoverage = [0, 1, 2].map((section) => {
        const lower = section * GRID_COLUMNS / 3
        const upper = (section + 1) * GRID_COLUMNS / 3
        const sectionTargets = [...targetCells].filter((index) => {
          const column = index % GRID_COLUMNS
          return column >= lower && column < upper
        })
        const sectionCleaned = sectionTargets.filter((index) => cleaned.has(index)).length
        return sectionCleaned / sectionTargets.length
      })

      if (totalCoverage >= 0.94 && sectionCoverage.every((coverage) => coverage >= 0.88)) {
        completeRef.current = true
        onComplete()
      }
    },
  }), [onComplete])

  return <canvas ref={canvasRef} className="dirty-car-canvas" aria-hidden="true" />
})
