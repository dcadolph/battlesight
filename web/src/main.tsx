import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode is intentionally disabled. In dev it double-invokes every
// useEffect (mount → cleanup → re-mount) which forces react-globe.gl to
// dispose and re-create its WebGL context in rapid succession. The browser
// fires "Context Lost" / "Context Restored", and react-globe.gl 2.37.1's
// restore handler crashes inside three.js with
// "TypeError: undefined is not an object (evaluating 'info.autoReset')".
// Result: the globe renders for a frame then goes black. Production builds
// don't double-mount so they aren't affected; we can re-enable StrictMode
// once react-globe.gl ships a fix.
createRoot(document.getElementById('root')!).render(<App />)
