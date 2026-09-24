import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AccessGate } from './access/AccessGate'
import { UpdateBanner } from './update/UpdateBanner'
// Bundled, not fetched: the CSP permits no remote origin, and Vite emits the woff2 files
// beside the stylesheet where `font-src 'self'` covers them.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <AccessGate>
      <App />
    </AccessGate>
    {/* Outside the gate: a locked bay can still update itself. */}
    <UpdateBanner />
  </StrictMode>
)
