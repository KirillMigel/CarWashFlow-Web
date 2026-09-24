import { KeyboardEvent, PointerEvent, useCallback, useRef, useState } from 'react'
import { CarWipeCanvas, CarWipeHandle } from './components/CarWipeCanvas'
import { ClothCanvas } from './components/ClothCanvas'

type Route = 'home' | 'cleaning' | 'map'
type RootTab = 'home' | 'payments' | 'city' | 'chat' | 'more'
type Point = { x: number; y: number }

const tabs: { id: RootTab; label: string }[] = [
  { id: 'home', label: 'Главная' },
  { id: 'payments', label: 'Платежи' },
  { id: 'city', label: 'Город' },
  { id: 'chat', label: 'Чат' },
  { id: 'more', label: 'Еще' },
]

function BackButton({ onClick, label = 'Назад' }: { onClick: () => void; label?: string }) {
  return (
    <button className="back-button" type="button" onClick={onClick} aria-label={label}>
      <img src="./back-button.png" alt="" />
    </button>
  )
}

function HomeScreen({ onWash }: { onWash: () => void }) {
  const [selection, setSelection] = useState<RootTab>('home')

  if (selection !== 'home') {
    const selectedTab = tabs.find((tab) => tab.id === selection)!
    return (
      <main className="screen placeholder-screen">
        <button className="placeholder-back" type="button" onClick={() => setSelection('home')}>
          На главную
        </button>
        <h1>{selectedTab.label}</h1>
        <TabBar selection={selection} onSelect={setSelection} />
      </main>
    )
  }

  return (
    <main className="screen home-screen">
      <img className="home-background" src="./home-background.png" alt="Porsche Cayenne" />
      <button className="wash-hotspot" type="button" onClick={onWash} aria-label="Пора помыть авто" />
      <TabBar selection={selection} onSelect={setSelection} />
    </main>
  )
}

function TabBar({ selection, onSelect }: { selection: RootTab; onSelect: (tab: RootTab) => void }) {
  return (
    <nav className="tab-bar" aria-label="Основная навигация">
      <img src="./tab-bar.png" alt="" />
      <div className="tab-hitboxes">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-label={tab.label}
            aria-current={selection === tab.id ? 'page' : undefined}
            onClick={() => onSelect(tab.id)}
          />
        ))}
      </div>
    </nav>
  )
}

function Celebration() {
  return (
    <div className="celebration" aria-label="Чистый синий Porsche Cayenne">
      <img className="clean-glow" src="./clean-car.png" alt="" />
      <img className="clean-result" src="./clean-car.png" alt="" />
      <div className="shine" />
      <span className="sparkle sparkle-one" />
      <span className="sparkle sparkle-two" />
      <span className="sparkle sparkle-three" />
      <span className="sparkle sparkle-four" />
    </div>
  )
}

