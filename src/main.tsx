import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * No StrictMode: recharts' CartesianAxis dispatches its computed tick list into an internal store
 * from a useEffect (RenderedTicksReporter), and that dispatch appends rather than replaces.
 * StrictMode's deliberate dev-only double-invoke of effects was firing it twice, leaving the
 * Category Targets Y axis with a doubled, partially-overlapping tick list (duplicate/missing
 * category labels). This only ever affected dev-mode rendering, not production output.
 */
createRoot(document.getElementById('root')!).render(<App />)
