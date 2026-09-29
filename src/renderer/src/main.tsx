import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AccessGate } from './access/AccessGate'
import { UpdateBanner } from './update/UpdateBanner'
import { TelemetryNotice } from './settings/TelemetryNotice'
import { installErrorReports } from './lib/errorReports'
// Bundled, not fetched: the CSP permits no remote origin, and Vite emits the woff2 files
// beside the stylesheet where `font-src 'self'` covers them.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'

// Before anything renders, so an error in the first render is reported too (if crash reports are on).
installErrorReports()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <AccessGate>
      <App />
    </AccessGate>
    {/* Outside the gate: a locked bay can still update itself. */}
    <UpdateBanner />
    {/* Outside the gate too: bay sends from launch, so the notice (and its switches) must show on the sign-in screen. */}
    <TelemetryNotice />
  </StrictMode>
)