function CleaningScreen({
  complete,
  onBack,
  onComplete,
  onMap,
}: {
  complete: boolean
  onBack: () => void
  onComplete: () => void
  onMap: () => void
}) {
  const screenRef = useRef<HTMLElement>(null)
  const carStageRef = useRef<HTMLDivElement>(null)
  const wipeRef = useRef<CarWipeHandle>(null)
  const pointerRef = useRef<{ id: number; point: Point } | null>(null)
  const [clothPosition, setClothPosition] = useState<Point>({ x: 187.5, y: 585 })
  const [velocity, setVelocity] = useState<Point>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  const finish = useCallback(() => {
    onComplete()
    window.webkit?.messageHandlers?.haptics?.postMessage('success')
    navigator.vibrate?.(35)
  }, [onComplete])

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (complete) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerRef.current = { id: event.pointerId, point: { x: event.clientX, y: event.clientY } }
    setDragging(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const activePointer = pointerRef.current
    const screen = screenRef.current
    if (!activePointer || activePointer.id !== event.pointerId || !screen) return

    const screenRect = screen.getBoundingClientRect()
    const next = {
      x: Math.min(Math.max(event.clientX - screenRect.left, 44), screenRect.width - 44),
      y: Math.min(Math.max(event.clientY - screenRect.top, 110), screenRect.height - 76),
    }
    setVelocity({
      x: event.clientX - activePointer.point.x,
      y: event.clientY - activePointer.point.y,
    })
    setClothPosition(next)
    pointerRef.current = { id: event.pointerId, point: { x: event.clientX, y: event.clientY } }

    const carRect = carStageRef.current?.getBoundingClientRect()
    if (carRect && event.clientX >= carRect.left && event.clientX <= carRect.right
      && event.clientY >= carRect.top && event.clientY <= carRect.bottom) {
      wipeRef.current?.wipe({
        x: (event.clientX - carRect.left) / carRect.width,
        y: (event.clientY - carRect.top) / carRect.height,
      })
    }
  }

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current?.id !== event.pointerId) return
    pointerRef.current = null
    setVelocity({ x: 0, y: 0 })
    setDragging(false)
  }

  const wipeAtScreenPoint = (point: Point) => {
    const screenRect = screenRef.current?.getBoundingClientRect()
    const carRect = carStageRef.current?.getBoundingClientRect()
    if (!screenRect || !carRect) return
    const clientX = screenRect.left + point.x
    const clientY = screenRect.top + point.y
    if (clientX < carRect.left || clientX > carRect.right
      || clientY < carRect.top || clientY > carRect.bottom) return
    wipeRef.current?.wipe({
      x: (clientX - carRect.left) / carRect.width,
      y: (clientY - carRect.top) / carRect.height,
    })
  }

  const handleClothKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const movement: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    }
    const direction = movement[event.key]
    if (!direction || complete) return
    event.preventDefault()
    const step = event.shiftKey ? 36 : 18
    setClothPosition((current) => {
      const screenRect = screenRef.current?.getBoundingClientRect()
      if (!screenRect) return current
      const next = {
        x: Math.min(Math.max(current.x + direction.x * step, 44), screenRect.width - 44),
        y: Math.min(Math.max(current.y + direction.y * step, 110), screenRect.height - 76),
      }
      setVelocity({ x: direction.x * step, y: direction.y * step })
      wipeAtScreenPoint(next)
      return next
    })
  }

  return (
    <main ref={screenRef} className={`screen cleaning-screen${complete ? ' is-complete' : ''}`}>
      <BackButton onClick={onBack} />
      <header className="cleaning-header">
        <h1>{complete ? 'Выглядит как новая' : 'Авто загрязнилось'}</h1>
        <p>{complete ? 'Не забывайте заглядывать в автомойки' : 'Протрите его тряпочкой'}</p>
      </header>

      <div ref={carStageRef} className="car-stage">
        {complete ? (
          <Celebration />
        ) : (
          <>
            <img className="clean-car-base" src="./clean-car.png" alt="" />
            <CarWipeCanvas ref={wipeRef} onComplete={finish} />
          </>
        )}
      </div>

      {!complete && (
        <div
          className={`cloth-control${dragging ? ' is-dragging' : ''}`}
          style={{ left: clothPosition.x, top: clothPosition.y }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onKeyDown={handleClothKeyDown}
          role="button"
          tabIndex={0}
          aria-label="Тряпка. Перетаскивайте по машине, чтобы очистить её"
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
        >
          <ClothCanvas velocity={velocity} dragging={dragging} />
        </div>
      )}

      {complete && (
        <button className="primary-button" type="button" onClick={onMap}>
          Заглянуть в автомойки
        </button>
      )}
    </main>
  )
}

function MapScreen({ onBack }: { onBack: () => void }) {
  return (
    <main className="screen map-screen">
      <img src="./car-wash-map.png" alt="Карта ближайших автомоек" />
      <button className="map-close" type="button" onClick={onBack} aria-label="Закрыть карту" />
    </main>
  )
}

export default function App() {
  const [route, setRoute] = useState<Route>('home')
  const [cleaningComplete, setCleaningComplete] = useState(false)

  const startCleaning = () => {
    setCleaningComplete(false)
    setRoute('cleaning')
  }

  return (
    <div className="viewport">
      <div className="phone-shell">
        {route === 'home' && <HomeScreen onWash={startCleaning} />}
        {route === 'cleaning' && (
          <CleaningScreen
            complete={cleaningComplete}
            onBack={() => setRoute('home')}
            onComplete={() => setCleaningComplete(true)}
            onMap={() => setRoute('map')}
          />
        )}
        {route === 'map' && <MapScreen onBack={() => setRoute('cleaning')} />}
      </div>
    </div>
  )
}
