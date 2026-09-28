import { useCallback, useEffect, useRef, useState } from 'react'
import { BandageLayoutWorker } from './utils/BandageLayoutWorker'
import App from './App'
import './App.css'

async function createReadyWorker(): Promise<BandageLayoutWorker> {
  const newWorker = new BandageLayoutWorker()
  await newWorker.ready()
  return newWorker
}

export function AppLoader() {
  // AppLoader owns the WASM worker lifecycle so App can assume the layout
  // backend already exists and focus on UI state only.
  const [worker, setWorker] = useState<BandageLayoutWorker | null>(null)
  const [isWorkerReady, setIsWorkerReady] = useState(false)
  const [workerError, setWorkerError] = useState<string | null>(null)
  // Tracks the live worker instance outside of React state so
  // respawnWorker() always terminates the *current* one, even if it's
  // called again before a previous respawn's state update has landed.
  const workerRef = useRef<BandageLayoutWorker | null>(null)

  // Initialize worker
  useEffect(() => {
    let cancelled = false

    const initWorker = async () => {
      try {
        console.log('Initializing Bandage Layout worker...')
        const newWorker = await createReadyWorker()
        console.log('Worker initialized successfully')

        if (cancelled) {
          newWorker.terminate()
          return
        }

        workerRef.current = newWorker
        setWorker(newWorker)
        setIsWorkerReady(true)
      } catch (error) {
        console.error('Failed to initialize worker:', error)
        setWorkerError(
          error instanceof Error ? error.message : 'Unknown error occurred',
        )
      }
    }

    initWorker()

    return () => {
      cancelled = true
      if (workerRef.current) {
        // Tear the worker down when the React tree unmounts to avoid leaving a
        // background thread alive during navigation or hot reloads.
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [])

  // The WASM layout call blocks its worker thread for the whole computation,
  // so the only way to actually cancel one already running is to kill that
  // thread outright - then a fresh worker takes its place so later layout
  // requests still work. App stays mounted throughout (its `worker` prop
  // just briefly points at the new instance instead of unmounting), so
  // in-progress state like the loaded graph is never lost.
  const respawnWorker = useCallback(async () => {
    workerRef.current?.terminate()
    workerRef.current = null
    setWorker(null)

    try {
      const newWorker = await createReadyWorker()
      workerRef.current = newWorker
      setWorker(newWorker)
    } catch (error) {
      console.error('Failed to restart layout worker:', error)
      setWorkerError(
        error instanceof Error ? error.message : 'Unknown error occurred',
      )
    }
  }, [])

  // Show loading screen while initializing
  if (!isWorkerReady && !workerError) {
    return (
      <div className="app">
        <div className="init-loading">
          <div className="spinner"></div>
          <h2>Loading Bandage Layout Engine...</h2>
          <p>Initializing WebAssembly module with OGDF + FMMM algorithm</p>
        </div>
      </div>
    )
  }

  // Show error screen if initialization failed
  if (workerError) {
    return (
      <div className="app">
        <div className="init-error">
          <h2>Failed to Initialize Layout Engine</h2>
          <p>Error: {workerError}</p>
          <p>
            Make sure WASM files are present in <code>public/js/</code>:
          </p>
          <ul>
            <li>bandage-layout.wasm</li>
            <li>bandage-layout.js</li>
            <li>bandage-layout.worker.js</li>
            <li>bandage-layout-wrapper.js</li>
            <li>bandage-layout-worker-interface.js</li>
          </ul>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    )
  }

  // Render App once worker is ready. worker can briefly go back to null
  // during respawnWorker() (see above) without unmounting App itself.
  return <App worker={worker} onStopLayout={respawnWorker} />
}
