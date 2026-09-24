/// <reference types="vite/client" />

interface Window {
  webkit?: {
    messageHandlers?: {
      haptics?: {
        postMessage: (message: string) => void
      }
    }
  }
}

